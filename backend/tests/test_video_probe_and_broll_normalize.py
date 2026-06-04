"""Unit tests for render verification and broll URL helpers."""

from __future__ import annotations

from services.broll_normalize import broll_duration_from_row, broll_playback_url
from services.video_probe import _parse_fps


def test_broll_playback_url_prefers_master() -> None:
    assert (
        broll_playback_url(
            {"file_url": "https://x/original.mp4", "master_url": "https://x/master.mp4"}
        )
        == "https://x/master.mp4"
    )
    assert broll_playback_url({"file_url": "https://x/original.mp4"}) == "https://x/original.mp4"


def test_broll_duration_from_row_prefers_duration_sec() -> None:
    assert broll_duration_from_row({"duration_sec": 7.12, "duration_s": 8}) == 7.12
    assert broll_duration_from_row({"duration_s": 8}) == 8.0


def test_parse_fps_fraction() -> None:
    assert _parse_fps("30/1") == 30.0
    assert _parse_fps("30000/1001") is not None
