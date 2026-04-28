from services.video_spec_patch import apply_ops_to_spec
from services.video_spec_defaults import finalize_spec_for_render


def _base_spec():
    return {
        "v": 1,
        "templateId": "centered-pop",
        "themeId": "bold-modern",
        "appearance": {},
        "brand": {"primary": "#fff", "accent": None},
        "background": {
            "url": "https://example.com/bg.mp4",
            "kind": "video",
            "focalPoint": "center",
            "durationSec": 7,
        },
        "hook": {"text": "Hook text", "durationSec": 5.5},
        "blocks": [
            {
                "id": "cta",
                "text": "CTA text",
                "isCTA": True,
                "startSec": 5.8,
                "endSec": 7.0,
                "animation": "pop",
            }
        ],
        "layout": {
            "verticalAnchor": "bottom",
            "verticalOffset": 0,
            "scale": 1,
            "sidePadding": 0.05,
            "textAlign": "center",
            "stackGap": 0.008,
            "stackGrowth": "up",
        },
        "gapBetweenBlocksSec": 0,
        "pausesSec": [0.3],
        "totalSec": 7,
    }


def test_explicit_block_timings_survive_spec_patch():
    spec = apply_ops_to_spec(
        _base_spec(),
        [
            {"op": "replace", "path": "/blocks/0/startSec", "value": 2.6},
            {"op": "replace", "path": "/blocks/0/endSec", "value": 5.2},
        ],
    )

    block = spec.blocks[0]
    assert block.startSec == 2.6
    assert block.endSec == 5.2
    assert spec.hook.durationSec == 5.5


def test_finalize_spec_preserves_existing_layer_windows_when_text_matches():
    edited = dict(_base_spec())
    edited["blocks"] = [dict(edited["blocks"][0], startSec=2.6, endSec=5.2)]
    edited["pausesSec"] = [0]
    session = {
        "client_id": "client-1",
        "background_url": "https://example.com/bg.mp4",
        "background_type": "broll",
        "hooks": [{"text": "Hook text"}],
        "text_blocks": [{"text": "CTA text", "isCTA": True}],
        "video_spec": edited,
    }

    spec = finalize_spec_for_render(session)

    block = spec.blocks[0]
    assert spec.hook.durationSec == 5.5
    assert block.startSec == 2.6
    assert block.endSec == 5.2


def test_explicit_block_timing_can_span_long_source_video():
    spec_dict = _base_spec()
    spec_dict["background"] = dict(spec_dict["background"], durationSec=300)
    spec_dict["totalSec"] = 300

    spec = apply_ops_to_spec(
        spec_dict,
        [
            {"op": "replace", "path": "/blocks/0/startSec", "value": 0},
            {"op": "replace", "path": "/blocks/0/endSec", "value": 300},
            {"op": "replace", "path": "/totalSec", "value": 300},
        ],
    )

    block = spec.blocks[0]
    assert block.startSec == 0
    assert block.endSec == 300
    assert spec.totalSec == 300


def test_explicit_block_timing_is_capped_to_source_video_duration():
    spec = apply_ops_to_spec(
        _base_spec(),
        [
            {"op": "replace", "path": "/blocks/0/startSec", "value": 0},
            {"op": "replace", "path": "/blocks/0/endSec", "value": 30},
            {"op": "replace", "path": "/totalSec", "value": 30},
        ],
    )

    block = spec.blocks[0]
    assert block.startSec == 0
    assert block.endSec == 7
    assert spec.totalSec == 7


def test_explicit_hook_timing_is_capped_to_source_video_duration():
    spec = apply_ops_to_spec(
        _base_spec(),
        [
            {"op": "replace", "path": "/hook/durationSec", "value": 30},
            {"op": "replace", "path": "/totalSec", "value": 30},
        ],
    )

    assert spec.hook.durationSec == 7
    assert spec.totalSec == 7


if __name__ == "__main__":
    test_explicit_block_timings_survive_spec_patch()
    test_finalize_spec_preserves_existing_layer_windows_when_text_matches()
    test_explicit_block_timing_can_span_long_source_video()
    test_explicit_block_timing_is_capped_to_source_video_duration()
    test_explicit_hook_timing_is_capped_to_source_video_duration()
