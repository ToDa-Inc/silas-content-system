"""Deleting text_blocks must not re-time surviving video_spec beats."""

from __future__ import annotations

from models.video_spec import VideoSpecBlock, VideoSpecV1
from services.video_spec_defaults import merge_text_blocks_into_spec


def _spec_with_two_blocks() -> VideoSpecV1:
    return VideoSpecV1.model_validate(
        {
            "v": 1,
            "templateId": "centered-pop",
            "themeId": "bold-modern",
            "brand": {"primary": "#fff"},
            "background": {
                "url": "https://example.com/v.mp4",
                "kind": "video",
                "focalPoint": "center",
                "durationSec": 20.0,
            },
            "hook": {"text": "Hook", "durationSec": 2.0},
            "blocks": [
                {
                    "id": "b1",
                    "text": "Beat one",
                    "isCTA": False,
                    "startSec": 2.5,
                    "endSec": 5.0,
                    "animation": "fade",
                },
                {
                    "id": "b2",
                    "text": "Beat two",
                    "isCTA": True,
                    "startSec": 5.2,
                    "endSec": 8.0,
                    "animation": "pop",
                },
            ],
            "pausesSec": [0.5, 0.2],
            "totalSec": 8.0,
        }
    )


def test_delete_middle_block_preserves_other_timings() -> None:
    spec = _spec_with_two_blocks()
    out = merge_text_blocks_into_spec(
        spec,
        [{"text": "Beat one", "isCTA": False}],
    )
    assert len(out.blocks) == 1
    b = out.blocks[0]
    assert b.id == "b1"
    assert b.startSec == 2.5
    assert b.endSec == 5.0


def test_same_count_preserves_start_and_end() -> None:
    spec = _spec_with_two_blocks()
    out = merge_text_blocks_into_spec(
        spec,
        [
            {"text": "Beat one edited", "isCTA": False},
            {"text": "Beat two", "isCTA": True},
        ],
    )
    assert out.blocks[0].startSec == 2.5
    assert out.blocks[0].endSec == 5.0
    assert out.blocks[0].text == "Beat one edited"
    assert out.blocks[1].startSec == 5.2
    assert out.blocks[1].endSec == 8.0
