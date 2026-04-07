"""Map Silas FORMAT Type / content_angle strings to canonical format keys."""

from __future__ import annotations

import re
from typing import Any, Dict, Optional

CANONICAL_FORMATS = (
    "talking_head",
    "text_overlay",
    "skit",
    "voiceover",
    "b_roll_reel",
    "screen_recording",
    "montage",
    "other",
)


def canonicalize_stored_format_key(raw: Optional[str]) -> str:
    """Unify legacy DB/API values with keys used by Create / Remotion (e.g. b_roll → b_roll_reel)."""
    s = (raw or "").strip()
    if not s:
        return ""
    if s == "b_roll":
        return "b_roll_reel"
    return s


# phrase -> canonical (first match wins)
_ALIASES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"talking\s*head|talk\s*head|face\s*to\s*camera|direct\s*to\s*camera", re.I), "talking_head"),
    (re.compile(r"text\s*overlay|text\s*on\s*screen|caption\s*style|subtitle", re.I), "text_overlay"),
    (re.compile(r"\bskit\b|sketch|role\s*play|acting|scene", re.I), "skit"),
    (re.compile(r"voice\s*over|voiceover|vo\b|narrat", re.I), "voiceover"),
    (re.compile(r"b[\s-]*roll|broll|stock\s*footage|footage\s*montage", re.I), "b_roll_reel"),
    (re.compile(r"screen\s*record|screen\s*share|loom|desktop", re.I), "screen_recording"),
    (re.compile(r"montage|compilation|quick\s*cuts|edit\s*style", re.I), "montage"),
]


def normalize_format_string(raw: Optional[str]) -> str:
    """Normalize a free-text format label to a canonical key."""
    if not raw or not str(raw).strip():
        return "other"
    s = str(raw).strip().lower()
    for pat, key in _ALIASES:
        if pat.search(s):
            return key
    # short exact-ish tokens
    if "head" in s and "talk" in s:
        return "talking_head"
    if "overlay" in s or ("text" in s and "hook" not in s):
        return "text_overlay"
    return "other"


def normalize_format_from_analysis(
    *,
    content_angle: Optional[str],
    full_analysis_json: Optional[Dict[str, Any]],
) -> str:
    """Prefer FORMAT Type from structured_summary, else DB content_angle."""
    if isinstance(full_analysis_json, dict):
        ss = full_analysis_json.get("structured_summary")
        if isinstance(ss, dict):
            fmt = ss.get("format")
            if isinstance(fmt, dict):
                ft = fmt.get("format_type")
                if isinstance(ft, str) and ft.strip():
                    return normalize_format_string(ft)
    return normalize_format_string(content_angle)
