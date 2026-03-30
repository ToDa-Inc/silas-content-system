"""Normalize posted time from Apify Instagram reel items to UTC ISO-8601 strings."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

_POSTED_AT_KEYS = (
    "timestamp",
    "taken_at_timestamp",
    "takenAtTimestamp",
    "uploadDate",
    "createdAt",
    "publishDate",
)


def _numeric_epoch_to_iso(value: float) -> Optional[str]:
    try:
        sec = float(value)
        if sec > 1e12:
            sec = sec / 1000.0
        return datetime.fromtimestamp(sec, tz=timezone.utc).isoformat()
    except (OSError, ValueError, OverflowError):
        return None


def _coerce_value_to_iso(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return _numeric_epoch_to_iso(float(raw))
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return None
        if s.isdigit():
            return _numeric_epoch_to_iso(float(int(s)))
        try:
            normalized = s.replace("Z", "+00:00")
            dt = datetime.fromisoformat(normalized)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            else:
                dt = dt.astimezone(timezone.utc)
            return dt.isoformat()
        except (ValueError, TypeError):
            pass
        try:
            return _numeric_epoch_to_iso(float(s))
        except (ValueError, TypeError):
            return None
    return None


def apify_instagram_item_posted_at_iso(item: dict) -> Optional[str]:
    """Best-effort UTC ISO timestamp from common Apify Instagram item fields."""
    if not isinstance(item, dict):
        return None
    for key in _POSTED_AT_KEYS:
        if key not in item:
            continue
        iso = _coerce_value_to_iso(item.get(key))
        if iso:
            return iso
    return None
