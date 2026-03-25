"""Resolve reel cover image URL from Apify Instagram reel items.

Instagram CDN URLs are signed; omitting query params often returns 403. We pick the first
full https URL from known Apify field names.
"""

from __future__ import annotations

from typing import Any, Dict, Optional


def reel_thumbnail_url_from_apify_item(item: Dict[str, Any]) -> Optional[str]:
    keys = (
        "displayUrl",
        "thumbnailUrl",
        "thumbnail_src",
        "display_url",
        "thumbnail_url",
    )
    for key in keys:
        v = item.get(key)
        if isinstance(v, str):
            t = v.strip()
            if t.startswith("https://"):
                return t

    images = item.get("images")
    if isinstance(images, list):
        for x in images:
            if isinstance(x, str):
                t = x.strip()
                if t.startswith("https://"):
                    return t
            elif isinstance(x, dict):
                for ik in ("url", "src", "displayUrl", "thumbnailUrl"):
                    u = x.get(ik)
                    if isinstance(u, str):
                        t = u.strip()
                        if t.startswith("https://"):
                            return t
    return None
