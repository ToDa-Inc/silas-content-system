"""milestone_scrape job — fetch current metrics for one reel and record its milestone.

Lightweight: Apify scrape only (no video download, no Gemini analysis).

DEPRECATED (superseded 2026-04):
    scraped_reels_refresh now updates views/likes/comments and appends to
    reel_snapshots for ALL reels <60d old, not just competitor reels that
    happen to cross a 24/48/72h boundary. The daily_intelligence_tick runs
    scraped_reels_refresh automatically — no external cron needed.

    This handler is kept live so the existing routers/cron.py milestone_scrapes
    endpoint continues to function during migration. Remove once external
    cron hits are retired (Phase 7 deployment cleanup).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict

from core.config import Settings
from core.database import get_supabase_for_settings
from services.apify import instagram_reel_scraper_input, run_actor
from services.first_day_stats import compute_competitor_milestone_averages

logger = logging.getLogger(__name__)


def _views_from_item(item: dict) -> int:
    return int(item.get("videoViewCount") or item.get("playsCount") or 0)


def run_milestone_scrape(settings: Settings, job: Dict[str, Any]) -> None:
    logger.warning(
        "milestone_scrape is DEPRECATED — scraped_reels_refresh (enqueued by "
        "daily_intelligence_tick) now handles view/like/comment refresh and "
        "reel_snapshots growth tracking for all reels <60d old. "
        "Retire external cron hits to routers/cron.py::milestone_scrapes."
    )
    if not settings.apify_api_token:
        raise RuntimeError("APIFY_API_TOKEN not configured")

    supabase = get_supabase_for_settings(settings)
    job_id = job["id"]
    client_id = job.get("client_id")
    payload = job.get("payload") or {}
    reel_id = payload.get("reel_id")
    reel_url = payload.get("reel_url")
    milestone_hours = int(payload.get("milestone_hours") or 0)
    competitor_id = payload.get("competitor_id")

    if not all([client_id, reel_id, reel_url, milestone_hours, competitor_id]):
        raise RuntimeError(
            f"milestone_scrape payload incomplete: reel_id={reel_id}, "
            f"reel_url={reel_url}, milestone_hours={milestone_hours}, "
            f"competitor_id={competitor_id}"
        )

    items = run_actor(
        settings.apify_api_token,
        settings.apify_reel_actor,
        instagram_reel_scraper_input(
            [reel_url],
            1,
            include_shares_count=settings.apify_include_shares_count,
        ),
    )

    if not items:
        logger.warning("milestone_scrape: Apify returned no items for %s", reel_url)
        _complete_job(supabase, job_id, {"reel_id": reel_id, "milestone_hours": milestone_hours, "apify_items": 0})
        return

    item = items[0]
    views = _views_from_item(item)
    comments = int(item.get("commentsCount") or 0)
    likes = int(item.get("likesCount") or 0)
    now_iso = datetime.now(timezone.utc).isoformat()

    reel_patch: Dict[str, Any] = {
        "views": views,
        "likes": likes,
        "comments": comments,
    }

    ms_views_col = f"views_at_{milestone_hours}h"
    ms_comments_col = f"comments_at_{milestone_hours}h"
    ms_ts_col = f"milestone_{milestone_hours}h_at"
    reel_patch[ms_views_col] = views
    reel_patch[ms_comments_col] = comments
    reel_patch[ms_ts_col] = now_iso

    supabase.table("scraped_reels").update(reel_patch).eq("id", reel_id).execute()

    try:
        supabase.table("reel_snapshots").insert({
            "reel_id": reel_id,
            "views": views,
            "likes": likes,
            "comments": comments,
        }).execute()
    except Exception:
        logger.warning("milestone_scrape: snapshot insert failed for %s", reel_id, exc_info=True)

    try:
        compute_competitor_milestone_averages(
            supabase, competitor_id=competitor_id, client_id=client_id
        )
    except Exception:
        logger.warning("milestone_scrape: avg recompute failed for competitor %s", competitor_id, exc_info=True)

    _complete_job(supabase, job_id, {
        "reel_id": reel_id,
        "milestone_hours": milestone_hours,
        "views": views,
        "comments": comments,
    })


def _complete_job(supabase, job_id: str, result: dict) -> None:
    supabase.table("background_jobs").update({
        "status": "completed",
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "result": result,
    }).eq("id", job_id).execute()
