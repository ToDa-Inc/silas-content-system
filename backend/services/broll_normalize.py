"""Transcode uploaded B-roll to a deterministic render master (H.264 CFR 30fps)."""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from typing import Any, Dict, Optional, Tuple

import httpx

from core.config import Settings
from services.video_probe import ffprobe_duration_seconds_path

logger = logging.getLogger(__name__)

BROLL_BUCKET = "broll"
RENDER_MASTER_FPS = 30
RENDER_MASTER_CRF = 16
NORMALIZE_STATUS_READY = "ready"
NORMALIZE_STATUS_FAILED = "failed"
NORMALIZE_STATUS_PENDING = "pending"
NORMALIZE_STATUS_PROCESSING = "processing"


def broll_playback_url(clip: Dict[str, Any]) -> str:
    """URL used for preview + Remotion render — prefer normalized master."""
    master = str(clip.get("master_url") or "").strip()
    if master:
        return master
    return str(clip.get("file_url") or "").strip()


def broll_duration_from_row(clip: Dict[str, Any]) -> Optional[float]:
    raw = clip.get("duration_sec")
    if raw is None:
        raw = clip.get("duration_s")
    if raw is None or raw == "":
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def _public_object_url(supabase_url: str, bucket: str, path: str) -> str:
    base = supabase_url.rstrip("/")
    return f"{base}/storage/v1/object/public/{bucket}/{path}"


def transcode_render_master(input_path: str, output_path: str) -> float:
    """FFmpeg: strip audio, CFR 30fps, H.264 yuv420p, faststart. Returns duration seconds."""
    vf = f"fps={RENDER_MASTER_FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2"
    proc = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            input_path,
            "-an",
            "-vf",
            vf,
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            str(RENDER_MASTER_CRF),
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            output_path,
        ],
        capture_output=True,
        text=True,
        timeout=600,
    )
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "")[-2000:]
        raise RuntimeError(f"ffmpeg transcode failed (exit {proc.returncode}): {tail}")
    dur = ffprobe_duration_seconds_path(output_path)
    if dur is None or dur <= 0:
        raise RuntimeError("ffmpeg produced a file with no readable duration")
    return float(dur)


def _download_url(url: str, *, timeout: float = 180.0) -> bytes:
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        r = client.get(url)
    if r.status_code != 200 or not r.content:
        raise RuntimeError(f"Failed to download B-roll ({r.status_code})")
    return r.content


def normalize_broll_clip_row(
    settings: Settings,
    supabase: Any,
    *,
    client_id: str,
    clip_id: str,
) -> Tuple[str, float]:
    """Ensure ``master_url`` exists; return (playback_url, duration_sec)."""
    res = (
        supabase.table("broll_clips")
        .select("id, client_id, file_url, master_url, normalize_status, duration_sec, duration_s")
        .eq("id", clip_id)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise ValueError("B-roll clip not found")
    clip = dict(res.data[0])
    playback = broll_playback_url(clip)
    if not playback:
        raise ValueError("B-roll clip has no file_url")

    status = str(clip.get("normalize_status") or "").strip().lower()
    if clip.get("master_url") and status == NORMALIZE_STATUS_READY:
        dur = broll_duration_from_row(clip)
        if dur is not None:
            return playback, dur

    file_url = str(clip.get("file_url") or "").strip()
    if not file_url:
        raise ValueError("B-roll clip has no file_url")

    supabase.table("broll_clips").update(
        {"normalize_status": NORMALIZE_STATUS_PROCESSING}
    ).eq("id", clip_id).eq("client_id", client_id).execute()

    in_path = ""
    out_path = ""
    try:
        data = _download_url(file_url)
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as inf:
            inf.write(data)
            in_path = inf.name
        out_path = in_path.replace(".mp4", "_master.mp4")
        duration = transcode_render_master(in_path, out_path)
        with open(out_path, "rb") as f:
            master_bytes = f.read()
        master_storage_path = f"{client_id}/{clip_id}_master.mp4"
        supabase.storage.from_(BROLL_BUCKET).upload(
            master_storage_path,
            master_bytes,
            {"content-type": "video/mp4", "upsert": "true"},
        )
        master_url = _public_object_url(settings.supabase_url, BROLL_BUCKET, master_storage_path)
        duration_rounded = round(duration, 3)
        supabase.table("broll_clips").update(
            {
                "master_url": master_url,
                "normalize_status": NORMALIZE_STATUS_READY,
                "duration_sec": duration_rounded,
                "duration_s": int(round(duration)),
            }
        ).eq("id", clip_id).eq("client_id", client_id).execute()
        return master_url, duration_rounded
    except Exception as e:
        logger.exception("broll normalize failed clip_id=%s", clip_id)
        try:
            supabase.table("broll_clips").update(
                {"normalize_status": NORMALIZE_STATUS_FAILED}
            ).eq("id", clip_id).eq("client_id", client_id).execute()
        except Exception:
            pass
        raise RuntimeError(f"B-roll normalize failed: {e}") from e
    finally:
        for p in (in_path, out_path):
            if p:
                try:
                    os.unlink(p)
                except OSError:
                    pass


def ensure_session_broll_master(
    settings: Settings,
    supabase: Any,
    session: Dict[str, Any],
) -> None:
    """When session uses a B-roll clip, normalize it and point ``background_url`` at the master."""
    clip_id = str(session.get("broll_clip_id") or "").strip()
    client_id = str(session.get("client_id") or "").strip()
    if not clip_id or not client_id:
        return

    playback, _dur = normalize_broll_clip_row(
        settings, supabase, client_id=client_id, clip_id=clip_id
    )
    session["background_url"] = playback
