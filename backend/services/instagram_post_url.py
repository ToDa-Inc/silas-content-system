"""Canonical Instagram post/reel URLs for UNIQUE(client_id, post_url) deduplication."""

from __future__ import annotations

import re

# Matches reel, /p/, and /tv/ paths; short code is the first path segment after the type.
_IG_SHORT_CODE_RE = re.compile(
    r"instagram\.com/(?:reel|p|tv)/([^/?#]+)",
    re.IGNORECASE,
)


def instagram_post_short_code(url: str) -> str:
    """Extract media short code from an Instagram reel, post, or tv URL. Empty if not parseable."""
    if not url:
        return ""
    m = _IG_SHORT_CODE_RE.search(str(url))
    return (m.group(1) or "").strip() if m else ""


def canonical_reel_url_from_short_code(short_code: str) -> str:
    """Stable /reel/{shortCode} URL for storage — same media as /p/{shortCode}."""
    sc = (short_code or "").strip()
    if not sc:
        return ""
    return canonical_instagram_post_url(f"https://www.instagram.com/reel/{sc}")


def canonical_instagram_post_url(url: str) -> str:
    """Strip whitespace, query, fragment, and trailing slash so upserts match one row per post."""
    if not url:
        return ""
    return str(url).strip().split("?")[0].split("#")[0].rstrip("/")
