"""Parse Silas analysis text for total + per-criterion scores and rating label."""

from __future__ import annotations

import re
from typing import Any, Dict, Optional


def rating_label_from_total(total: Optional[int]) -> str:
    if total is None:
        return "N/A"
    if total >= 40:
        return "Highly Replicable"
    if total >= 30:
        return "Strong Pattern"
    if total >= 20:
        return "Moderate"
    return "Weak"


def parse_silas_analysis_text(text: str) -> Dict[str, Any]:
    """Extract TOTAL SCORE, per-criterion scores (first five Score: N/10 in order), and rating."""
    total: Optional[int] = None
    m_total = re.search(r"TOTAL\s+SCORE[:\s]+(\d+)\s*/\s*50", text, re.IGNORECASE)
    if m_total:
        total = int(m_total.group(1))

    score_matches = re.findall(r"Score:\s*(\d+)\s*/\s*10", text, re.IGNORECASE)
    scores_int = [int(x) for x in score_matches[:5]]

    keys = [
        "instant_hook",
        "high_relatability",
        "cognitive_tension",
        "clear_value",
        "comment_trigger",
    ]
    scores: Dict[str, Optional[int]] = {k: None for k in keys}
    for i, k in enumerate(keys):
        if i < len(scores_int):
            scores[k] = scores_int[i]

    return {
        "total_score": total,
        "rating": rating_label_from_total(total),
        "scores": scores,
    }
