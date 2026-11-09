from services.content_generation import _pack_client_row_for_llm
from services.learning_context import format_learning_block, has_learning

CTX = {
    "winners": [{"hook": "Nett sein macht dich unsichtbar.", "format": "talking_head", "reason": "Views 4.9× median → Scale it"}],
    "avoid": [{"hook": "Sag genau DAS", "reason": "Views 0.6× median · engagement/view 0.8× → Retire"}],
    "weak_hooks": [{"hook": "Du schreibst inzwischen Gespräche mit", "reason": "Views 0.2× median → Adjust hook"}],
    "weak_ctas": [{"hook": "x", "cta": "Kommentiere „Freiheit“", "reason": "comments/view 0.5× → Adjust CTA"}],
    "liked": [{"kind": "hook", "text": "Warum Logik in toxischen Gesprächen nicht hilft"}],
    "rejected": [{"kind": "angle", "text": "Chef-Bashing"}],
    "trace": {},
}


def test_empty_or_disabled_learning_adds_nothing():
    assert format_learning_block(None) == ""
    empty = {k: [] for k in ("winners", "avoid", "weak_hooks", "weak_ctas", "liked", "rejected")}
    assert not has_learning(empty)
    assert format_learning_block(empty) == ""


def test_block_targets_each_bucket_at_its_part():
    block = format_learning_block(CTX)
    assert "WINNERS (do more of this)" in block and "Nett sein macht dich unsichtbar." in block
    assert "HOOKS_THAT_DID_NOT_STOP_THE_SCROLL" in block
    assert "CTAS_THAT_UNDERPERFORMED" in block and "Kommentiere „Freiheit“" in block
    assert "AVOID" in block and "REJECTED_BY_THE_TEAM" in block and "Chef-Bashing" in block
    assert "never copy lines word for word" in block


def test_block_reaches_every_prompt_via_client_context():
    packed = _pack_client_row_for_llm({"name": "Conny", "language": "de", "_learning": CTX})
    assert "=== LEARNING" in packed
    assert "=== LEARNING" not in _pack_client_row_for_llm({"name": "Conny", "language": "de"})


def test_learning_block_sits_before_large_json_sections():
    packed = _pack_client_row_for_llm({"name": "Conny", "language": "de", "icp": {"x": "y" * 50_000}, "_learning": CTX})
    assert packed.index("=== LEARNING") < packed.index("=== ICP (JSON)")
    # Survives the 60k slice used by the story prompt.
    assert "=== LEARNING" in packed[:60_000]
