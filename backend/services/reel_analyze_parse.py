"""Parse Silas v2 analysis text — 7 criteria, weighted /100 scale.

Backward-compatible: the 5 original DB columns (instant_hook_score, relatability_score,
cognitive_tension_score, clear_value_score, comment_trigger_score) are still populated.
The 2 new criteria (specificity, caption_save_value) plus the weighted total are stored
in full_analysis_json until a DB migration adds dedicated columns.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Union

from .reel_analyze_prompt import CRITERIA_WEIGHTS


# ---------------------------------------------------------------------------
# Rating helpers
# ---------------------------------------------------------------------------

def rating_label_from_total(total: Optional[Union[int, float]], scale: int = 100) -> str:
    """Return a human-readable rating label.

    Supports both /50 (legacy v1) and /100 (v2) scales.
    v2 totals may be floats (e.g. model output 82.5/100).
    """
    if total is None:
        return "N/A"
    if scale == 50:
        t = float(total)
        if t >= 40:
            return "Highly Replicable"
        if t >= 30:
            return "Strong Pattern"
        if t >= 20:
            return "Moderate"
        return "Weak"
    # v2 /100 scale
    t = float(total)
    if t >= 85:
        return "Blueprint"
    if t >= 70:
        return "Strong Pattern"
    if t >= 50:
        return "Moderate"
    return "Weak"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _clean_block(s: str) -> str:
    t = (s or "").strip()
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def _extract_section(text: str, start_pat: str, end_pats: List[str]) -> Optional[str]:
    m = re.search(start_pat, text, re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    rest = text[m.end() :]
    best_end = len(rest)
    for ep in end_pats:
        em = re.search(ep, rest, re.IGNORECASE | re.MULTILINE)
        if em:
            best_end = min(best_end, em.start())
    return _clean_block(rest[:best_end])


def _parse_format_keyed_block(block: Optional[str]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not block:
        return out
    for line in block.splitlines():
        line = line.strip()
        m = re.match(r"^[-*]\s*([^:]+):\s*(.+)$", line)
        if not m:
            continue
        key = m.group(1).strip().lower()
        val = m.group(2).strip()
        if key.startswith("type") and "hook" not in key:
            out["format_type"] = val
        elif "hook type" in key or key == "hook" or "hook" in key:
            out["hook_type"] = val
        elif "language" in key:
            out["language"] = val
        elif "duration" in key:
            out["duration_feel"] = val
        elif "caption" in key:
            out["caption"] = val
        elif "visual" in key:
            out["visual_structure"] = val
        elif "audio" in key:
            out["audio_role"] = val
    return out


def _parse_replicable_bullets(block: Optional[str]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not block:
        return out
    for line in block.splitlines():
        line = line.strip()
        m = re.match(r"^[-*]\s*([^:]+):\s*(.+)$", line)
        if not m:
            continue
        k = m.group(1).strip().lower().replace(" ", "_")
        out[k] = m.group(2).strip()
    return out


def _extract_evidence(text: str, section_num: int, next_section_num: int) -> Optional[str]:
    """Extract Evidence line from a numbered section."""
    pattern = rf"{section_num}\.\s+.*?Evidence:\s*(.+?)(?=\n\s*{next_section_num}\.|\n-{{3,}}|\n={{3,}}|\Z)"
    m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    return _clean_block(m.group(1))


# ---------------------------------------------------------------------------
# v2 score extraction (7 criteria)
# ---------------------------------------------------------------------------

_V2_CRITERIA_ORDER = [
    "hook_strength",
    "specificity",
    "relatability",
    "cognitive_tension",
    "clear_value",
    "caption_save_value",
    "interaction_trigger",
]

# Map v2 criteria → legacy DB column names (5 of 7 map directly)
_V2_TO_DB_COLUMN = {
    "hook_strength": "instant_hook",
    "relatability": "high_relatability",
    "cognitive_tension": "cognitive_tension",
    "clear_value": "clear_value",
    "interaction_trigger": "comment_trigger",
}


def _extract_v2_scores(text: str) -> Dict[str, Optional[int]]:
    """Extract raw 1-10 scores for each of the 7 v2 criteria."""
    score_matches = re.findall(r"Score:\s*(\d+)\s*/\s*10", text, re.IGNORECASE)
    scores_int = [int(x) for x in score_matches[:7]]
    if len(scores_int) < 7:
        alt = re.findall(
            r"(?:^|\n)\s*\d+\.\s+[^\n]+?[\u2014\u2013\-–]\s*(\d+)\s*/\s*10",
            text,
            re.MULTILINE,
        )
        if len(alt) >= 7:
            scores_int = [int(x) for x in alt[:7]]

    result: Dict[str, Optional[int]] = {k: None for k in _V2_CRITERIA_ORDER}
    for i, k in enumerate(_V2_CRITERIA_ORDER):
        if i < len(scores_int):
            result[k] = scores_int[i]
    return result


def _extract_weighted_total_from_text(text: str) -> Optional[float]:
    """Try to extract the TOTAL SCORE: X/100 line (X may be a decimal)."""
    m = re.search(r"TOTAL\s+SCORE[:\s]+(\d+(?:\.\d+)?)\s*/\s*100", text, re.IGNORECASE)
    if m:
        return float(m.group(1))
    return None


def _compute_weighted_total(scores: Dict[str, Optional[int]]) -> Optional[int]:
    """Compute weighted total from raw scores using CRITERIA_WEIGHTS."""
    total = 0.0
    for key, weight in CRITERIA_WEIGHTS.items():
        raw = scores.get(key)
        if raw is None:
            return None
        total += raw * weight
    return round(total)


# ---------------------------------------------------------------------------
# Legacy v1 detection + parsing
# ---------------------------------------------------------------------------

def _is_v1_format(text: str) -> bool:
    """Detect if the text uses v1 format (5 criteria, /50 scale)."""
    return bool(re.search(r"TOTAL\s+SCORE[:\s]+\d+\s*/\s*50", text, re.IGNORECASE))


def _parse_v1(text: str) -> Dict[str, Any]:
    """Parse legacy v1 format for backward compatibility."""
    raw = text or ""

    total: Optional[int] = None
    m_total = re.search(r"TOTAL\s+SCORE[:\s]+(\d+)\s*/\s*50", raw, re.IGNORECASE)
    if m_total:
        total = int(m_total.group(1))

    score_matches = re.findall(r"Score:\s*(\d+)\s*/\s*10", raw, re.IGNORECASE)
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
        "rating": rating_label_from_total(total, scale=50),
        "scores": scores,
        "weighted_total": None,
        "weighted_scores": None,
        "raw_scores": None,
    }


# ---------------------------------------------------------------------------
# Qualitative section end patterns
# ---------------------------------------------------------------------------

_SECTION_END_PATS = [
    r"^\s*FORMAT\s*:",
    r"^\s*REPLICABLE\s+ELEMENTS\s*:",
    r"^\s*SUGGESTED\s+ADAPTATION\s*:",
    r"^\s*WHY\s+THIS\s+WORKS\s*",
    r"^={3,}\s*$",
    r"^-{3,}\s*$",
]


# ---------------------------------------------------------------------------
# Main parser
# ---------------------------------------------------------------------------

def parse_silas_analysis_text(text: str) -> Dict[str, Any]:
    """Extract scores, total, rating, and best-effort structured fields for DB + JSON.

    Supports both v1 (5 criteria /50) and v2 (7 criteria /100) formats.
    """
    raw = text or ""

    # --- Detect version and extract scores ---
    if _is_v1_format(raw):
        score_data = _parse_v1(raw)
    else:
        v2_scores = _extract_v2_scores(raw)

        # Weighted total: prefer model's own calculation, fall back to ours
        weighted_from_text = _extract_weighted_total_from_text(raw)
        weighted_computed = _compute_weighted_total(v2_scores)
        weighted_total = (
            weighted_from_text if weighted_from_text is not None else weighted_computed
        )

        # Build weighted breakdown
        weighted_scores = {}
        for key, weight in CRITERIA_WEIGHTS.items():
            raw_score = v2_scores.get(key)
            if raw_score is not None:
                weighted_scores[key] = round(raw_score * weight, 1)

        # Map to legacy DB columns (5 of 7)
        legacy_scores: Dict[str, Optional[int]] = {}
        for v2_key, db_key in _V2_TO_DB_COLUMN.items():
            legacy_scores[db_key] = v2_scores.get(v2_key)

        # Legacy total (sum of 5 mapped scores, for the generated DB column)
        legacy_total_parts = [legacy_scores.get(k) for k in legacy_scores]
        legacy_total = (
            sum(v for v in legacy_total_parts if v is not None)
            if all(v is not None for v in legacy_total_parts)
            else None
        )

        score_data = {
            "total_score": legacy_total,
            "rating": rating_label_from_total(weighted_total, scale=100),
            "scores": legacy_scores,
            "weighted_total": weighted_total,
            "weighted_scores": weighted_scores,
            "raw_scores": v2_scores,
        }

    # --- Qualitative sections (same for v1 and v2) ---
    content_summary = _extract_section(
        raw,
        r"CONTENT\s+SUMMARY\s*(?:\([^)]*\))?\s*:",
        _SECTION_END_PATS,
    )
    format_block = _extract_section(
        raw,
        r"FORMAT\s*:",
        [
            r"^\s*REPLICABLE\s+ELEMENTS\s*:",
            r"^\s*SUGGESTED\s+ADAPTATION\s*:",
            r"^\s*WHY\s+THIS\s+WORKS\s*",
            r"^={3,}\s*$",
            r"^-{3,}\s*$",
        ],
    )
    fmt = _parse_format_keyed_block(format_block)
    replicable_block = _extract_section(
        raw,
        r"REPLICABLE\s+ELEMENTS\s*:",
        [
            r"^\s*SUGGESTED\s+ADAPTATION\s*:",
            r"^\s*WHY\s+THIS\s+WORKS\s*",
            r"^={3,}\s*$",
            r"^-{3,}\s*$",
        ],
    )
    repl = _parse_replicable_bullets(replicable_block)

    why_it_works = _extract_section(
        raw,
        r"WHY\s+THIS\s+WORKS\s*(?:\([^)]*\))?\s*:",
        [
            r"^\s*SUGGESTED\s+ADAPTATION\s*:",
            r"^={3,}\s*$",
            r"^-{3,}\s*$",
        ],
    )

    suggested_raw = _extract_section(
        raw,
        r"SUGGESTED\s+ADAPTATION\s*:",
        [r"^={3,}\s*$", r"^-{3,}\s*$"],
    )

    # Emotional trigger: extract from Relatability evidence (section 3 in v2, section 2 in v1)
    emotional = _extract_evidence(raw, 3, 4) or _extract_evidence(raw, 2, 3)

    hook_type = fmt.get("hook_type")
    content_angle = fmt.get("format_type")
    caption_structure = fmt.get("caption")

    suggested_adaptations: Optional[List[str]] = None
    if suggested_raw:
        suggested_adaptations = [suggested_raw]

    replicable_json: Optional[Dict[str, Any]] = None
    if repl:
        replicable_json = repl

    structured_summary = {
        "content_summary": content_summary,
        "format": fmt,
        "replicable_elements": replicable_json,
        "why_it_works": why_it_works,
        "suggested_adaptation": suggested_raw,
    }

    return {
        # DB column values (backward compatible)
        "total_score": score_data["total_score"],
        "rating": score_data["rating"],
        "scores": score_data["scores"],
        # v2 enrichment (stored in full_analysis_json)
        "weighted_total": score_data.get("weighted_total"),
        "weighted_scores": score_data.get("weighted_scores"),
        "raw_scores": score_data.get("raw_scores"),
        # Qualitative
        "hook_type": hook_type,
        "emotional_trigger": emotional,
        "content_angle": content_angle,
        "caption_structure": caption_structure,
        "why_it_worked": why_it_works or content_summary,
        "replicable_elements": replicable_json,
        "suggested_adaptations": suggested_adaptations,
        "structured_summary": structured_summary,
    }
