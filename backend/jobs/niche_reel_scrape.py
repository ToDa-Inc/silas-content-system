"""niche_reel_scrape — keyword reel discovery (clips/search) + Apify enrich → scraped_reels.

Parallel to competitor discovery: does not write competitors. Rows use competitor_id NULL unless
the same post_url already exists from a profile scrape (preserved).
"""

from __future__ import annotations

import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from core.config import Settings
from core.database import get_supabase_for_settings
from core.id_generator import generate_reel_id
from services.apify import instagram_reel_scraper_input, run_actor, run_keyword_reel_search
from services.apify_posted_at import apify_instagram_item_posted_at_iso
from services.apify_reel_fields import saves_and_shares_from_item, video_duration_seconds_from_item
from services.format_digest_jobs import enqueue_auto_analyze_scraped, enqueue_format_digest_recompute
from services.instagram_post_url import canonical_instagram_post_url
from services.niche_queries import build_niche_reel_search_queries
from services.reel_snapshots import insert_snapshots_for_scrape_job
from services.reel_thumbnail_url import reel_thumbnail_url_from_apify_item

DEFAULT_OUTLIER_RATIO_THRESHOLD = 5.0


def _caption_text(item: dict) -> str:
    c = item.get("caption")
    if isinstance(c, dict):
        return str(c.get("text") or "")[:8000]
    if isinstance(c, str):
        return c[:8000]
    return ""


def _post_url_from_item(item: dict, fallback: str) -> str:
    u = item.get("url")
    if u:
        return canonical_instagram_post_url(str(u).strip())
    sc = item.get("shortCode")
    if sc:
        return canonical_instagram_post_url(f"https://www.instagram.com/reel/{sc}/")
    return canonical_instagram_post_url(fallback)


def _hashtags(item: dict, caption: str) -> List[str]:
    raw = item.get("hashtags")
    if isinstance(raw, list) and raw:
        return [str(x).strip() for x in raw if x][:50]
    return re.findall(r"#[\w\u00C0-\u024F]+", caption)[:50]


def _owner_username(item: dict, fallback: str) -> str:
    for key in ("ownerUsername", "username", "owner"):
        v = item.get(key)
        if v:
            return str(v).strip().lstrip("@")
    return fallback.replace("@", "").strip() or "unknown"


def _ratio_decimal(metric: int, avg: int) -> Optional[Decimal]:
    if avg <= 0:
        return None
    return round(Decimal(metric) / Decimal(avg), 2)


def _ratio_str(r: Optional[Decimal]) -> Optional[str]:
    return str(r) if r is not None else None


def _batch_avgs_by_owner(rows: List[Tuple[str, str, dict]]) -> Dict[str, Tuple[int, int, int]]:
    """owner_lower -> (avg_views, avg_likes, avg_comments) for items in this scrape only."""
    by_o: Dict[str, List[dict]] = defaultdict(list)
    for _url, owner, item in rows:
        key = owner.lower()
        by_o[key].append(item)
    out: Dict[str, Tuple[int, int, int]] = {}
    for own, items in by_o.items():
        vs = [int(x.get("videoViewCount") or x.get("playsCount") or 0) for x in items]
        ls = [int(x.get("likesCount") or 0) for x in items]
        cs = [int(x.get("commentsCount") or 0) for x in items]
        n = len(items)
        if n == 0:
            continue
        out[own] = (round(sum(vs) / n), round(sum(ls) / n), round(sum(cs) / n))
    return out


def _update_query_stats(
    supabase,
    *,
    client_id: str,
    per_query_counts: Dict[str, int],
) -> None:
    """Lightweight learning: merge per-query URL yields into clients.products."""
    if not per_query_counts:
        return
    res = supabase.table("clients").select("products").eq("id", client_id).limit(1).execute()
    if not res.data:
        return
    products = dict(res.data[0].get("products") or {})
    stats = dict(products.get("niche_reel_query_stats") or {})
    for q, n in per_query_counts.items():
        key = (q or "").strip()[:200] or "_empty"
        prev = dict(stats.get(key) or {})
        runs = int(prev.get("runs") or 0) + 1
        urls_total = int(prev.get("urls_total") or 0) + int(n)
        stats[key] = {"runs": runs, "urls_total": urls_total, "last_run_at": datetime.now(timezone.utc).isoformat()}
    products["niche_reel_query_stats"] = stats
    supabase.table("clients").update({"products": products}).eq("id", client_id).execute()


def run_niche_reel_scrape(settings: Settings, job: Dict[str, Any]) -> None:
    if not settings.apify_api_token:
        raise RuntimeError("APIFY_API_TOKEN not configured")

    supabase = get_supabase_for_settings(settings)
    job_id = job["id"]
    client_id = job.get("client_id")
    if not client_id:
        raise RuntimeError("niche_reel_scrape job missing client_id")

    payload = job.get("payload") or {}
    if isinstance(payload, str):
        import json

        payload = json.loads(payload)

    max_items_kw = int(payload.get("max_items_per_keyword") or 25)
    max_items_kw = max(5, min(80, max_items_kw))
    max_total = int(payload.get("max_total_reels") or 50)
    max_total = max(5, min(200, max_total))
    include_hashtags = bool(payload.get("include_hashtags", True))
    max_hashtag_queries = int(payload.get("max_hashtag_queries") or 6)
    max_hashtag_queries = max(0, min(12, max_hashtag_queries))

    crow = (
        supabase.table("clients")
        .select("niche_config, outlier_ratio_threshold")
        .eq("id", client_id)
        .limit(1)
        .execute()
    )
    if not crow.data:
        raise RuntimeError("Client not found")
    client_row = crow.data[0]
    niches = client_row.get("niche_config") or []
    threshold = float(
        client_row.get("outlier_ratio_threshold") or DEFAULT_OUTLIER_RATIO_THRESHOLD
    )

    queries = build_niche_reel_search_queries(
        niches if isinstance(niches, list) else [],
        payload,
        include_hashtags=include_hashtags,
        max_hashtag_queries=max_hashtag_queries,
    )

    progress: Dict[str, Any] = {
        "pipeline": "niche_reel_scrape",
        "phase": "keyword_search",
        "queries_planned": queries,
        "max_items_per_keyword": max_items_kw,
        "max_total_reels": max_total,
    }
    supabase.table("background_jobs").update({"result": progress}).eq("id", job_id).execute()

    candidates: List[Tuple[str, str, str]] = []
    seen_urls: set[str] = set()
    per_query_counts: Dict[str, int] = {}

    for q in queries:
        if len(candidates) >= max_total:
            break
        try:
            items = run_keyword_reel_search(
                settings.apify_api_token, q, max_items=max_items_kw
            )
        except Exception as e:
            per_query_counts[q] = 0
            progress.setdefault("keyword_errors", []).append({"query": q, "error": str(e)[:300]})
            supabase.table("background_jobs").update({"result": dict(progress)}).eq("id", job_id).execute()
            continue
        n_new = 0
        for it in items or []:
            if len(candidates) >= max_total:
                break
            ru = str(it.get("reel_url") or it.get("url") or "").strip()
            if not ru:
                continue
            url_key = canonical_instagram_post_url(ru)
            if not url_key or url_key in seen_urls:
                continue
            seen_urls.add(url_key)
            u = str(it.get("user_name") or it.get("username") or "").strip().lstrip("@").lower()
            candidates.append((url_key, u or "unknown", q))
            n_new += 1
        per_query_counts[q] = n_new
        progress["phase"] = "enriching"
        progress["candidates_so_far"] = len(candidates)
        supabase.table("background_jobs").update({"result": dict(progress)}).eq("id", job_id).execute()

    enriched: List[Tuple[str, str, str, dict]] = []
    for url_key, uname_hint, q in candidates:
        try:
            items = run_actor(
                settings.apify_api_token,
                settings.apify_reel_actor,
                instagram_reel_scraper_input(
                    [url_key],
                    1,
                    include_shares_count=settings.apify_include_shares_count,
                ),
            )
        except Exception as e:
            progress.setdefault("enrich_errors", []).append(
                {"url": url_key, "query": q, "error": str(e)[:200]}
            )
            continue
        if not items:
            continue
        item = items[0]
        if item.get("type") not in ("Video", "GraphVideo"):
            continue
        views = int(item.get("videoViewCount") or item.get("playsCount") or 0)
        if views <= 0:
            continue
        owner = _owner_username(item, uname_hint)
        enriched.append((url_key, owner, q, item))
        time.sleep(0.2)

    progress["enriched_count"] = len(enriched)
    supabase.table("background_jobs").update({"result": dict(progress)}).eq("id", job_id).execute()

    avgs_by_owner = _batch_avgs_by_owner([(u, o, it) for u, o, _q, it in enriched])

    url_keys = [e[0] for e in enriched]
    existing_by_url: Dict[str, Dict[str, Any]] = {}
    chunk = 80
    for i in range(0, len(url_keys), chunk):
        part = url_keys[i : i + chunk]
        if not part:
            continue
        er = (
            supabase.table("scraped_reels")
            .select("id, post_url, competitor_id, source")
            .eq("client_id", client_id)
            .in_("post_url", part)
            .execute()
        )
        for row in er.data or []:
            pu = canonical_instagram_post_url(str(row.get("post_url") or ""))
            if pu:
                existing_by_url[pu] = row

    batch: List[Dict[str, Any]] = []
    for url_key, owner, _q, item in enriched:
        ex = existing_by_url.get(url_key)
        if ex and str(ex.get("source") or "") == "client_baseline":
            continue

        post_url = _post_url_from_item(item, url_key)
        post_url = canonical_instagram_post_url(post_url)
        caption = _caption_text(item)
        views = int(item.get("videoViewCount") or item.get("playsCount") or 0)
        likes = int(item.get("likesCount") or 0)
        comments = int(item.get("commentsCount") or 0)
        saves, shares = saves_and_shares_from_item(item)
        thumb = reel_thumbnail_url_from_apify_item(item)
        hook = (caption.split("\n")[0][:500] if caption else "") or None
        video_duration = video_duration_seconds_from_item(item)

        if ex:
            reel_pk = str(ex["id"])
            competitor_id = ex.get("competitor_id")
            source = str(ex.get("source") or "niche_search")
        else:
            reel_pk = generate_reel_id()
            competitor_id = None
            source = "niche_search"

        avg_key = owner.lower()
        avg_v, avg_l, avg_c = avgs_by_owner.get(avg_key, (0, 0, 0))
        if avg_v <= 0:
            avg_v = max(views, 1)
        if avg_l <= 0:
            avg_l = max(likes, 1)
        if avg_c <= 0:
            avg_c = max(comments, 1)

        rv = _ratio_decimal(views, avg_v)
        rl = _ratio_decimal(likes, avg_l)
        rc = _ratio_decimal(comments, avg_c)
        is_out_v = rv is not None and float(rv) >= threshold
        is_out_l = rl is not None and float(rl) >= threshold
        is_out_c = rc is not None and float(rc) >= threshold
        is_any = is_out_v or is_out_l or is_out_c
        ratio_vals = [float(x) for x in (rv, rl, rc) if x is not None]
        max_r = max(ratio_vals) if ratio_vals else None
        legacy_ratio_str = f"{max_r:.2f}" if max_r is not None else None

        batch.append(
            {
                "id": reel_pk,
                "client_id": client_id,
                "competitor_id": competitor_id,
                "scrape_job_id": job_id,
                "post_url": post_url,
                "thumbnail_url": str(thumb) if thumb else None,
                "account_username": owner,
                "account_avg_views": avg_v,
                "account_avg_likes": avg_l,
                "account_avg_comments": avg_c,
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
                "source": source,
                "video_duration": video_duration,
            }
        )

    done_at = datetime.now(timezone.utc)
    if batch:
        supabase.table("scraped_reels").upsert(batch, on_conflict="client_id,post_url").execute()
        insert_snapshots_for_scrape_job(supabase, client_id=client_id, scrape_job_id=job_id)

    try:
        _update_query_stats(supabase, client_id=client_id, per_query_counts=per_query_counts)
    except Exception:
        pass

    progress["phase"] = "completed"
    progress["reels_upserted"] = len(batch)
    progress["queries_used"] = len(queries)

    supabase.table("background_jobs").update(
        {
            "status": "completed",
            "completed_at": done_at.isoformat(),
            "result": progress,
        }
    ).eq("id", job_id).execute()

    org_id = job.get("org_id")
    if org_id and client_id:
        try:
            enqueue_format_digest_recompute(supabase, org_id=str(org_id), client_id=str(client_id))
            enqueue_auto_analyze_scraped(supabase, org_id=str(org_id), client_id=str(client_id))
        except Exception:
            pass
