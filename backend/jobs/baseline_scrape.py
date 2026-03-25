"""baseline_scrape job — ports scrapeBaseline from competitor-eval.js."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from core.config import Settings
from core.database import get_supabase_for_settings
from core.id_generator import generate_baseline_id
from services.apify import REEL_ACTOR, run_actor
from services.client_own_reels import upsert_client_own_reels
from services.reel_snapshots import insert_snapshots_for_scrape_job
from services.competitor_tier_backfill import backfill_competitor_tiers


def _avg(arr: list[int]) -> int:
    return round(sum(arr) / len(arr)) if arr else 0


def _median(arr: list[int]) -> int:
    if not arr:
        return 0
    s = sorted(arr)
    return s[len(s) // 2]


def _percentile(arr: list[int], p: float) -> int:
    if not arr:
        return 0
    s = sorted(arr)
    return s[int(len(s) * p)] if s else 0


def run_baseline_scrape(settings: Settings, job: Dict[str, Any]) -> None:
    if not settings.apify_api_token:
        raise RuntimeError("APIFY_API_TOKEN not configured")

    supabase = get_supabase_for_settings(settings)
    job_id = job["id"]
    client_id = job["client_id"]
    if not client_id:
        raise RuntimeError("baseline_scrape job missing client_id")

    res = supabase.table("clients").select("instagram_handle").eq("id", client_id).limit(1).execute()
    if not res.data:
        raise RuntimeError("Client not found")
    ig = res.data[0].get("instagram_handle")
    if not ig:
        raise RuntimeError("Client has no instagram_handle")

    items = run_actor(
        settings.apify_api_token,
        REEL_ACTOR,
        {"username": [ig.replace("@", "")], "resultsLimit": 30},
    )
    videos = [
        x
        for x in items
        if x.get("type") in ("Video", "GraphVideo") and (x.get("videoViewCount") or 0) > 0
    ]
    views = [int(v["videoViewCount"]) for v in videos]
    likes = [int(v.get("likesCount") or 0) for v in videos]

    if not views:
        raise RuntimeError("No reels with view counts returned from Apify for baseline")

    scraped_at = datetime.now(timezone.utc)
    expires_at = scraped_at + timedelta(days=7)

    row = {
        "id": generate_baseline_id(),
        "client_id": client_id,
        "avg_views": _avg(views),
        "median_views": _median(views),
        "max_views": max(views) if views else None,
        "p90_views": _percentile(views, 0.9),
        "p10_views": _percentile(views, 0.1),
        "avg_likes": _avg(likes),
        "reels_analyzed": len(videos),
        "scraped_at": scraped_at.isoformat(),
        "expires_at": expires_at.isoformat(),
    }

    supabase.table("client_baselines").insert(row).execute()

    cl_lang = "de"
    cl = supabase.table("clients").select("language").eq("id", client_id).limit(1).execute()
    if cl.data:
        cl_lang = str(cl.data[0].get("language") or "de")

    own_count = upsert_client_own_reels(
        supabase,
        client_id=client_id,
        job_id=job_id,
        ig_username=ig.replace("@", "").strip(),
        videos=videos,
        account_avg_views=int(row["median_views"] or 0),
    )
    insert_snapshots_for_scrape_job(supabase, client_id=client_id, scrape_job_id=job_id)
    backfilled = backfill_competitor_tiers(supabase, client_id, cl_lang)

    supabase.table("background_jobs").update(
        {
            "status": "completed",
            "completed_at": scraped_at.isoformat(),
            "result": {
                "pipeline": "baseline_scrape",
                "apify": {
                    "reel_actor": REEL_ACTOR,
                    "input": {
                        "username": [ig.replace("@", "").strip()],
                        "resultsLimit": 30,
                    },
                    "reference": "scripts/competitor-eval.js scrapeBaseline — same REEL_ACTOR as services/apify.py",
                },
                "reels_analyzed": len(videos),
                "median_views": row["median_views"],
                "avg_views": row["avg_views"],
                "own_reels_stored": own_count,
                "competitors_tier_backfilled": backfilled,
            },
        }
    ).eq("id", job_id).execute()
