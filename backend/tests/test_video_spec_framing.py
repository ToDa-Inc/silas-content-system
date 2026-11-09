import pytest

from models.video_spec import validate_video_spec_dict
from services.video_spec_patch import apply_ops_to_spec

BASE = {
    "v": 1,
    "background": {"url": "https://example.com/a.mp4", "kind": "video", "focalPoint": "center"},
    "hook": {"text": "Hook", "durationSec": 2},
    "blocks": [{"id": "b1", "text": "Beat", "isCTA": False, "startSec": 2, "endSec": 4}],
    "totalSec": 8,
}


def test_framing_defaults_to_full_for_existing_specs():
    assert validate_video_spec_dict(dict(BASE)).framing == "full"


@pytest.mark.parametrize("framing", ["letterbox", "four_five", "full"])
def test_patch_framing_keeps_text_timing(framing):
    out = apply_ops_to_spec(dict(BASE), [{"op": "replace", "path": "/framing", "value": framing}])
    assert out.framing == framing
    assert out.blocks[0].startSec == 2 and out.blocks[0].endSec == 4


def test_patch_crop_focal_point():
    out = apply_ops_to_spec(
        {**BASE, "framing": "letterbox"},
        [{"op": "replace", "path": "/background/focalPoint", "value": "top"}],
    )
    assert out.background.focalPoint == "top"
    assert out.framing == "letterbox"


def test_unknown_framing_is_rejected():
    with pytest.raises(ValueError):
        apply_ops_to_spec(dict(BASE), [{"op": "replace", "path": "/framing", "value": "square"}])
