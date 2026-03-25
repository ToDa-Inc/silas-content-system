"""profile_scrape job — Apify reels for one competitor, upsert scraped_reels via RPC."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from core.config import Settings
from core.database import get_supabase_for_settings
from services.apify import REEL_ACTOR, run_actor
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


def _reel_items(items: list) -> List[dict]:
    out = []
    for x in items:
        if x.get("type") not in ("Video", "GraphVideo"):
            continue
        views = int(x.get("videoViewCount") or x.get("playsCount") or 0)
        if views <= 0:
            continue
        out.append(x)
    return out


def run_profile_scrape(settings: Settings, job: Dict[str, Any]) -> None:
    if not settings.apify_api_token:
        raise RuntimeError("APIFY_API_TOKEN not configured")

    supabase = get_supabase_for_settings(settings)
    job_id = job["id"]
    client_id = job.get("client_id")
    if not client_id:
        raise RuntimeError("profile_scrape job missing client_id")

    payload = job.get("payload") or {}
    competitor_id = payload.get("competitor_id")
    if not competitor_id:
        raise RuntimeError("profile_scrape payload missing competitor_id")

    cres = (
        supabase.table("competitors")
        .select("id, username, avg_views, client_id")
        .eq("id", competitor_id)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not cres.data:
        raise RuntimeError("Competitor not found for client")
    comp = cres.data[0]
    username = (comp.get("username") or "").replace("@", "").strip()
    if not username:
        raise RuntimeError("Competitor has no username")

    clres = (
        supabase.table("clients")
        .select("outlier_ratio_threshold")
        .eq("id", client_id)
        .limit(1)
        .execute()
    )
    if not clres.data:
        raise RuntimeError("Client not found")
    threshold = float(clres.data[0].get("outlier_ratio_threshold") or 10.0)
    account_avg = int(comp.get("avg_views") or 0)

    items = run_actor(
        settings.apify_api_token,
        REEL_ACTOR,
        {"username": [username], "resultsLimit": 30},
    )
    videos = _reel_items(items)

    batch: List[Dict[str, Any]] = []
    for item in videos:
        url = _post_url(item)
        if not url:
            continue
        views = int(item.get("videoViewCount") or item.get("playsCount") or 0)
        likes = int(item.get("likesCount") or 0)
        comments = int(item.get("commentsCount") or 0)
        saves = int(item.get("saveCount") or 0)
        shares = int(item.get("shareCount") or 0)
        caption = _caption_text(item)
        if account_avg > 0:
            ratio = round(Decimal(views) / Decimal(account_avg), 2)
            is_out = float(ratio) >= threshold
        else:
            ratio = None
            is_out = False

        thumb = reel_thumbnail_url_from_apify_item(item)
        hook = (caption.split("\n")[0][:500] if caption else "") or None

        row = {
            "post_url": url,
            "thumbnail_url": str(thumb) if thumb else None,
            "account_username": username,
            "account_avg_views": account_avg,
            "views": views,
            "likes": likes,
            "comments": comments,
            "saves": saves,
            "shares": shares,
            "outlier_ratio": str(ratio) if ratio is not None else None,
            "is_outlier": is_out,
            "hook_text": hook,
            "caption": caption or None,
            "hashtags": _hashtags(item, caption),
            "posted_at": _posted_at_iso(item),
            "format": "reel",
            "source": "profile",
        }
        batch.append(row)

    done_at = datetime.now(timezone.utc)
    if batch:
        supabase.rpc(
            "upsert_scraped_reels_batch",
            {
                "p_client_id": client_id,
                "p_competitor_id": competitor_id,
                "p_scrape_job_id": job_id,
                "p_items": batch,
            },
        ).execute()

    supabase.table("competitors").update({"last_scraped_at": done_at.isoformat()}).eq("id", competitor_id).execute()

    supabase.table("background_jobs").update(
        {
            "status": "completed",
            "completed_at": done_at.isoformat(),
            "result": {
                "competitor_id": competitor_id,
                "username": username,
                "apify_items": len(items),
                "reels_processed": len(batch),
            },
        }
    ).eq("id", job_id).execute()
