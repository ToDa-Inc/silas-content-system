"""ffprobe helpers for B-roll ingest and rendered MP4 verification."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from typing import Any, Dict, Optional

COMPOSITION_FPS = 30
COMPOSITION_WIDTH = 1080
COMPOSITION_HEIGHT = 1920


def ffprobe_duration_seconds(video_bytes: bytes) -> Optional[float]:
    """Return container duration in seconds, or None if ffprobe unavailable."""
    path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as vf:
            vf.write(video_bytes)
            path = vf.name
        return ffprobe_duration_seconds_path(path)
    except OSError:
        return None
    finally:
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass


def ffprobe_duration_seconds_path(path: str) -> Optional[float]:
    proc = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        capture_output=True,
        text=True,
        timeout=45,
    )
    if proc.returncode != 0:
        return None
    s = (proc.stdout or "").strip()
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if v > 0 else None


def ffprobe_video_stream(path: str) -> Optional[Dict[str, Any]]:
    """Best-effort video stream + format metadata from a file on disk."""
    proc = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,width,height,avg_frame_rate,r_frame_rate,pix_fmt",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            path,
        ],
        capture_output=True,
        text=True,
        timeout=45,
    )
    if proc.returncode != 0:
        return None
    try:
        data = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        return None
    streams = data.get("streams") or []
    fmt = data.get("format") or {}
    if not streams:
        return None
    st = streams[0]
    dur_raw = fmt.get("duration")
    try:
        duration = float(dur_raw) if dur_raw is not None else None
    except (TypeError, ValueError):
        duration = None
    return {
        "codec": st.get("codec_name"),
        "width": st.get("width"),
        "height": st.get("height"),
        "avg_frame_rate": st.get("avg_frame_rate"),
        "r_frame_rate": st.get("r_frame_rate"),
        "pix_fmt": st.get("pix_fmt"),
        "duration_sec": duration,
    }


def _parse_fps(rate: Any) -> Optional[float]:
    if rate is None:
        return None
    s = str(rate).strip()
    if not s or s == "0/0":
        return None
    if "/" in s:
        num, den = s.split("/", 1)
        try:
            n = float(num)
            d = float(den)
        except ValueError:
            return None
        if d <= 0:
            return None
        return n / d
    try:
        return float(s)
    except ValueError:
        return None


def verify_render_output_mp4(
    path: str,
    *,
    expected_duration_sec: float,
    duration_tolerance_sec: float = 0.35,
) -> Dict[str, Any]:
    """Assert the rendered file is IG-safe; return a small manifest dict."""
    meta = ffprobe_video_stream(path)
    if not meta:
        raise ValueError("ffprobe could not read rendered MP4")

    duration = meta.get("duration_sec")
    if duration is None or duration <= 0:
        raise ValueError("Rendered MP4 has no duration")

    if abs(float(duration) - float(expected_duration_sec)) > duration_tolerance_sec:
        raise ValueError(
            f"Rendered duration {duration:.2f}s differs from spec totalSec "
            f"{expected_duration_sec:.2f}s by more than {duration_tolerance_sec}s"
        )

    width = int(meta.get("width") or 0)
    height = int(meta.get("height") or 0)
    if width != COMPOSITION_WIDTH or height != COMPOSITION_HEIGHT:
        raise ValueError(f"Rendered dimensions {width}x{height}, expected {COMPOSITION_WIDTH}x{COMPOSITION_HEIGHT}")

    pix = str(meta.get("pix_fmt") or "")
    if pix and pix != "yuv420p":
        raise ValueError(f"Rendered pix_fmt {pix!r}, expected yuv420p")

    fps = _parse_fps(meta.get("avg_frame_rate")) or _parse_fps(meta.get("r_frame_rate"))
    if fps is not None and abs(fps - COMPOSITION_FPS) > 0.6:
        raise ValueError(f"Rendered fps ~{fps:.2f}, expected {COMPOSITION_FPS}")

    codec = str(meta.get("codec") or "")
    if codec and codec not in ("h264", "avc1"):
        raise ValueError(f"Rendered codec {codec!r}, expected h264")

    return {
        "duration_sec": round(float(duration), 3),
        "width": width,
        "height": height,
        "pix_fmt": pix,
        "codec": codec,
        "fps": round(fps, 3) if fps is not None else None,
        "expected_duration_sec": round(float(expected_duration_sec), 3),
    }
