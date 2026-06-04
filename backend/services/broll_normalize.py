"""Transcode uploaded B-roll to a deterministic render master (H.264 CFR 30fps)."""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from typing import Any, Dict, Optional, Tuple

import httpx

from core.config import Settings
from services.video_probe import (
    COMPOSITION_FPS,
    COMPOSITION_HEIGHT,
    COMPOSITION_WIDTH,
    ffprobe_video_frame_count,
    frame_to_sec,
)

logger = logging.getLogger(__name__)

BROLL_BUCKET = "broll"
RENDER_MASTER_FPS = 30
RENDER_MASTER_CRF = 20
# Supabase Storage default per-object limit is 50 MB; stay under for upload headroom.
MAX_MASTER_UPLOAD_BYTES = 48 * 1024 * 1024
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


def broll_frames_from_row(clip: Dict[str, Any]) -> Optional[int]:
    raw = clip.get("duration_frames")
    if raw is not None:
        try:
            n = int(raw)
        except (TypeError, ValueError):
            n = 0
        if n > 0:
            return n
    dur = broll_duration_from_row(clip)
    if dur is None:
        return None
    return max(1, round(dur * COMPOSITION_FPS))


def broll_duration_from_row(clip: Dict[str, Any]) -> Optional[float]:
    frames = clip.get("duration_frames")
    if frames is not None:
        try:
            n = int(frames)
        except (TypeError, ValueError):
            n = 0
        if n > 0:
            return frame_to_sec(n)
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


def _render_master_vf() -> str:
    """Cover-crop to composition (1080×1920) — matches Remotion ``object-fit: cover``."""
    w, h = COMPOSITION_WIDTH, COMPOSITION_HEIGHT
    return (
        f"fps={RENDER_MASTER_FPS},"
        f"scale={w}:{h}:force_original_aspect_ratio=increase,"
        f"crop={w}:{h},"
        "setsar=1"
    )


def transcode_render_master(
    input_path: str,
    output_path: str,
    *,
    crf: int = RENDER_MASTER_CRF,
    maxrate: str = "5M",
) -> Tuple[int, float]:
    """FFmpeg: strip audio, CFR 30fps, H.264 yuv420p, faststart. Returns (frames, seconds)."""
    vf = _render_master_vf()
    bufsize = "10M" if maxrate == "5M" else "6M"
    proc = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            input_path,
            "-an",
            "-vf",
            vf,
            "-r",
            str(RENDER_MASTER_FPS),
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            str(crf),
            "-maxrate",
            maxrate,
            "-bufsize",
            bufsize,
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
    frames = ffprobe_video_frame_count(output_path)
    if frames is None or frames <= 0:
        raise RuntimeError("ffmpeg produced a file with no readable frame count")
    return frames, frame_to_sec(frames)


def _download_url(url: str, *, timeout: float = 180.0) -> bytes:
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        r = client.get(url)
    if r.status_code != 200 or not r.content:
        raise RuntimeError(f"Failed to download B-roll ({r.status_code})")
    return r.content


def _load_source_bytes(
    supabase: Any, *, client_id: str, clip_id: str, file_url: str
) -> bytes:
    """Prefer Storage API download (same bucket) over HTTP re-fetch."""
    storage_path = f"{client_id}/{clip_id}.mp4"
    try:
        data = supabase.storage.from_(BROLL_BUCKET).download(storage_path)
        if data:
            return bytes(data)
    except Exception:
        pass
    return _download_url(file_url)


def _storage_upload_file(
    supabase: Any,
    *,
    bucket: str,
    object_path: str,
    local_path: str,
    content_type: str,
) -> None:
    with open(local_path, "rb") as fh:
        supabase.storage.from_(bucket).upload(
            object_path,
            fh,
            {"content-type": content_type, "upsert": "true"},
        )


def _transcode_master_for_upload(in_path: str, out_path: str) -> Tuple[int, float]:
    """Transcode; retry with tighter caps if the master would exceed Storage limits."""
    frames, duration = transcode_render_master(in_path, out_path)
    try:
        size = os.path.getsize(out_path)
    except OSError:
        size = 0
    if size <= MAX_MASTER_UPLOAD_BYTES:
        return frames, duration
    logger.warning(
        "broll master %s MB exceeds %s MB — re-encoding with tighter bitrate",
        round(size / (1024 * 1024), 1),
        MAX_MASTER_UPLOAD_BYTES // (1024 * 1024),
    )
    frames, duration = transcode_render_master(in_path, out_path, crf=26, maxrate="3M")
    size = os.path.getsize(out_path)
    if size > MAX_MASTER_UPLOAD_BYTES:
        mb = round(size / (1024 * 1024), 1)
        cap = MAX_MASTER_UPLOAD_BYTES // (1024 * 1024)
        raise RuntimeError(
            f"Normalized master is {mb} MB (storage limit {cap} MB). "
            "Use a shorter clip or upload at 1080p or lower."
        )
    return frames, duration


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
        .select(
            "id, client_id, file_url, master_url, normalize_status, "
            "duration_frames, duration_sec, duration_s"
        )
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
        data = _load_source_bytes(
            supabase, client_id=client_id, clip_id=clip_id, file_url=file_url
        )
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as inf:
            inf.write(data)
            in_path = inf.name
        out_path = in_path.replace(".mp4", "_master.mp4")
        frames, duration = _transcode_master_for_upload(in_path, out_path)
        master_storage_path = f"{client_id}/{clip_id}_master.mp4"
        try:
            _storage_upload_file(
                supabase,
                bucket=BROLL_BUCKET,
                object_path=master_storage_path,
                local_path=out_path,
                content_type="video/mp4",
            )
        except Exception as upload_err:
            err_s = str(upload_err)
            if "413" in err_s or "Payload too large" in err_s:
                raise RuntimeError(
                    "Normalized master exceeds Supabase Storage size limit (~50 MB). "
                    "Use a shorter clip or upload at 1080p or lower."
                ) from upload_err
            raise
        master_url = _public_object_url(settings.supabase_url, BROLL_BUCKET, master_storage_path)
        supabase.table("broll_clips").update(
            {
                "master_url": master_url,
                "normalize_status": NORMALIZE_STATUS_READY,
                "duration_frames": int(frames),
                "duration_sec": frame_to_sec(frames),
                "duration_s": int(round(duration)),
            }
        ).eq("id", clip_id).eq("client_id", client_id).execute()
        return master_url, frame_to_sec(frames)
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
