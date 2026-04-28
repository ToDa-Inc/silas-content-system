"""Persist the client's own reels (competitor_id NULL) during baseline scrape."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from supabase import Client

from core.id_generator import generate_reel_id
from services.apify_posted_at import apify_instagram_item_posted_at_iso
from services.instagram_post_url import canonical_instagram_post_url
from services.apify_reel_fields import saves_and_shares_from_item, video_duration_seconds_from_item
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
    """Upsert scraped_reels for the client's own posts (competitor_id NULL).

    Preserves stable ``id`` per (client_id, post_url) so ``reel_snapshots`` can track
    metrics over time. Rows no longer returned in this baseline batch are removed.
    """
    un = ig_username.replace("@", "").strip()
    if not un or not videos:
        return 0

    normalized_keys: set[str] = set()
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
        saves, shares = saves_and_shares_from_item(item)
        caption = _caption_text(item)
        thumb = reel_thumbnail_url_from_apify_item(item)
        hook = (caption.split("\n")[0][:500] if caption else "") or None
        video_duration = video_duration_seconds_from_item(item)
        url_key = canonical_instagram_post_url(url)
        normalized_keys.add(url_key)
        rows.append(
            {
                "client_id": client_id,
                "competitor_id": None,
                "scrape_job_id": job_id,
                "post_url": url_key,
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
                "posted_at": apify_instagram_item_posted_at_iso(item),
                "format": "reel",
                "source": "client_baseline",
                "video_duration": video_duration,
            }
        )
    if not rows:
        return 0

    # Look up only prior client_baseline rows so we can preserve their stable id
    # across runs. Scoping by source is critical — other source types
    # (keyword_similarity, url_paste, niche_search) also have competitor_id NULL
    # and must not be touched here, otherwise the orphan-cleanup below would
    # silently wipe them on every baseline scrape.
    existing_res = (
        supabase.table("scraped_reels")
        .select("id, post_url")
        .eq("client_id", client_id)
        .eq("source", "client_baseline")
        .execute()
    )
    id_by_url: Dict[str, str] = {}
    stored_url_by_norm: Dict[str, str] = {}
    for er in existing_res.data or []:
        raw = str(er.get("post_url") or "")
        n = canonical_instagram_post_url(raw)
        if n and n not in id_by_url:
            id_by_url[n] = str(er["id"])
            stored_url_by_norm[n] = raw if raw else n

    for row in rows:
        key = row["post_url"]
        row["id"] = id_by_url.get(key) or generate_reel_id()
        row["post_url"] = stored_url_by_norm.get(key, key)

    supabase.table("scraped_reels").upsert(rows, on_conflict="client_id,post_url").execute()

    # Orphan cleanup: only consider client_baseline rows. Without this scope a
    # niche-discovery reel (source=keyword_similarity, competitor_id NULL) would
    # be flagged as an orphan and deleted, cascading reel_analyses.reel_id to
    # NULL and effectively erasing it from /intelligence/reels.
    fresh_res = (
        supabase.table("scraped_reels")
        .select("id, post_url")
        .eq("client_id", client_id)
        .eq("source", "client_baseline")
        .execute()
    )
    existing_rows = fresh_res.data or []

    # Defensive guard: with full-history sync (results_limit ≫ 30) a partial
    # Apify run that returns fewer items than we already have stored should not
    # silently wipe older reels. Only run orphan cleanup when the fresh batch is
    # at least as large as the prior stored set, so we know we saw a full pull.
    if len(rows) >= len(existing_rows):
        orphan_ids: List[str] = []
        for er in existing_rows:
            n = canonical_instagram_post_url(str(er.get("post_url") or ""))
            if n not in normalized_keys:
                orphan_ids.append(str(er["id"]))
        if orphan_ids:
            supabase.table("scraped_reels").delete().in_("id", orphan_ids).execute()

    return len(rows)
