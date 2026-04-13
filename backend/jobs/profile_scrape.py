"""profile_scrape job — Apify reels for one competitor, upsert scraped_reels via PostgREST."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from core.config import Settings
from core.database import get_supabase_for_settings
from core.id_generator import generate_reel_id
from services.apify import instagram_reel_scraper_input, run_actor
from services.apify_posted_at import apify_instagram_item_posted_at_iso
from services.instagram_post_url import canonical_instagram_post_url
from services.reel_snapshots import insert_snapshots_for_scrape_job
from services.apify_reel_fields import saves_and_shares_from_item, video_duration_seconds_from_item
from services.reel_thumbnail_url import reel_thumbnail_url_from_apify_item
from services.first_day_stats import update_milestones_for_competitor
from services.format_digest_jobs import enqueue_auto_analyze_scraped, enqueue_format_digest_recompute

# When `clients.outlier_ratio_threshold` is null, use this (also the recommended DB default).
DEFAULT_OUTLIER_RATIO_THRESHOLD = 5.0


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


def _ratio_decimal(metric: int, avg: int) -> Optional[Decimal]:
    if avg <= 0:
        return None
    return round(Decimal(metric) / Decimal(avg), 2)


def _ratio_str(r: Optional[Decimal]) -> Optional[str]:
    return str(r) if r is not None else None


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
        .select("id, username, avg_views, avg_likes, avg_comments, client_id")
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
    threshold = float(
        clres.data[0].get("outlier_ratio_threshold") or DEFAULT_OUTLIER_RATIO_THRESHOLD
    )
    raw_limit = int(payload.get("results_limit") or payload.get("limit") or 30)
    results_limit = max(1, min(50, raw_limit))

    items = run_actor(
        settings.apify_api_token,
        settings.apify_reel_actor,
        instagram_reel_scraper_input(
            [username],
            results_limit,
            include_shares_count=settings.apify_include_shares_count,
        ),
    )
    videos = _reel_items(items)

    # ── Recalculate competitor averages from this fresh batch ──
    all_views = [int(v.get("videoViewCount") or v.get("playsCount") or 0) for v in videos]
    all_likes = [int(v.get("likesCount") or 0) for v in videos]
    all_comments = [int(v.get("commentsCount") or 0) for v in videos]

    if videos:
        n = len(videos)
        account_avg_views = round(sum(all_views) / n)
        account_avg_likes = round(sum(all_likes) / n)
        account_avg_comments = round(sum(all_comments) / n)
    else:
        account_avg_views = int(comp.get("avg_views") or 0)
        account_avg_likes = int(comp.get("avg_likes") or 0)
        account_avg_comments = int(comp.get("avg_comments") or 0)

    batch: List[Dict[str, Any]] = []
    for item in videos:
        url = _post_url(item)
        if not url:
            continue
        views = int(item.get("videoViewCount") or item.get("playsCount") or 0)
        likes = int(item.get("likesCount") or 0)
        comments = int(item.get("commentsCount") or 0)
        saves, shares = saves_and_shares_from_item(item)
        caption = _caption_text(item)

        rv = _ratio_decimal(views, account_avg_views)
        rl = _ratio_decimal(likes, account_avg_likes)
        rc = _ratio_decimal(comments, account_avg_comments)

        is_out_v = rv is not None and float(rv) >= threshold
        is_out_l = rl is not None and float(rl) >= threshold
        is_out_c = rc is not None and float(rc) >= threshold
        is_any = is_out_v or is_out_l or is_out_c

        ratio_vals = [float(x) for x in (rv, rl, rc) if x is not None]
        max_r = max(ratio_vals) if ratio_vals else None
        legacy_ratio_str = f"{max_r:.2f}" if max_r is not None else None

        thumb = reel_thumbnail_url_from_apify_item(item)
        hook = (caption.split("\n")[0][:500] if caption else "") or None
        video_duration = video_duration_seconds_from_item(item)

        row = {
            "post_url": canonical_instagram_post_url(url),
            "thumbnail_url": str(thumb) if thumb else None,
            "account_username": username,
            "account_avg_views": account_avg_views,
            "account_avg_likes": account_avg_likes,
            "account_avg_comments": account_avg_comments,
            "views": views,
            "likes": likes,
            "comments": comments,
            "saves": saves,
            "shares": shares,
            "outlier_views_ratio": _ratio_str(rv),
            "outlier_likes_ratio": _ratio_str(rl),
            "outlier_comments_ratio": _ratio_str(rc),
            "is_outlier_views": is_out_v,
            "is_outlier_likes": is_out_l,
            "is_outlier_comments": is_out_c,
            "outlier_ratio": legacy_ratio_str,
            "is_outlier": is_any,
            "hook_text": hook,
            "caption": caption or None,
            "hashtags": _hashtags(item, caption),
            "posted_at": apify_instagram_item_posted_at_iso(item),
            "format": "reel",
            "source": "profile",
            "video_duration": video_duration,
        }
        batch.append(row)

    done_at = datetime.now(timezone.utc)
    if batch:
        existing_res = (
            supabase.table("scraped_reels")
            .select("id, post_url")
            .eq("client_id", client_id)
            .eq("competitor_id", competitor_id)
            .execute()
        )
        id_by_canon: Dict[str, str] = {}
        for e in existing_res.data or []:
            key = canonical_instagram_post_url(str(e.get("post_url") or ""))
            if key and key not in id_by_canon:
                id_by_canon[key] = str(e["id"])
        id_for_batch_url: Dict[str, str] = {}
        for row in batch:
            pu = str(row["post_url"])
            if pu not in id_for_batch_url:
                id_for_batch_url[pu] = id_by_canon.get(pu) or generate_reel_id()
            row["id"] = id_for_batch_url[pu]
            row["client_id"] = client_id
            row["competitor_id"] = competitor_id
            row["scrape_job_id"] = job_id

        raw_by_id = {
            str(e["id"]): str(e.get("post_url") or "")
            for e in (existing_res.data or [])
        }
        want_by_id: Dict[str, str] = {}
        for row in batch:
            rid = str(row["id"])
            if rid not in want_by_id:
                want_by_id[rid] = str(row["post_url"])
        for rid, want in want_by_id.items():
            raw = raw_by_id.get(rid)
            if raw is not None and raw != want:
                supabase.table("scraped_reels").update({"post_url": want}).eq("id", rid).execute()

        supabase.table("scraped_reels").upsert(batch, on_conflict="client_id,post_url").execute()
        insert_snapshots_for_scrape_job(supabase, client_id=client_id, scrape_job_id=job_id)

    # ── Update competitor averages + last_scraped_at in one call ──
    comp_update: Dict[str, Any] = {"last_scraped_at": done_at.isoformat()}
    if videos:
        comp_update["avg_views"] = account_avg_views
        comp_update["avg_likes"] = account_avg_likes
        comp_update["avg_comments"] = account_avg_comments
    supabase.table("competitors").update(comp_update).eq("id", competitor_id).execute()

    try:
        update_milestones_for_competitor(
            supabase, competitor_id=competitor_id, client_id=client_id
        )
    except Exception:
        pass

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

    org_id = job.get("org_id")
    if org_id and client_id:
        try:
            enqueue_format_digest_recompute(supabase, org_id=str(org_id), client_id=str(client_id))
            enqueue_auto_analyze_scraped(supabase, org_id=str(org_id), client_id=str(client_id))
        except Exception:
            pass
