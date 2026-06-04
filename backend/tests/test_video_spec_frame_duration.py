"""Frame-accurate composition length — no ceil(totalSec * 30) off-by-one."""

from __future__ import annotations

from models.video_spec import VideoSpecBackground, VideoSpecV1, frame_to_sec, playable_background_frames
from services.video_spec_timeline import clamp_spec_to_video_frames


def _spec_with_broll(*, frames: int, total_sec: float | None = None) -> VideoSpecV1:
    bg = VideoSpecBackground(
        url="https://example.com/master.mp4",
        kind="video",
        durationSec=frame_to_sec(frames),
        durationFrames=frames,
    )
    return VideoSpecV1.model_validate(
        {
            "v": 1,
            "templateId": "centered-pop",
            "themeId": "bold-modern",
            "brand": {"primary": "#fff"},
            "background": bg.model_dump(mode="json"),
            "hook": {"text": "Hook", "durationSec": 2.0},
            "blocks": [
                {
                    "id": "b1",
                    "text": "Beat",
                    "isCTA": False,
                    "startSec": 2.0,
                    "endSec": 8.0,
                    "animation": "fade",
                }
            ],
            "totalSec": total_sec if total_sec is not None else frame_to_sec(frames) + 0.01,
        }
    )


def test_215_frames_not_216_composition() -> None:
    """7.17s container must not become 216 frames via ceil."""
    frames = 215
    assert playable_background_frames(
        VideoSpecBackground(
            url="https://x.mp4",
            kind="video",
            durationSec=7.17,
            durationFrames=frames,
        )
    ) == 215
    assert frame_to_sec(215) == 215 / 30
    assert round(7.17 * 30) == 215
    assert __import__("math").ceil(7.17 * 30) == 216


def test_clamp_spec_sets_exact_total_sec() -> None:
    spec = _spec_with_broll(frames=215, total_sec=7.2)
    out = clamp_spec_to_video_frames(spec)
    assert out.totalSec == frame_to_sec(215)
    assert out.blocks[0].endSec <= out.totalSec


def test_finalize_validator_uses_frames_not_ceil() -> None:
    spec = _spec_with_broll(frames=100, total_sec=99.0)
    validated = VideoSpecV1.model_validate(spec.model_dump(mode="json"))
    assert validated.totalSec == frame_to_sec(100)
