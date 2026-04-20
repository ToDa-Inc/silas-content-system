"""scraped_reels_refresh — daily re-fetch of views/likes/comments for active reels.

Covers ALL sources (profile, keyword_similarity, etc.) for reels younger than
`max_age_days` (default 60). Updates scraped_reels with fresh numbers and appends
a snapshot to reel_snapshots (the existing append-only growth table).

Cost: Apify directUrls at ~$0.0015/1000 items — negligible at any realistic scale.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from core.config import Settings
from core.database import get_supabase_for_settings
from services.apify import enrich_reel_urls_direct
from services.instagram_post_url import canonical_instagram_post_url
from services.reel_thumbnail_url import reel_thumbnail_url_from_apify_item

DEFAULT_MAX_AGE_DAYS = 60
DEFAULT_BATCH_LIMIT = 500  # max reels refreshed per run (cost guard)

# apify~instagram-scraper: $0.0023 per returned result (= $2.30 / 1K)
_COST_ENRICH_PER_RESULT_USD = 0.0023


# ── helpers ───────────────────────────────────────────────────────────────────


def _views(item: dict) -> int:
    return int(
        item.get("videoViewCount")
        or item.get("videoPlayCount")
        or item.get("playsCount")
        or 0
    )


def _canon_url(item: dict) -> str:
    u = item.get("url") or item.get("inputUrl") or ""
    if u:
        return canonical_instagram_post_url(str(u).strip())
    sc = item.get("shortCode") or ""
    if sc:
        return canonical_instagram_post_url(f"https://www.instagram.com/reel/{sc}/")
    return ""


def _fetch_active_reels(
    supabase: Any,
    *,
    client_id: Optional[str],
    cutoff: datetime,
    limit: int,
) -> List[Dict[str, Any]]:
    q = (
        supabase.table("scraped_reels")
        .select("id, post_url, views, likes, comments")
        .gte("posted_at", cutoff.isoformat())
        .order("posted_at", desc=True)
        .limit(limit)
    )
    if client_id:
        q = q.eq("client_id", client_id)
    return q.execute().data or []


# ── main job ──────────────────────────────────────────────────────────────────


def run_scraped_reels_refresh(settings: Settings, job: Dict[str, Any]) -> None:
    if not settings.apify_api_token:
        raise RuntimeError("APIFY_API_TOKEN required")

    supabase = get_supabase_for_settings(settings)
    job_id = job["id"]
    payload = job.get("payload") or {}

    client_id: Optional[str] = job.get("client_id") or payload.get("client_id")
    max_age_days = int(payload.get("max_age_days") or DEFAULT_MAX_AGE_DAYS)
    batch_limit = int(payload.get("batch_limit") or DEFAULT_BATCH_LIMIT)

    now_utc = datetime.now(timezone.utc)
    supabase.table("background_jobs").update(
        {"status": "running", "started_at": now_utc.isoformat()}
    ).eq("id", job_id).execute()

    progress: Dict[str, Any] = {
        "pipeline": "scraped_reels_refresh",
        "phase": "fetching_candidates",
        "candidates": 0,
        "enriched": 0,
        "updated": 0,
        "unchanged": 0,
        "snapshots_inserted": 0,
        "enrich_errors": [],
        "client_id": client_id or "all",
        "max_age_days": max_age_days,
    }
    _save(supabase, job_id, progress)

    cutoff = now_utc - timedelta(days=max_age_days)
    rows = _fetch_active_reels(supabase, client_id=client_id, cutoff=cutoff, limit=batch_limit)

    progress["candidates"] = len(rows)
    if not rows:
        _complete(supabase, job_id, progress, "No active reels in window")
        return

    # ── enrich ────────────────────────────────────────────────────────────────
    progress["phase"] = "enriching"
    _save(supabase, job_id, progress)

    url_to_row: Dict[str, Dict[str, Any]] = {
        canonical_instagram_post_url(str(r["post_url"])): r for r in rows
    }

    items, errors = enrich_reel_urls_direct(settings.apify_api_token, list(url_to_row.keys()))
    progress["enrich_errors"] = errors
    progress["enriched"] = len(items)

    # ── update scraped_reels + insert reel_snapshots ──────────────────────────
    progress["phase"] = "updating"
    _save(supabase, job_id, progress)

    updated = 0
    unchanged = 0
    snapshots: List[Dict[str, Any]] = []
    now_iso = now_utc.isoformat()

    for item in items:
        url = _canon_url(item)
        if not url:
            continue
        row = url_to_row.get(url)
        if not row:
            continue

        fresh_views = _views(item)
        fresh_likes = max(0, int(item.get("likesCount") or 0))
        fresh_comments = int(item.get("commentsCount") or 0)
        # Instagram CDN thumbnail URLs expire (~24h). Rewrite every refresh so
        # dashboard cards don't show broken images the day after a scrape.
        fresh_thumbnail = reel_thumbnail_url_from_apify_item(item) or None

        old_views = int(row.get("views") or 0)
        old_likes = int(row.get("likes") or 0)
        old_comments = int(row.get("comments") or 0)

        if fresh_views == old_views and fresh_likes == old_likes and fresh_comments == old_comments:
            # Still refresh the thumbnail URL on no-metric-change days — the
            # CDN token may have expired even if counts haven't moved.
            if fresh_thumbnail:
                supabase.table("scraped_reels").update({
                    "thumbnail_url": fresh_thumbnail,
                    "last_updated_at": now_iso,
                }).eq("id", row["id"]).execute()
            unchanged += 1
            continue

        update_patch: Dict[str, Any] = {
            "views": fresh_views,
            "likes": fresh_likes,
            "comments": fresh_comments,
            "last_updated_at": now_iso,
        }
        if fresh_thumbnail:
            update_patch["thumbnail_url"] = fresh_thumbnail
        supabase.table("scraped_reels").update(update_patch).eq("id", row["id"]).execute()

        snapshots.append({
            "reel_id": row["id"],
            "views": fresh_views,
            "likes": fresh_likes,
            "comments": fresh_comments,
        })
        updated += 1

    # Bulk-insert snapshots in one call
    if snapshots:
        supabase.table("reel_snapshots").insert(snapshots).execute()

    progress["updated"] = updated
    progress["unchanged"] = unchanged
    progress["snapshots_inserted"] = len(snapshots)
    progress["estimated_cost_usd"] = round(len(items) * _COST_ENRICH_PER_RESULT_USD, 4)
    _complete(supabase, job_id, progress)


# ── util ──────────────────────────────────────────────────────────────────────


def _save(supabase: Any, job_id: str, progress: Dict[str, Any]) -> None:
    supabase.table("background_jobs").update({"result": dict(progress)}).eq("id", job_id).execute()


def _complete(
    supabase: Any,
    job_id: str,
    progress: Dict[str, Any],
    message: Optional[str] = None,
) -> None:
    if message:
        progress["message"] = message
    progress["phase"] = "completed"
    supabase.table("background_jobs").update({
        "status": "completed",
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "result": progress,
    }).eq("id", job_id).execute()
