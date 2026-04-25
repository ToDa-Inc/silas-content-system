"""Build and sync VideoSpec v1 from generation_sessions rows."""

from __future__ import annotations

import math
import uuid
from typing import Any, Dict, List, Optional

from models.video_spec import (
    VideoSpecBackground,
    VideoSpecBlock,
    VideoSpecBrand,
    VideoSpecHook,
    VideoSpecLayout,
    VideoSpecV1,
    parse_video_spec,
)
from services.format_classifier import canonicalize_stored_format_key
from services.video_spec_timing import (
    block_read_duration_sec,
    default_hook_duration_sec,
    template_id_for_format_key,
)
from services.video_spec_timeline import (
    MIN_BLOCK,
    clamp_gap,
    effective_pauses_sec,
    fetch_broll_duration_sec,
    fit_block_durs_to_available,
    probe_http_video_duration_sec,
    relayout_spec,
)


def _session_hook_text(session: Dict[str, Any]) -> str:
    """Opening line for the reel: DB ``hooks[0]`` wins when set; else persisted
    ``video_spec.hook.text`` (authoritative after spec PATCH / AI refine); else
    chosen angle ``draft_hook``. Order matches what the dashboard must show so
    finalize/render never disagree with the preview."""
    hooks = session.get("hooks") or []
    if isinstance(hooks, list) and hooks:
        h0 = hooks[0]
        if isinstance(h0, dict):
            t = str(h0.get("text") or "").strip()
            if t:
                return t
    raw_vs = session.get("video_spec")
    if isinstance(raw_vs, dict):
        hk = raw_vs.get("hook")
        if isinstance(hk, dict):
            t = str(hk.get("text") or "").strip()
            if t:
                return t
    angles = session.get("angles") or []
    idx_raw = session.get("chosen_angle_index")
    try:
        idx = int(idx_raw) if idx_raw is not None else 0
    except (TypeError, ValueError):
        idx = 0
    if isinstance(angles, list) and 0 <= idx < len(angles) and isinstance(angles[idx], dict):
        return str(angles[idx].get("draft_hook") or "").strip()
    return ""


def _effective_format_key(session: Dict[str, Any]) -> str:
    raw = str(session.get("source_format_key") or "").strip()
    fk = canonicalize_stored_format_key(raw) or raw
    if not fk and str(session.get("source_type") or "").strip() == "url_adapt":
        return "text_overlay"
    return fk


def _background_kind(session: Dict[str, Any]) -> str:
    bg_type = str(session.get("background_type") or "").strip().lower()
    has_broll_id = bool(str(session.get("broll_clip_id") or "").strip())
    if bg_type == "broll" or (not bg_type and has_broll_id):
        return "video"
    return "image"


def _focal_default(session: Dict[str, Any]) -> str:
    raw = session.get("video_spec")
    if isinstance(raw, dict):
        bg = raw.get("background")
        if isinstance(bg, dict) and str(bg.get("focalPoint") or "").strip():
            return str(bg.get("focalPoint")).strip()
    return "center"


def brand_from_client_row(client_row: Optional[Dict[str, Any]]) -> VideoSpecBrand:
    if not client_row:
        return VideoSpecBrand(primary="#ffffff")
    raw = client_row.get("brand_theme")
    if not isinstance(raw, dict):
        return VideoSpecBrand(primary="#ffffff")
    p = str(raw.get("primary") or "").strip() or "#ffffff"
    a = str(raw.get("accent") or "").strip() or None
    return VideoSpecBrand(primary=p[:32], accent=a[:32] if a else None)


def default_theme_id_from_client(client_row: Optional[Dict[str, Any]]) -> str:
    if not client_row:
        return "bold-modern"
    raw = client_row.get("brand_theme")
    if not isinstance(raw, dict):
        return "bold-modern"
    tid = str(raw.get("defaultThemeId") or "").strip()
    if tid in ("bold-modern", "editorial", "casual-hand", "clean-minimal"):
        return tid
    return "bold-modern"


def build_default_video_spec(
    session: Dict[str, Any],
    *,
    client_row: Optional[Dict[str, Any]] = None,
    broll_duration_sec: Optional[float] = None,
) -> VideoSpecV1:
    """Hook + blocks timed by reading-speed heuristics (see video_spec_timing).

    When ``broll_duration_sec`` is provided AND the background is a video, we
    proportionally shrink block durations so the whole reel fits inside the
    clip (hook + pauses are left alone — the only knob we touch here is
    on-screen text time, which is otherwise an automatic reading-speed guess
    the user shouldn't have to fight).
    """
    hook_s = default_hook_duration_sec()
    lang = "de"
    if client_row and str(client_row.get("language") or "").strip():
        lang = str(client_row.get("language")).strip()[:8]
    hook_text = _session_hook_text(session)
    bg_url = str(session.get("background_url") or "").strip()
    if not bg_url:
        raise ValueError("session missing background_url")

    fk = _effective_format_key(session)
    template_id = template_id_for_format_key(fk, source_type=str(session.get("source_type") or ""))

    text_blocks = session.get("text_blocks") or []
    bg_kind = _background_kind(session)
    cap: Optional[float] = None
    if bg_kind == "video" and broll_duration_sec is not None:
        try:
            v = float(broll_duration_sec)
            if v > 0:
                cap = v
        except (TypeError, ValueError):
            cap = None

    rows: List[Dict[str, Any]] = []
    if isinstance(text_blocks, list):
        for b in text_blocks:
            if not isinstance(b, dict):
                continue
            t = str(b.get("text") or "").strip()
            if not t:
                continue
            rows.append({
                "id": str(b.get("id") or "").strip() or str(uuid.uuid4()),
                "text": t[:500],
                "isCTA": bool(b.get("isCTA")),
                "dur": block_read_duration_sec(t, language=lang),
            })

    # Multi-beat non–B-roll reels read better as separate stacked caption cards
    # (IG-style). B-roll keeps bottom-card from ``template_id_for_format_key``.
    if len(rows) >= 2 and template_id != "bottom-card":
        template_id = "stacked-cards"  # type: ignore[assignment]

    if cap is not None and rows:
        # Reserve hook + a 1s tail; pauses default to 0 here so blocks get the rest.
        available = max(MIN_BLOCK * len(rows), cap - float(hook_s))
        fitted = fit_block_durs_to_available([r["dur"] for r in rows], available)
        for r, d in zip(rows, fitted):
            r["dur"] = d

    blocks_out: List[VideoSpecBlock] = []
    gap = 0.0
    cursor = float(hook_s)
    for r in rows:
        cursor += gap
        start = cursor
        end = start + float(r["dur"])
        cursor = end
        anim: str = "pop" if r["isCTA"] else "fade"
        blocks_out.append(
            VideoSpecBlock(
                id=str(r["id"]),
                text=str(r["text"]),
                isCTA=bool(r["isCTA"]),
                startSec=start,
                endSec=end,
                animation=anim,  # type: ignore[arg-type]
            )
        )

    theme_id = default_theme_id_from_client(client_row)
    brand = brand_from_client_row(client_row)

    nominal_total = max(
        float(cursor + 1.0) if blocks_out else float(hook_s + 2.0),
        float(hook_s) + 0.5,
    )
    # When a B-roll cap is known, lock totalSec to the clip length so the
    # composition matches the underlying media exactly (no held-last-frame
    # tail from the +1s buffer above).
    target_total = float(cap) if cap is not None else nominal_total

    built = VideoSpecV1(
        v=1,
        templateId=template_id,  # type: ignore[arg-type]
        themeId=theme_id,  # type: ignore[arg-type]
        brand=brand,
        background=VideoSpecBackground(
            url=bg_url,
            kind=bg_kind,  # type: ignore[arg-type]
            focalPoint=_focal_default(session),  # type: ignore[arg-type]
            durationSec=cap,
        ),
        hook=VideoSpecHook(text=hook_text[:500], durationSec=hook_s),
        blocks=blocks_out,
        gapBetweenBlocksSec=gap,
        totalSec=target_total,
    )
    return relayout_spec(built)


def apply_live_session_fields(spec: VideoSpecV1, session: Dict[str, Any]) -> VideoSpecV1:
    """Keep background url/kind in sync with session (source of truth for assets)."""
    url = str(session.get("background_url") or "").strip()
    if not url:
        return spec
    kind = _background_kind(session)  # type: ignore[arg-type]
    bdur: Optional[float] = None
    if kind == "video":
        bdur = spec.background.durationSec
    return spec.model_copy(
        update={
            "background": VideoSpecBackground(
                url=url,
                kind=kind,
                focalPoint=spec.background.focalPoint,
                durationSec=bdur,
            )
        }
    )


def ensure_video_spec(
    session: Dict[str, Any],
    *,
    client_row: Optional[Dict[str, Any]] = None,
    broll_duration_sec: Optional[float] = None,
) -> VideoSpecV1:
    """Return stored valid spec or build default from session."""
    parsed = parse_video_spec(session.get("video_spec"))
    if parsed is not None:
        return apply_live_session_fields(parsed, session)
    return build_default_video_spec(
        session, client_row=client_row, broll_duration_sec=broll_duration_sec
    )


def video_spec_to_text_blocks(spec: VideoSpecV1) -> List[Dict[str, Any]]:
    return [{"text": b.text, "isCTA": b.isCTA} for b in spec.blocks]


def merge_primary_hook_into_hooks_array(
    existing_hooks: Any,
    hook_text: str,
    *,
    max_len: int = 500,
) -> Optional[List[Dict[str, Any]]]:
    """Build ``hooks`` row for Supabase after ``video_spec.hook`` changed.

    Slot 0 is the on-screen opener; we preserve ``hooks[1:]`` and any extra keys
    on ``hooks[0]``. Returns ``None`` when *hook_text* is blank so callers do not
    wipe legacy hooks with an empty PATCH."""
    t = str(hook_text or "").strip()[:max_len]
    if not t:
        return None
    raw = existing_hooks if isinstance(existing_hooks, list) else []
    out: List[Dict[str, Any]] = []
    for item in raw:
        if isinstance(item, dict):
            out.append(dict(item))
        else:
            out.append({})
    if not out:
        return [{"text": t}]
    out[0] = {**out[0], "text": t}
    return out


def persist_finalize_spec(
    supabase: Any,
    *,
    session_id: str,
    client_id: str,
    session_row: Dict[str, Any],
    client_row: Optional[Dict[str, Any]],
    updated_at_iso: str,
) -> None:
    """Write canonical video_spec from current session row (hooks, text_blocks, background)."""
    try:
        spec = finalize_spec_for_render(session_row, client_row=client_row, supabase=supabase)
    except ValueError:
        return
    supabase.table("generation_sessions").update(
        {"video_spec": spec.model_dump(mode="json"), "updated_at": updated_at_iso}
    ).eq("id", session_id).eq("client_id", client_id).execute()


def apply_visual_style_hints(spec: VideoSpecV1, session: Dict[str, Any]) -> VideoSpecV1:
    """Merge in-memory ``visual_style`` from content generation (template/theme/block animations/layout).

    Only fills in fields the user hasn't explicitly committed yet — once the spec
    has a non-default `layout`, we leave it alone so the LLM doesn't clobber the
    user's slider choices on subsequent regenerations.
    """
    raw = session.get("visual_style")
    if not isinstance(raw, dict):
        return spec
    valid_templates = {"bottom-card", "centered-pop", "top-banner", "capcut-highlight", "stacked-cards"}
    valid_themes = {"bold-modern", "editorial", "casual-hand", "clean-minimal"}
    valid_anims = {"pop", "fade", "slide-up", "none"}

    tid = str(raw.get("templateId") or "").strip()
    thid = str(raw.get("themeId") or "").strip()
    updates: Dict[str, Any] = {}
    if tid in valid_templates:
        updates["templateId"] = tid
    if thid in valid_themes:
        updates["themeId"] = thid

    anims = raw.get("blockAnimations")
    blocks = list(spec.blocks)
    if isinstance(anims, list) and anims and len(anims) == len(blocks):
        new_blocks: List[VideoSpecBlock] = []
        for i, b in enumerate(blocks):
            a = str(anims[i] if i < len(anims) else "").strip()
            anim = a if a in valid_anims else b.animation
            new_blocks.append(b.model_copy(update={"animation": anim}))  # type: ignore[arg-type]
        updates["blocks"] = new_blocks

    layout_hint = raw.get("layout")
    if isinstance(layout_hint, dict) and _is_default_layout(spec.layout):
        try:
            merged = VideoSpecLayout.model_validate({
                "verticalAnchor": layout_hint.get("verticalAnchor", spec.layout.verticalAnchor),
                "verticalOffset": layout_hint.get("verticalOffset", spec.layout.verticalOffset),
                "scale": layout_hint.get("scale", spec.layout.scale),
                "sidePadding": layout_hint.get("sidePadding", spec.layout.sidePadding),
                "textAlign": layout_hint.get("textAlign", spec.layout.textAlign),
                "stackGap": layout_hint.get("stackGap", spec.layout.stackGap),
                "stackGrowth": layout_hint.get("stackGrowth", spec.layout.stackGrowth),
            })
            updates["layout"] = merged
        except Exception:
            pass

    if updates:
        return spec.model_copy(update=updates)
    return spec


def hydrate_video_spec_broll_duration_if_needed(
    spec: VideoSpecV1,
    session: Dict[str, Any],
    supabase: Any,
) -> VideoSpecV1:
    """Fill ``background.durationSec`` when missing: ``broll_clips`` (incl. ffprobe on ``file_url``), else background URL."""
    if spec.background.kind != "video" or spec.background.durationSec is not None:
        return spec
    client_id = str(session.get("client_id") or "").strip()
    clip_id = str(session.get("broll_clip_id") or "").strip()
    dur: Optional[float] = None
    if clip_id and client_id and supabase is not None:
        dur = fetch_broll_duration_sec(supabase, client_id, clip_id)
    if dur is None:
        dur = probe_http_video_duration_sec(str(spec.background.url or "").strip())
    if dur is None or not math.isfinite(dur) or dur <= 0:
        return spec
    return relayout_spec(
        spec.model_copy(
            update={
                "background": spec.background.model_copy(update={"durationSec": float(dur)}),
            }
        )
    )


def persist_healed_session_video_spec_row(
    supabase: Any,
    *,
    client_id: str,
    session_id: str,
    row: Dict[str, Any],
) -> Dict[str, Any]:
    """Hydrate missing B-roll ``durationSec`` + relayout; persist when the spec changed."""
    from datetime import datetime, timezone

    raw = row.get("video_spec")
    if not isinstance(raw, dict) or supabase is None:
        return row
    parsed = parse_video_spec(raw)
    if parsed is None:
        return row
    healed = hydrate_video_spec_broll_duration_if_needed(parsed, row, supabase)
    if healed.background.durationSec == parsed.background.durationSec:
        return row
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "video_spec": healed.model_dump(mode="json"),
        "text_blocks": video_spec_to_text_blocks(healed),
        "updated_at": now,
    }
    supabase.table("generation_sessions").update(payload).eq("id", session_id).eq("client_id", client_id).execute()
    out = dict(row)
    out.update(payload)
    return out


def _is_default_layout(layout: VideoSpecLayout) -> bool:
    """Treat factory defaults as 'untouched' — used to gate LLM hints."""
    return (
        layout.verticalAnchor == "bottom"
        and layout.verticalOffset == 0.0
        and layout.scale == 1.0
        and layout.sidePadding == 0.05
        and layout.textAlign == "center"
        and abs(float(layout.stackGap) - 0.008) < 1e-9
        and layout.stackGrowth == "up"
    )


def finalize_spec_for_render(
    session: Dict[str, Any],
    *,
    client_row: Optional[Dict[str, Any]] = None,
    supabase: Any = None,
) -> VideoSpecV1:
    """Single source for CLI props: session text_blocks + hooks + background win over stale spec."""
    lang = "de"
    if client_row and str(client_row.get("language") or "").strip():
        lang = str(client_row.get("language")).strip()[:8]
    # Resolve B-roll duration up front so the *default* build can size blocks
    # to the clip; otherwise the very first preview overruns the clip and the
    # user has to manually shrink each block.
    client_id = str(session.get("client_id") or "").strip()
    clip_id = str(session.get("broll_clip_id") or "").strip()
    dur = fetch_broll_duration_sec(supabase, client_id, clip_id) if supabase else None
    spec = ensure_video_spec(session, client_row=client_row, broll_duration_sec=dur)
    tb = session.get("text_blocks")
    if isinstance(tb, list):
        rows = [x for x in tb if isinstance(x, dict)]
        if rows:
            spec = merge_text_blocks_into_spec(spec, rows, language=lang)
    ht = _session_hook_text(session)
    if ht:
        spec = spec.model_copy(update={"hook": spec.hook.model_copy(update={"text": ht[:500]})})
    spec = apply_visual_style_hints(spec, session)
    if spec.background.kind == "video":
        if dur is not None:
            spec = spec.model_copy(
                update={
                    "background": spec.background.model_copy(update={"durationSec": float(dur)}),
                }
            )
        else:
            spec = spec.model_copy(
                update={"background": spec.background.model_copy(update={"durationSec": None})}
            )
    else:
        spec = spec.model_copy(
            update={"background": spec.background.model_copy(update={"durationSec": None})}
        )
    spec = relayout_spec(spec)
    # Rows written before ``duration_s`` was populated still have null durationSec
    # in JSON — probe clip URL / background URL so relayout cap can run.
    spec = hydrate_video_spec_broll_duration_if_needed(spec, session, supabase)
    return apply_live_session_fields(spec, session)


def merge_text_blocks_into_spec(
    spec: VideoSpecV1,
    text_blocks: List[Dict[str, Any]],
    *,
    language: str = "de",
) -> VideoSpecV1:
    """Update spec blocks from legacy text_blocks; preserve ids when counts match, else re-time."""
    cleaned: List[Dict[str, Any]] = []
    for b in text_blocks[:12]:
        if not isinstance(b, dict):
            continue
        t = str(b.get("text") or "").strip()
        if not t:
            continue
        cleaned.append({"text": t, "isCTA": bool(b.get("isCTA"))})

    if not cleaned:
        return relayout_spec(spec.model_copy(update={"blocks": [], "pausesSec": None}))

    old = list(spec.blocks)
    lang = (language or "de").strip()[:8]
    new_blocks: List[VideoSpecBlock] = []
    hook_s = spec.hook.durationSec
    gap = clamp_gap(getattr(spec, "gapBetweenBlocksSec", 0.0) or 0.0)
    new_pauses: List[float]
    if len(cleaned) == len(old):
        if spec.pausesSec is not None and len(spec.pausesSec) == len(old):
            new_pauses = [clamp_gap(float(spec.pausesSec[i])) for i in range(len(cleaned))]  # type: ignore[index]
        else:
            new_pauses = [gap] * len(cleaned)
        for i, row in enumerate(cleaned):
            ob = old[i]
            anim = "pop" if row["isCTA"] else "fade"
            dur = max(1.0, round(float(ob.endSec - ob.startSec), 2))
            new_blocks.append(
                VideoSpecBlock(
                    id=ob.id,
                    text=row["text"][:500],
                    isCTA=row["isCTA"],
                    startSec=0.0,
                    endSec=float(dur),
                    animation=anim,  # type: ignore[arg-type]
                )
            )
    else:
        old_ps = spec.pausesSec if (spec.pausesSec is not None and len(spec.pausesSec) == len(old)) else None
        new_pauses = [
            clamp_gap(float(old_ps[i])) if old_ps is not None and i < len(old_ps) else gap
            for i in range(len(cleaned))
        ]
        # Reading-speed durations, then proportional-shrink to fit B-roll
        # cap (when known). Same logic as ``build_default_video_spec``: only
        # block on-screen time is auto-tuned, hook + pauses stay sacred.
        raw_durs = [block_read_duration_sec(r["text"], language=lang) for r in cleaned]
        cap_dur = (
            float(spec.background.durationSec)
            if spec.background.kind == "video" and spec.background.durationSec is not None
            else None
        )
        if cap_dur is not None and cap_dur > 0:
            available = max(MIN_BLOCK * len(raw_durs), cap_dur - float(hook_s) - sum(new_pauses))
            raw_durs = fit_block_durs_to_available(raw_durs, available)
        cursor = float(hook_s)
        for i, row in enumerate(cleaned):
            cursor += new_pauses[i]
            start = cursor
            end = start + float(raw_durs[i])
            cursor = end
            bid = str(old[i].id) if i < len(old) else str(uuid.uuid4())
            anim = "pop" if row["isCTA"] else "fade"
            new_blocks.append(
                VideoSpecBlock(
                    id=bid,
                    text=row["text"][:500],
                    isCTA=row["isCTA"],
                    startSec=start,
                    endSec=end,
                    animation=anim,  # type: ignore[arg-type]
                )
            )
    merged = spec.model_copy(update={"blocks": new_blocks, "pausesSec": new_pauses, "gapBetweenBlocksSec": gap})
    return relayout_spec(merged)


def fit_spec_blocks_to_broll(spec: VideoSpecV1) -> VideoSpecV1:
    """Shrink each block's on-screen duration so hook + pauses + blocks ≤ clip.

    Hook and ``pausesSec`` are unchanged. ``totalSec`` becomes the clip length
    when the timeline fits; otherwise raises ``ValueError`` (hook + gaps too
    large for the B-roll).
    """
    if spec.background.kind != "video" or spec.background.durationSec is None:
        raise ValueError("Fit-to-B-roll requires a video background with durationSec set.")
    cap = float(spec.background.durationSec)
    if cap <= 0:
        raise ValueError("Invalid B-roll duration.")

    blocks_sorted = sorted(spec.blocks, key=lambda b: b.startSec)
    n = len(blocks_sorted)
    if n == 0:
        return relayout_spec(spec.model_copy(update={"totalSec": cap}))

    h = float(spec.hook.durationSec)
    pauses = effective_pauses_sec(spec, n)
    pause_sum = sum(pauses)
    needed_min = h + pause_sum + MIN_BLOCK * float(n)
    if needed_min > cap + 0.05:
        raise ValueError(
            f"Hook + gaps need at least {needed_min:.1f}s but the clip is {cap:.1f}s. "
            "Shorten the hook or reduce gaps, then try again."
        )

    durs = [max(MIN_BLOCK, round(float(b.endSec - b.startSec), 4)) for b in blocks_sorted]
    available = max(MIN_BLOCK * n, cap - h - pause_sum)
    new_durs = fit_block_durs_to_available([float(x) for x in durs], float(available))

    new_blocks: List[VideoSpecBlock] = []
    for i, ob in enumerate(blocks_sorted):
        dur = new_durs[i] if i < len(new_durs) else MIN_BLOCK
        new_blocks.append(ob.model_copy(update={"startSec": 0.0, "endSec": float(dur)}))

    merged = spec.model_copy(update={"blocks": new_blocks, "totalSec": cap})
    return relayout_spec(merged)
