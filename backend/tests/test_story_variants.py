from unittest.mock import patch

from services.content_generation import run_carousel_copy_package, run_regenerate, run_story_variants

SETTINGS = type("Settings", (), {"openrouter_api_key": "key", "openrouter_model": "model"})()
CLIENT_EN = {"name": "Conny", "language": "en", "client_dna": {"voice_brief": "Direct."}}
ANGLE = {"title": "Meeting confidence", "draft_hook": "They talked over you again."}
HOOKS = [{"text": "They talked over you again."}]


def test_run_story_variants_returns_three_and_asks_for_high_reasoning():
    seen = {}

    def fake(*args, **kwargs):
        seen.update(kwargs)
        return {"story_variants": ["One", "Two", "Three", "Four"]}

    with patch("services.content_generation.chat_json_completion", side_effect=fake):
        out = run_story_variants(
            SETTINGS, client_row=CLIENT_EN, chosen_angle=ANGLE, hooks=HOOKS, caption_body="Caption"
        )
    assert out == ["One", "Two", "Three"]
    assert seen["reasoning_effort"] == "high"
    assert "They talked over you again." in seen["user"]
    assert "Caption" in seen["user"]


def test_regenerate_story_scope_only_changes_stories():
    def fake(*args, **kwargs):
        assert "PREVIOUS_STORY_LINES" in kwargs["user"]
        return {"story_variants": ["New A", "New B", "New C"]}

    with patch("services.content_generation.chat_json_completion", side_effect=fake):
        out = run_regenerate(
            SETTINGS,
            client_row=CLIENT_EN,
            synthesized_patterns={},
            chosen_angle=ANGLE,
            scope="story",
            feedback=None,
            current_hooks=HOOKS,
            current_script="Script",
            current_caption="Caption",
            current_hashtags=["#a"],
            current_stories=["Old"],
            source_format_key="talking_head",
        )
    assert out["story_variants"] == ["New A", "New B", "New C"]
    assert out["hooks"] == HOOKS
    assert out["script"] == "Script"
    assert out["caption_body"] == "Caption"
    assert out["hashtags"] == ["#a"]


def test_package_gets_stories_and_story_failure_does_not_break_it():
    calls = []

    def fake(*args, **kwargs):
        calls.append(kwargs["user"])
        if "IG Story texts" in kwargs["user"] or "Instagram Story texts" in kwargs["user"]:
            raise RuntimeError("story model down")
        return {"hooks": [{"text": "Hook"}], "caption_body": "Cap", "hashtags": ["#x"]}

    with patch("services.content_generation.chat_json_completion", side_effect=fake):
        out = run_carousel_copy_package(
            SETTINGS, client_row=CLIENT_EN, synthesized_patterns={}, chosen_angle=ANGLE
        )
    assert out["caption_body"] == "Cap"
    assert out["story_variants"] == []
    assert len(calls) == 2

    def fake_ok(*args, **kwargs):
        if "Instagram Story texts" in kwargs["user"]:
            return {"story_variants": ["S1", "S2", "S3"]}
        return {"hooks": [{"text": "Hook"}], "caption_body": "Cap", "hashtags": ["#x"]}

    with patch("services.content_generation.chat_json_completion", side_effect=fake_ok):
        out = run_carousel_copy_package(
            SETTINGS, client_row=CLIENT_EN, synthesized_patterns={}, chosen_angle=ANGLE
        )
    assert out["story_variants"] == ["S1", "S2", "S3"]
