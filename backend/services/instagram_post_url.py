"""Canonical Instagram post/reel URLs for UNIQUE(client_id, post_url) deduplication."""


def canonical_instagram_post_url(url: str) -> str:
    """Strip whitespace, query, fragment, and trailing slash so upserts match one row per post."""
    if not url:
        return ""
    return str(url).strip().split("?")[0].split("#")[0].rstrip("/")
