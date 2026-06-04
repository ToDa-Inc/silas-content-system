"""Relayout VideoSpec: per-beat pauses (pausesSec) or legacy uniform gap; B-roll duration cap."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

import httpx

from models.video_spec import (
    VideoSpecBlock,
    VideoSpecHook,
    VideoSpecV1,
    effective_background_duration,
    frame_to_sec,
    playable_background_frames,
)
from services.broll_normalize import broll_duration_from_row, broll_frames_from_row
from services.video_probe import COMPOSITION_FPS, ffprobe_duration_seconds

GAP_MIN = 0.0
# Per-pause cap. Generous so users can leave real breathing room between
# beats; the spec already bounds totalSec ≤ 600, which is the actual ceiling.
GAP_MAX = 5.0
MIN_HOOK = 1.0
MIN_BLOCK = 1.0


def clamp_gap(g: float) -> float:
    return max(GAP_MIN, min(GAP_MAX, float(g)))


def effective_pauses_sec(spec: VideoSpecV1, n: int) -> List[float]:
    """Length ``n`` — pause before each block in timeline order (index 0 = after hook, before block 0).

    If ``pausesSec`` is present and matches ``n``, use it (clamped). Otherwise repeat ``gapBetweenBlocksSec``.
    """
    if n <= 0:
        return []
    g = clamp_gap(getattr(spec, "gapBetweenBlocksSec", 0.0) or 0.0)
    raw = getattr(spec, "pausesSec", None)
    if raw is not None and len(raw) == n:
        return [clamp_gap(float(x)) for x in raw]
    return [g] * n


def probe_http_video_duration_sec(url: str, *, timeout: float = 120.0) -> Optional[float]:
    """Download bytes from a public URL and read duration via ffprobe (fallback when DB has no ``duration_s``)."""
    u = (url or "").strip()
    if not u:
        return None
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.get(u, follow_redirects=True)
        if r.status_code != 200 or not r.content:
            return None
        return ffprobe_duration_seconds(r.content)
    except Exception:
        return None


def fetch_broll_clip_row(supabase: Any, client_id: str, clip_id: str) -> Optional[Dict[str, Any]]:
    cid = (clip_id or "").strip()
    cl = (client_id or "").strip()
    if not cid or not cl or supabase is None:
        return None
    try:
        res = (
            supabase.table("broll_clips")
            .select(
                "duration_frames, duration_sec, duration_s, master_url, file_url"
            )
            .eq("id", cid)
            .eq("client_id", cl)
            .limit(1)
            .execute()
        )
        if not res.data:
            return None
        return res.data[0]
    except Exception:
        return None


def fetch_broll_timing(
    supabase: Any, client_id: str, clip_id: str
) -> Tuple[Optional[int], Optional[float]]:
    """Return (duration_frames, duration_sec) for a clip row."""
    row = fetch_broll_clip_row(supabase, client_id, clip_id)
    if not row:
        return None, None
    frames = broll_frames_from_row(row)
    dur = broll_duration_from_row(row)
    if dur is not None:
        return frames, dur
    fu = str(row.get("master_url") or row.get("file_url") or "").strip()
    if fu:
        probed = probe_http_video_duration_sec(fu)
        if probed is not None and probed > 0:
            est = max(1, round(probed * COMPOSITION_FPS))
            return est, probed
    return None, None


def fetch_broll_duration_sec(supabase: Any, client_id: str, clip_id: str) -> Optional[float]:
    """Resolve B-roll length: frames → sec, else ``duration_sec`` / ffprobe."""
    _frames, dur = fetch_broll_timing(supabase, client_id, clip_id)
    return dur


def clamp_spec_to_video_frames(spec: VideoSpecV1) -> VideoSpecV1:
    """Cap hook, blocks, and ``totalSec`` to the playable frame window (export-safe)."""
    pf = playable_background_frames(spec.background)
    if pf is None or pf <= 0:
        return spec
    cap_sec = frame_to_sec(pf)
    hook = spec.hook
    if hook.durationSec > cap_sec:
        hook = hook.model_copy(update={"durationSec": max(0.05, cap_sec)})
    blocks: List[VideoSpecBlock] = []
    for b in sorted(spec.blocks, key=lambda x: x.startSec):
        start = min(float(b.startSec), cap_sec)
        end = min(float(b.endSec), cap_sec)
        if end <= start:
            start = max(0.0, end - 0.05)
        blocks.append(b.model_copy(update={"startSec": start, "endSec": end}))
    return spec.model_copy(update={"hook": hook, "blocks": blocks, "totalSec": cap_sec})


def _round_cs(n: float) -> float:
    return round(float(n) * 100.0) / 100.0


def _span_v(hook_sec: float, durs: List[float], pauses: List[float]) -> float:
    return float(hook_sec) + sum(durs) + sum(pauses)


def fit_block_durs_to_available(
    durs: List[float],
    available: float,
    *,
    min_block: float = MIN_BLOCK,
) -> List[float]:
    """Scale block durations proportionally so their sum ≤ ``available``.

    Pauses + hook are NOT touched here — those are user-managed. We only
    re-balance block on-screen time so freshly generated reels honour the
    B-roll length without the user having to manually trim every beat.

    * Each block keeps at least ``min_block`` seconds.
    * If ``min_block * len(durs) > available`` we return ``[min_block] * n``
      (caller can decide whether to surface a "doesn't fit" warning).
    * Returns inputs unchanged when total already fits.
    """
    n = len(durs)
    if n == 0 or available <= 0:
        return [float(d) for d in durs]
    floor = float(min_block) * n
    if available <= floor:
        return [float(min_block)] * n
    total = float(sum(durs))
    if total <= available + 1e-6:
        return [_round_cs(d) for d in durs]
    headroom = available - floor
    extras = [max(0.0, float(d) - float(min_block)) for d in durs]
    extras_sum = sum(extras)
    if extras_sum <= 1e-6:
        return [float(min_block)] * n
    k = headroom / extras_sum
    return [_round_cs(float(min_block) + e * k) for e in extras]


def _fit_to_cap_vectors(
    hook_sec: float,
    durs: List[float],
    pauses: List[float],
    cap: float,
) -> Tuple[float, List[float], List[float]]:
    """Shrink pauses (largest first) then scale hook + block durations until span <= cap."""
    h = float(hook_sec)
    ds = [float(x) for x in durs]
    n = len(ds)
    ps = [clamp_gap(float(pauses[i])) if i < len(pauses) else 0.0 for i in range(n)]
    if n == 0:
        h = max(MIN_HOOK, min(h, cap))
        return h, [], []

    for _ in range(200):
        sp = _span_v(h, ds, ps)
        if sp <= cap + 1e-4:
            break
        if sum(ps) > 1e-5:
            mi = max(range(n), key=lambda i: ps[i])
            if ps[mi] > 1e-5:
                slack = sp - cap
                dec = min(ps[mi], slack, 0.05)
                ps[mi] = max(0.0, _round_cs(ps[mi] - dec))
                continue
        room = cap - sum(ps)
        content = h + sum(ds)
        if room <= 0:
            h = MIN_HOOK
            ds = [MIN_BLOCK] * n
            ps = [0.0] * n
            break
        if content <= room + 1e-6:
            break
        k = min(0.9999, room / content)
        h = max(MIN_HOOK, h * k)
        ds = [max(MIN_BLOCK, d * k) for d in ds]

    for _ in range(200):
        sp = _span_v(h, ds, ps)
        if sp <= cap + 1e-3:
            break
        if not ds:
            break
        if ds[-1] > MIN_BLOCK + 1e-3:
            ds[-1] = max(MIN_BLOCK, _round_cs(ds[-1] - 0.05))
        elif len(ds) > 1 and ds[-2] > MIN_BLOCK + 1e-3:
            ds[-2] = max(MIN_BLOCK, _round_cs(ds[-2] - 0.05))
        else:
            h = max(MIN_HOOK, _round_cs(h - 0.05))
    return h, ds, ps


def _trim_blocks_to_cap(blocks: List[VideoSpecBlock], cap: float) -> List[VideoSpecBlock]:
    out = list(blocks)
    for _ in range(600):
        if not out:
            break
        max_end = max(b.endSec for b in out)
        if max_end <= cap + 1e-3:
            break
        last = out[-1]
        dur = last.endSec - last.startSec
        if dur > MIN_BLOCK + 1e-3:
            new_end = max(MIN_BLOCK + last.startSec, _round_cs(last.endSec - 0.05))
            out[-1] = last.model_copy(update={"endSec": new_end})
        else:
            break
    return out


def relayout_spec(spec: VideoSpecV1) -> VideoSpecV1:
    """Recompute startSec/endSec from hook, per-block durations, and pausesSec (or legacy gap).

    When ``background.durationSec`` is set (B-roll), **block** on-screen times
    are proportionally shrunk so hook + pauses + blocks fit in the clip. Hook
    duration and ``pausesSec`` are never changed here (same contract as
    ``fit_spec_blocks_to_broll``). ``totalSec`` is capped to the clip when a cap
    exists so stale DB values cannot keep the composition longer than the media.
    """
    blocks_sorted = sorted(spec.blocks, key=lambda b: b.startSec)
    n = len(blocks_sorted)
    durs = [_round_cs(max(MIN_BLOCK, b.endSec - b.startSec)) for b in blocks_sorted]
    h = float(spec.hook.durationSec)
    pauses = effective_pauses_sec(spec, n)

    cap: Optional[float] = None
    eff = effective_background_duration(spec.background)
    if eff is not None and math.isfinite(eff) and eff > 0:
        cap = eff

    if cap is not None and n > 0:
        pause_sum = float(sum(pauses)) if pauses else 0.0
        avail_raw = float(cap) - h - pause_sum
        available = max(float(MIN_BLOCK) * float(n), avail_raw)
        durs = fit_block_durs_to_available([float(x) for x in durs], available)

    cursor = float(h)
    new_blocks: List[VideoSpecBlock] = []
    for i, ob in enumerate(blocks_sorted):
        cursor += pauses[i] if i < len(pauses) else 0.0
        dur = durs[i] if i < len(durs) else MIN_BLOCK
        start = _round_cs(cursor)
        end = _round_cs(start + dur)
        new_blocks.append(
            ob.model_copy(
                update={
                    "startSec": start,
                    "endSec": end,
                }
            )
        )
        cursor = end

    max_end = max((b.endSec for b in new_blocks), default=0.0)
    min_total = max(max_end, h + 0.5, 2.0)
    pf = playable_background_frames(spec.background)
    if pf is not None:
        total = frame_to_sec(pf)
    elif cap is not None:
        total = _round_cs(min(min_total, float(cap)))
    else:
        total = _round_cs(max(min_total, float(spec.totalSec)))

    new_hook = spec.hook.model_copy(update={"durationSec": _round_cs(h)})
    pauses_out: Optional[List[float]] = [_round_cs(p) for p in pauses] if n else None
    return spec.model_copy(
        update={
            "hook": new_hook,
            "blocks": new_blocks,
            "pausesSec": pauses_out,
            "totalSec": _round_cs(total),
        }
    )


def normalize_timeline_after_patch(spec_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Parse → relayout → dump. Used after JSON Patch so timeline + totalSec stay coherent."""
    if not isinstance(spec_dict, dict):
        return spec_dict
    try:
        spec = VideoSpecV1.model_validate(spec_dict)
    except Exception:
        return spec_dict
    out = relayout_spec(spec)
    return out.model_dump(mode="json")
