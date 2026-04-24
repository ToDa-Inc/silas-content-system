"""Reading-time and default block durations for VideoSpec."""

from __future__ import annotations

import re
from typing import Literal

_WS_RE = re.compile(r"\s+")


def word_count(text: str) -> int:
    t = (text or "").strip()
    if not t:
        return 0
    return len(_WS_RE.split(t))


def block_read_duration_sec(
    text: str,
    *,
    language: str = "de",
    min_sec: float = 1.4,
    max_sec: float = 4.5,
) -> float:
    """Heuristic on-screen read time from word count."""
    lang = (language or "de").strip().lower()[:2]
    w = word_count(text)
    mult = 0.42 if lang == "de" else 0.32
    raw = w * mult + 0.8
    return max(min_sec, min(max_sec, raw))


def default_hook_duration_sec() -> float:
    return 3.0


def template_id_for_format_key(format_key: str, *, source_type: str = "") -> Literal[
    "bottom-card", "centered-pop", "top-banner", "capcut-highlight"
]:
    fk = (format_key or "").strip().lower()
    if not fk and (source_type or "").strip() == "url_adapt":
        fk = "text_overlay"
    if fk == "b_roll_reel":
        return "bottom-card"
    return "centered-pop"
