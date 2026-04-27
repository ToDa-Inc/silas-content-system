"""UX provenance bucket for scraped reel rows — mirrors frontend `reel-provenance.ts`."""

from __future__ import annotations

from typing import Any, Dict, List, Literal

ProvenanceKind = Literal[
    "your_reel",
    "tracked_competitor",
    "found_in_niche",
    "saved_manual",
    "legacy_niche",
    "unknown",
]
RecommendedAction = Literal[
    "recreate",
    "analyze",
    "add_competitor",
    "view_history",
    "open_analysis",
    "ignore",
]
TrustLevel = Literal["high", "medium", "exploratory"]


def _niche_similarity_percent_display(sim: Any) -> int | None:
    """0–100 from keyword_similarity jobs; legacy rows may store 0–1."""
    try:
        x = float(sim)
    except (TypeError, ValueError):
        return None
    if x < 0:
        return None
    if x <= 1:
        return int(round(x * 100))
    return int(round(min(100.0, x)))


def _pick_primary(kind: ProvenanceKind) -> RecommendedAction:
    if kind == "tracked_competitor":
        return "recreate"
    if kind in ("found_in_niche", "legacy_niche"):
        return "add_competitor"
    if kind == "your_reel":
        return "analyze"
    if kind == "saved_manual":
        return "open_analysis"
    return "analyze"


def _infer_kind(row: Dict[str, Any]) -> ProvenanceKind:
    src = str(row.get("source") or "").strip()
    cid = row.get("competitor_id")

    if src == "url_paste":
        return "saved_manual"
    if src == "keyword_similarity":
        return "found_in_niche"
    if src == "niche_search":
        return "legacy_niche"
    if src == "client_baseline":
        return "your_reel"
    if src == "profile":
        return "tracked_competitor"
    if cid:
        return "tracked_competitor"
    return "unknown"


def _infer_reason(row: Dict[str, Any], kind: ProvenanceKind) -> str:
    if kind == "saved_manual":
        return "Recently analyzed" if row.get("analysis") else "Saved by you"

    if kind in ("found_in_niche", "legacy_niche"):
        sim = row.get("similarity_score")
        pct = _niche_similarity_percent_display(sim)
        if pct is not None:
            return f"High niche match ({pct}%)"
        return "Matches your niche"

    if kind == "your_reel":
        gv = row.get("growth_views")
        try:
            if gv is not None and float(gv) > 0:
                return "Still gaining since last sync"
        except (TypeError, ValueError):
            pass
        return "Your latest reels"

    if kind == "tracked_competitor":
        is_bo = (
            row.get("is_outlier") is True
            or row.get("is_outlier_views")
            or row.get("is_outlier_likes")
            or row.get("is_outlier_comments")
        )
        ratio = row.get("outlier_ratio")
        try:
            strong = ratio is not None and float(ratio) >= 1
        except (TypeError, ValueError):
            strong = False
        if is_bo or strong:
            return "Fresh competitor breakout"
        return "From a tracked competitor"

    return "Needs review"


def _infer_trust(kind: ProvenanceKind) -> tuple[TrustLevel, str]:
    if kind == "tracked_competitor":
        return (
            "high",
            "Posted by an account you actively track — benchmarks are grounded in your sync history.",
        )
    if kind == "your_reel":
        return ("high", "Posted from your connected Instagram baseline.")
    if kind == "saved_manual":
        return ("high", "You pasted or saved this URL for analysis.")
    if kind == "found_in_niche":
        return (
            "exploratory",
            "Discovered via keyword similarity — confirm the account fits before treating it like a competitor.",
        )
    if kind == "legacy_niche":
        return ("medium", "From an older niche scrape — verify relevance.")
    return ("medium", "Limited context on this reel.")


def _label_for_kind(kind: ProvenanceKind) -> str:
    return {
        "your_reel": "Your reel",
        "tracked_competitor": "Tracked competitor",
        "found_in_niche": "Found in niche",
        "saved_manual": "Saved",
        "legacy_niche": "Found in niche",
        "unknown": "Reel",
    }.get(kind, "Reel")


def _secondary_for_kind(kind: ProvenanceKind) -> List[RecommendedAction]:
    if kind == "tracked_competitor":
        return ["analyze", "view_history"]
    if kind in ("found_in_niche", "legacy_niche"):
        return ["analyze", "recreate"]
    if kind == "your_reel":
        return ["view_history", "recreate"]
    if kind == "saved_manual":
        return ["recreate", "analyze"]
    return ["analyze"]


def compute_reel_provenance(row: Dict[str, Any]) -> Dict[str, Any]:
    """Return a JSON-serializable provenance object for API responses."""
    kind = _infer_kind(row)
    trust, hint = _infer_trust(kind)
    return {
        "kind": kind,
        "source_label": _label_for_kind(kind),
        "reason": _infer_reason(row, kind),
        "trust": trust,
        "trust_hint": hint,
        "primary_action": _pick_primary(kind),
        "secondary_actions": _secondary_for_kind(kind),
    }


def attach_provenance_to_row(row: Dict[str, Any]) -> Dict[str, Any]:
    """Mutates row in place and returns it."""
    row["provenance"] = compute_reel_provenance(row)
    return row
