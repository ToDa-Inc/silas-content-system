"""Simple in-process TTL cache.

No dependencies beyond stdlib. Values are stored as (monotonic_timestamp, data) tuples.
Thread-safe for reads; writes use a lock to prevent race conditions under
FastAPI's thread-pool (sync route handlers run in threads).
"""

from __future__ import annotations

import threading
import time
from typing import Any, Dict, Optional, Tuple

_store: Dict[str, Tuple[float, Any]] = {}
_lock = threading.Lock()


def cache_get(key: str, ttl_seconds: int = 180) -> Optional[Any]:
    """Return cached value if it exists and hasn't expired, else None."""
    with _lock:
        entry = _store.get(key)
    if entry is None:
        return None
    ts, val = entry
    if time.monotonic() - ts > ttl_seconds:
        with _lock:
            _store.pop(key, None)
        return None
    return val


def cache_set(key: str, value: Any) -> None:
    """Store value under key with current timestamp."""
    with _lock:
        _store[key] = (time.monotonic(), value)


def cache_delete(key: str) -> None:
    """Explicitly invalidate a cache entry (e.g. after a sync/scrape job finishes)."""
    with _lock:
        _store.pop(key, None)


def cache_clear() -> None:
    """Wipe the entire cache (useful in tests)."""
    with _lock:
        _store.clear()
