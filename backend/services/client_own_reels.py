"""Persist the client's own reels (competitor_id NULL) during baseline scrape."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from supabase import Client

from core.id_generator import generate_reel_id
from services.reel_thumbnail_url import reel_thumbnail_url_from_apify_item


def _caption_text(item: dict) -> str:
    c = item.get("caption")
    if isinstance(c, dict):
        return str(c.get("text") or "")[:8000]
    if isinstance(c, str):
        return c[:8000]
    return ""


def _post_url(item: dict) -> Optional[str]:
    u = item.get("url")
    if u:
        return str(u).strip()
    sc = item.get("shortCode")
    if sc:
        return f"https://www.instagram.com/reel/{sc}/"
    return None


def _posted_at_iso(item: dict) -> Optional[str]:
    ts = item.get("timestamp")
    if ts is None:
        return None
    try:
        if isinstance(ts, (int, float)):
            return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()
        if isinstance(ts, str) and ts.isdigit():
            return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
    except (OSError, ValueError, OverflowError):
        return None
    return None


def _hashtags(item: dict, caption: str) -> List[str]:
    raw = item.get("hashtags")
    if isinstance(raw, list) and raw:
        return [str(x).strip() for x in raw if x][:50]
    return re.findall(r"#[\w\u00C0-\u024F]+", caption)[:50]


def upsert_client_own_reels(
    supabase: Client,
    *,
    client_id: str,
    job_id: str,
    ig_username: str,
    videos: List[dict],
    account_avg_views: int,
) -> int:
    """Insert/update scraped_reels for the creator's own posts (no competitor, no outlier flags)."""
    un = ig_username.replace("@", "").strip()
    if not un or not videos:
        return 0
    rows: List[Dict[str, Any]] = []
    for item in videos:
        url = _post_url(item)
        if not url:
            continue
        views = int(item.get("videoViewCount") or item.get("playsCount") or 0)
        if views <= 0:
            continue
        likes = int(item.get("likesCount") or 0)
        comments = int(item.get("commentsCount") or 0)
        saves = int(item.get("saveCount") or 0)
        shares = int(item.get("shareCount") or 0)
        caption = _caption_text(item)
        thumb = reel_thumbnail_url_from_apify_item(item)
        hook = (caption.split("\n")[0][:500] if caption else "") or None
        rows.append(
            {
                "client_id": client_id,
                "competitor_id": None,
                "scrape_job_id": job_id,
                "post_url": url,
                "thumbnail_url": str(thumb) if thumb else None,
                "account_username": un,
                "account_avg_views": account_avg_views,
                "views": views,
                "likes": likes,
                "comments": comments,
                "saves": saves,
                "shares": shares,
                "outlier_ratio": None,
                "is_outlier": False,
                "hook_text": hook,
                "caption": caption or None,
                "hashtags": _hashtags(item, caption),
                "posted_at": _posted_at_iso(item),
                "format": "reel",
                "source": "client_baseline",
            }
        )
    if not rows:
        return 0
    # Replace prior client-owned rows (competitor_id NULL) for this client.
    supabase.table("scraped_reels").delete().eq("client_id", client_id).is_(
        "competitor_id", "null"
    ).execute()
    for row in rows:
        row["id"] = generate_reel_id()
    supabase.table("scraped_reels").insert(rows).execute()
    return len(rows)
