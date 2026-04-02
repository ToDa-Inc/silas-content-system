"""Parse engagement + duration fields from Apify Instagram reel items (handles mixed types)."""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple


def _to_non_negative_int(val: Any) -> Optional[int]:
    if val is None:
        return None
    try:
        n = int(round(float(val)))
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None


def _first_positive_duration_seconds(*candidates: Any) -> Optional[int]:
    for raw in candidates:
        if raw is None:
            continue
        n = _to_non_negative_int(raw)
        if n is not None and n > 0:
            return n
    return None


def video_duration_seconds_from_item(item: Dict[str, Any]) -> Optional[int]:
    """Seconds from Apify / Instagram item (several possible keys and nested ``video``)."""
    nested: Dict[str, Any] = {}
    v = item.get("video")
    if isinstance(v, dict):
        nested = v

    return _first_positive_duration_seconds(
        item.get("videoDuration"),
        item.get("duration"),
        item.get("video_duration"),
        item.get("length"),
        nested.get("duration"),
        nested.get("length"),
        nested.get("videoDuration"),
    )


def saves_and_shares_from_item(item: Dict[str, Any]) -> Tuple[int, int]:
    """Reads ``saveCount`` / ``shareCount`` with small key fallbacks."""
    s = 0
    sh = 0
    for key in ("saveCount", "savesCount", "savedCount"):
        v = _to_non_negative_int(item.get(key))
        if v is not None:
            s = v
            break
    for key in ("shareCount", "sharesCount"):
        v = _to_non_negative_int(item.get(key))
        if v is not None:
            sh = v
            break
    return s, sh
