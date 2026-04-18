"""keyword_reel_similarity job — niche reels via batched Sasky search + Gemini + scraped_reels + reel_analyses."""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Dict, List, Optional, Set

import httpx

from core.config import Settings
from core.database import get_supabase_for_settings
from core.id_generator import generate_reel_id
from services.apify import enrich_reel_urls_direct, run_keyword_reel_search_batch
from services.apify_posted_at import apify_instagram_item_posted_at_iso
from services.reel_thumbnail_url import reel_thumbnail_url_from_apify_item
from services.instagram_post_url import (
    canonical_instagram_post_url,
    canonical_reel_url_from_short_code,
    instagram_post_short_code,
)
from services.niche_prerank import prerank_reels_for_similarity
from services.openrouter import analyze_reel_similarity
from services.similarity_discovery_keywords import (
    DEFAULT_MAX_KEYWORDS,
    blacklisted_short_codes,
    dismissed_short_codes,
    niche_blacklist,
    niche_settings,
    similarity_scan_keywords,
)

MAX_ITEMS_PER_KEYWORD = 80
MAX_SCORE_SAFETY_CAP = 200  # hard ceiling to prevent runaway jobs — not a quality filter
SIMILARITY_THRESHOLD = 70
DEFAULT_DAYS = 30
DEFAULT_SEARCH_WINDOW = "last-1-month"
DEFAULT_MIN_VIEWS_PER_DAY = 2000.0  # views/day floor — raised since we score everything that passes

# Apify / model cost telemetry (USD).
# Verified against actor pricing pages:
#   apify~instagram-scraper (directUrls enrichment): $0.0023 / result = $2.30 / 1K
#   sasky/instagram-keyword-reels-urls-scraper:      ~$2.00 / 1K reel URLs returned
#   Gemini video analysis (via OpenRouter):          ~$0.03 / reel (ballpark, model-dependent)
_COST_SASKY_PER_1K = 2.0
_COST_ENRICH_PER_1K = 2.3
_COST_GEMINI_PER_REEL = 0.03


def _views(item: dict) -> int:
    return int(
        item.get("videoViewCount")
        or item.get("videoPlayCount")
        or item.get("playsCount")
        or 0
    )


def _duration_seconds(raw: Any) -> Optional[int]:
    """Apify often returns fractional seconds; scraped_reels.video_duration is integer."""
    if raw is None:
        return None
    try:
        return max(0, int(round(float(raw))))
    except (TypeError, ValueError):
        return None


def _caption(item: dict) -> str:
    c = item.get("caption")
    if isinstance(c, dict):
        return str(c.get("text") or "")
    return str(c or "")


def _cv_ratio(views: int, comments: int) -> float:
    if views == 0:
        return 0.0
    return round(comments / views * 1000, 2)


def _post_url(item: dict) -> str:
    u = item.get("url") or item.get("inputUrl") or ""
    if u:
        return str(u).strip()
    sc = item.get("shortCode") or ""
    if sc:
        return f"https://www.instagram.com/reel/{sc}/"
    return ""


def _owner_username(item: dict) -> str:
    return (
        item.get("ownerUsername")
        or item.get("username")
        or item.get("owner", {}).get("username")
        or ""
    ).lower().strip()


def _build_similarity_prompt(analysis_brief: str, username: str, caption: str) -> str:
    return f"""You are analyzing whether an Instagram reel is useful content inspiration for a specific coaching creator.

Watch the full video carefully. The caption is provided as context but the VIDEO is your primary source — captions are often random, promotional, or unrelated to what is actually said and shown.

CLIENT DNA BRIEF:
{analysis_brief}

---

REEL TO EVALUATE:
Account: @{username}
Caption (for context only): "{caption[:400]}"

---

Based on what you SEE AND HEAR in the video, score how useful this reel is as content inspiration for the client.

SCORING CRITERIA — a high score requires BOTH:
1. Same topic territory (workplace dynamics, difficult conversations, assertiveness, toxic environments, etc.)
2. Same content intent: TEACHING, COACHING, or EMPOWERING the viewer — NOT pure entertainment, comedy skits, or passive venting

AUTOMATIC LOW SCORE (≤ 30) — regardless of topic — if the reel is:
- A comedy skit or parody making fun of workplace situations (sarcastic/relatable entertainment)
- A rant or venting video with no actionable angle
- About sexual harassment or inappropriate boss behaviour (different problem space)
- A job-search or career-switching video (leaving the situation, not navigating it)
- Motivational fluff with no specific actionable insight

Score 0-100:
- 85-100: Same audience, same problem, same coaching intent — direct adaptation target
- 65-84: Clear overlap in topic AND coaching intent, slightly different angle
- 40-64: Right topic but wrong intent (entertainment) OR right intent but different audience
- 0-39:  Wrong audience, wrong intent, or fundamentally different problem

Respond in JSON (no markdown, no backticks):
{{"similarity_score": <0-100>, "what_the_video_is_about": "<1 sentence: topic AND format/intent>", "what_matches": "<what overlaps with client niche>", "what_differs": "<what doesn't fit>", "adaptation_angle": "<one specific idea the client could use>", "verdict": "high_match|partial_match|no_match"}}"""


_MAX_VIDEO_BYTES = 15 * 1024 * 1024  # 15 MB — Gemini multimodal limit


def _download_video(url: str, dest: Path) -> bool:
    """Stream video to dest with hard size + per-chunk read timeout.

    Uses streaming so a stalled CDN can't block the worker indefinitely.
    httpx scalar timeout=N sets connect+read+write all to N seconds, but
    for streaming the read timeout applies per-chunk, not for the full body.
    """
    if not url:
        return False
    try:
        timeout = httpx.Timeout(connect=15.0, read=30.0, write=10.0, pool=5.0)
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            with client.stream("GET", url) as r:
                if r.status_code == 403:
                    return False
                r.raise_for_status()
                written = 0
                with dest.open("wb") as fh:
                    for chunk in r.iter_bytes(chunk_size=64 * 1024):
                        written += len(chunk)
                        if written > _MAX_VIDEO_BYTES:
                            return False  # too large for Gemini — skip
                        fh.write(chunk)
        return dest.stat().st_size > 0
    except Exception:
        return False


def _parse_posted_at(iso: str) -> datetime:
    if not iso:
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return datetime.min.replace(tzinfo=timezone.utc)


def _passes_velocity_threshold(
    views: int,
    posted_at_iso: str,
    *,
    min_views_per_day: float = DEFAULT_MIN_VIEWS_PER_DAY,
) -> bool:
    """True if this reel's views/day meets the floor.

    Scale-invariant: a 30-day-old reel with 7k views (233/day) fails the same
    threshold as a 7-day-old reel with 7k views (1000/day). No hard age tiers.

    Special cases:
    - views == 0 → kept (actor sometimes fails to return counts for large accounts)
    - unknown posted_at → requires 10k absolute floor (conservative fallback)
    """
    if views == 0:
        return True
    if not posted_at_iso:
        return views >= 10_000
    age_days = max(
        1.0,
        (datetime.now(timezone.utc) - _parse_posted_at(posted_at_iso)).total_seconds() / 86400,
    )
    return (views / age_days) >= min_views_per_day


def _existing_short_codes_for_client(supabase: Any, client_id: str) -> Set[str]:
    out: Set[str] = set()
    page_size = 1000
    offset = 0
    while True:
        res = (
            supabase.table("scraped_reels")
            .select("post_url")
            .eq("client_id", client_id)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break
        for r in rows:
            sc = instagram_post_short_code(str(r.get("post_url") or ""))
            if sc:
                out.add(sc)
        if len(rows) < page_size:
            break
        offset += page_size
    return out


def _estimate_cost_usd(*, raw_n: int, enrich_n: int, score_n: int) -> float:
    return round(
        (raw_n / 1000.0) * _COST_SASKY_PER_1K
        + (enrich_n / 1000.0) * _COST_ENRICH_PER_1K
        + score_n * _COST_GEMINI_PER_REEL,
        4,
    )


def _qualifying_to_recovery_payload(
    qualifying: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """JSON-serializable rows for background_jobs.result.recovery_snapshot (replay if DB write fails)."""
    out: List[Dict[str, Any]] = []
    for r in qualifying:
        out.append(
            {
                "url": r["url"],
                "username": r["username"],
                "caption": r.get("caption"),
                "views": int(r.get("views") or 0),
                "likes": max(0, int(r.get("likes") or 0)),  # -1 = actor couldn't retrieve
                "comments": int(r.get("comments") or 0),
                "posted_at": r.get("posted_at") or None,
                "video_duration": _duration_seconds(r.get("video_duration")),
                "similarity_score": int(r.get("similarity_score") or 0),
                "gemini_parsed": r.get("gemini_parsed") or {},
                "video_analyzed": bool(r.get("video_analyzed")),
                "keywords": list(r.get("keywords") or []),
                "thumbnail_url": r.get("thumbnail_url") or None,
            }
        )
    return out


def persist_keyword_similarity_qualifying(
    supabase: Any,
    *,
    client_id: str,
    job_id: str,
    qualifying: List[Dict[str, Any]],
    model: str,
) -> int:
    """Upsert scraped_reels + reel_analyses for qualifying reels. Returns count upserted."""
    if not qualifying:
        return 0
    existing_ids_res = (
        supabase.table("scraped_reels")
        .select("id, post_url")
        .eq("client_id", client_id)
        .in_("post_url", [r["url"] for r in qualifying])
        .execute()
    )
    id_by_url: Dict[str, str] = {
        canonical_instagram_post_url(str(e.get("post_url") or "")): str(e["id"])
        for e in (existing_ids_res.data or [])
    }
    rows: List[Dict[str, Any]] = []
    for r in qualifying:
        row_id = id_by_url.get(r["url"]) or generate_reel_id()
        caption_text = r.get("caption") or None
        hook = (str(caption_text).split("\n")[0][:500] if caption_text else "") or None
        vd = _duration_seconds(r.get("video_duration"))
        rows.append(
            {
                "id": row_id,
                "client_id": client_id,
                "post_url": r["url"],
                "account_username": r["username"],
                "views": int(r.get("views") or 0),
                "likes": max(0, int(r.get("likes") or 0)),  # -1 = actor couldn't retrieve
                "comments": int(r.get("comments") or 0),
                "caption": caption_text,
                "hook_text": hook,
                "posted_at": r.get("posted_at") or None,
                "format": "reel",
                "source": "keyword_similarity",
                "video_duration": vd,
                "similarity_score": int(r.get("similarity_score") or 0),
                "scrape_job_id": job_id,
                "thumbnail_url": r.get("thumbnail_url") or None,
            }
        )
    supabase.table("scraped_reels").upsert(rows, on_conflict="client_id,post_url").execute()

    for r, row in zip(qualifying, rows):
        _upsert_keyword_similarity_analysis(
            supabase,
            client_id=client_id,
            reel_id=str(row["id"]),
            job_id=job_id,
            post_url=r["url"],
            owner=r["username"],
            model=model,
            parsed=r.get("gemini_parsed") or {},
            video_analyzed=bool(r.get("video_analyzed")),
            matched_keywords=list(r.get("keywords") or []),
        )
    return len(rows)


def apply_keyword_similarity_recovery_snapshot(settings: Settings, job_id: str) -> Dict[str, Any]:
    """Replay DB writes from a failed job's result.recovery_snapshot (same env/Supabase as original job)."""
    supabase = get_supabase_for_settings(settings)
    res = (
        supabase.table("background_jobs")
        .select("result, client_id")
        .eq("id", job_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise RuntimeError(f"background_jobs row not found: {job_id}")
    row = res.data[0]
    progress = row.get("result") if isinstance(row.get("result"), dict) else {}
    snap = progress.get("recovery_snapshot")
    if not isinstance(snap, dict):
        raise RuntimeError(
            "No recovery_snapshot on this job — only jobs that failed after scoring "
            "(with the snapshot feature) can be replayed."
        )
    client_id = str(snap.get("client_id") or row.get("client_id") or "")
    if not client_id:
        raise RuntimeError("recovery_snapshot missing client_id")
    model = str(snap.get("openrouter_model") or settings.openrouter_reel_analyze_model)
    raw_q = snap.get("qualifying")
    if not isinstance(raw_q, list) or not raw_q:
        raise RuntimeError("recovery_snapshot.qualifying is empty")
    qualifying = list(raw_q)
    n = persist_keyword_similarity_qualifying(
        supabase,
        client_id=client_id,
        job_id=job_id,
        qualifying=qualifying,
        model=model,
    )
    return {"job_id": job_id, "upserted": n, "message": "Replayed from recovery_snapshot"}


def _upsert_keyword_similarity_analysis(
    supabase: Any,
    *,
    client_id: str,
    reel_id: str,
    job_id: str,
    post_url: str,
    owner: str,
    model: str,
    parsed: Dict[str, Any],
    video_analyzed: bool,
    matched_keywords: List[str],
) -> None:
    canon = canonical_instagram_post_url(post_url)
    now = datetime.now(timezone.utc).isoformat()
    block: Dict[str, Any] = {
        "similarity_score": parsed.get("similarity_score"),
        "verdict": parsed.get("verdict"),
        "what_the_video_is_about": parsed.get("what_the_video_is_about"),
        "what_matches": parsed.get("what_matches"),
        "what_differs": parsed.get("what_differs"),
        "adaptation_angle": parsed.get("adaptation_angle"),
        "video_analyzed": video_analyzed,
        "matched_keywords": matched_keywords,
    }
    res = (
        supabase.table("reel_analyses")
        .select("id, full_analysis_json")
        .eq("client_id", client_id)
        .eq("post_url", canon)
        .limit(1)
        .execute()
    )
    if res.data:
        rid = str(res.data[0]["id"])
        old = res.data[0].get("full_analysis_json")
        merged: Dict[str, Any] = dict(old) if isinstance(old, dict) else {}
        merged["keyword_similarity"] = block
        supabase.table("reel_analyses").update(
            {
                "full_analysis_json": merged,
                "reel_id": reel_id,
                "analysis_job_id": job_id,
                "owner_username": owner,
                "model_used": model,
                "video_analyzed": video_analyzed,
                "analyzed_at": now,
                "content_angle": (str(parsed.get("verdict") or "")[:500] or None),
                "why_it_worked": (str(parsed.get("adaptation_angle") or "")[:8000] or None),
            }
        ).eq("id", rid).execute()
    else:
        supabase.table("reel_analyses").insert(
            {
                "client_id": client_id,
                "reel_id": reel_id,
                "analysis_job_id": job_id,
                "source": "keyword_similarity",
                "post_url": canon,
                "full_analysis_json": {"keyword_similarity": block},
                "owner_username": owner,
                "model_used": model,
                "video_analyzed": video_analyzed,
                "analyzed_at": now,
                "content_angle": (str(parsed.get("verdict") or "")[:500] or None),
                "why_it_worked": (str(parsed.get("adaptation_angle") or "")[:8000] or None),
            }
        ).execute()


def run_keyword_reel_similarity(settings: Settings, job: Dict[str, Any]) -> None:
    if not settings.apify_api_token or not settings.openrouter_api_key:
        raise RuntimeError("APIFY_API_TOKEN and OPENROUTER_API_KEY required")

    supabase = get_supabase_for_settings(settings)
    job_id = job["id"]
    client_id = job.get("client_id")
    if not client_id:
        raise RuntimeError("keyword_reel_similarity job missing client_id")

    payload = job.get("payload") or {}
    nset = {}  # filled after client load
    days = int(payload.get("days") or DEFAULT_DAYS)
    threshold = int(payload.get("threshold") or SIMILARITY_THRESHOLD)
    max_keywords = int(payload.get("max_keywords") or DEFAULT_MAX_KEYWORDS)
    min_video_seconds = float(payload.get("min_video_duration_seconds") or 6.0)
    payload_kw = payload.get("keywords")
    if payload_kw is not None and not isinstance(payload_kw, list):
        payload_kw = None

    now_utc = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update({"status": "running", "started_at": now_utc}).eq(
        "id", job_id
    ).execute()

    progress: Dict[str, Any] = {
        "pipeline": "keyword_reel_similarity",
        "phase": "loading_client",
        "keywords_run": [],
        "raw_urls_found": 0,
        "after_dedup": 0,
        "after_enrichment": 0,
        "after_date_filter": 0,
        "scored": 0,
        "scored_with_video": 0,
        "upserted": 0,
        "enrich_errors": [],
        "cost_estimate_usd": 0.0,
    }
    supabase.table("background_jobs").update({"result": dict(progress)}).eq("id", job_id).execute()

    crow = (
        supabase.table("clients")
        .select("name, instagram_handle, client_dna, niche_config, icp, client_context, language")
        .eq("id", client_id)
        .limit(1)
        .execute()
    )
    if not crow.data:
        raise RuntimeError("Client not found")
    client = crow.data[0]
    client_handle = (client.get("instagram_handle") or "").lower().lstrip("@")
    dna = client.get("client_dna") or {}
    analysis_brief = (dna.get("analysis_brief") or "").strip()
    if not analysis_brief:
        raise RuntimeError("client_dna.analysis_brief is empty — run DNA compilation first")

    nset = niche_settings(client)
    days = int(nset.get("recency_days") or payload.get("days") or DEFAULT_DAYS)
    threshold = int(nset.get("similarity_threshold") or payload.get("threshold") or SIMILARITY_THRESHOLD)
    # Explicit job payload wins (e.g. one-off run with max_keywords=3); else niche settings.
    if payload.get("max_keywords") is not None:
        max_keywords = int(payload["max_keywords"])
    else:
        max_keywords = int(nset.get("max_keywords") or DEFAULT_MAX_KEYWORDS)
    min_video_seconds = float(
        nset.get("min_video_seconds") or payload.get("min_video_duration_seconds") or 6.0
    )
    min_views_per_day = float(
        nset.get("min_views_per_day") or payload.get("min_views_per_day") or DEFAULT_MIN_VIEWS_PER_DAY
    )
    search_window = str(nset.get("search_window") or payload.get("search_window") or DEFAULT_SEARCH_WINDOW)

    keywords, kw_provenance = similarity_scan_keywords(
        client=client,
        payload_keywords=payload_kw,
        max_keywords=max_keywords,
    )
    progress["keyword_provenance"] = kw_provenance
    progress["keyword_count"] = len(keywords)
    progress["search_window"] = search_window
    if not keywords:
        raise RuntimeError(
            "No reel search keywords for this client. Add client_dna.similarity_keywords.auto (via DNA compile), "
            "client_context.niche.keywords_manual, niche_config topic_keywords / keywords / hashtags, "
            "content_angles (short phrases), or job payload.keywords."
        )

    bl = niche_blacklist(client)
    banned_handles = {
        str(h).lower().strip().lstrip("@") for h in (bl.get("handles") or []) if h
    }
    banned_scs = blacklisted_short_codes(client)
    dismissed_scs = dismissed_short_codes(client)

    progress["phase"] = "keyword_search"
    supabase.table("background_jobs").update({"result": dict(progress)}).eq("id", job_id).execute()

    total_limit = min(MAX_ITEMS_PER_KEYWORD * max(len(keywords), 1), 2000)
    try:
        items = run_keyword_reel_search_batch(
            settings.apify_api_token,
            keywords,
            max_items_total=total_limit,
            date=search_window,
        )
    except Exception as e:
        progress["keywords_run"].append({"error": str(e)[:200]})
        _complete_job(supabase, job_id, progress, f"Keyword search failed: {e!s}")
        return

    raw_by_sc: Dict[str, Dict[str, Any]] = {}
    for it in items:
        reel_url = (it.get("reel_url") or "").strip()
        uname = (it.get("user_name") or "").lower().strip()
        if not reel_url or not uname:
            continue
        if uname == client_handle or uname in banned_handles:
            continue
        sc = instagram_post_short_code(reel_url)
        if not sc:
            continue
        if sc in banned_scs or sc in dismissed_scs:
            continue
        kw_tag = (it.get("keyword") or it.get("query") or "").strip()
        if sc not in raw_by_sc:
            raw_by_sc[sc] = {"username": uname, "keywords": []}
        if kw_tag and kw_tag not in raw_by_sc[sc]["keywords"]:
            raw_by_sc[sc]["keywords"].append(kw_tag)
        elif not raw_by_sc[sc]["keywords"] and keywords:
            raw_by_sc[sc]["keywords"].append(keywords[0])

    progress["raw_urls_found"] = len(raw_by_sc)
    progress["keywords_run"] = [{"batch": True, "items": len(items), "unique_short_codes": len(raw_by_sc)}]
    if not raw_by_sc:
        _complete_job(supabase, job_id, progress, "No reel URLs found for keywords")
        return

    progress["phase"] = "dedup"
    supabase.table("background_jobs").update({"result": dict(progress)}).eq("id", job_id).execute()

    seen_scs = _existing_short_codes_for_client(supabase, client_id)
    new_scs: Set[str] = {sc for sc in raw_by_sc if sc not in seen_scs}
    progress["after_dedup"] = len(new_scs)
    if not new_scs:
        _complete_job(supabase, job_id, progress, "All reels already in scraped_reels for this client")
        return

    progress["phase"] = "enriching"
    supabase.table("background_jobs").update({"result": dict(progress)}).eq("id", job_id).execute()

    urls_to_enrich = [canonical_reel_url_from_short_code(sc) for sc in sorted(new_scs)]
    newer_than = f"{max(1, days)} days"
    enriched_items, enrich_errors = enrich_reel_urls_direct(
        settings.apify_api_token,
        urls_to_enrich,
        extra_input={"onlyPostsNewerThan": newer_than},
    )
    progress["enrich_errors"] = enrich_errors

    enriched_by_sc: Dict[str, dict] = {}
    for item in enriched_items:
        sc = (str(item.get("shortCode") or "")).strip()
        if not sc:
            sc = instagram_post_short_code(_post_url(item))
        if not sc:
            continue
        if sc not in enriched_by_sc:
            enriched_by_sc[sc] = item

    reels: List[Dict[str, Any]] = []
    for sc, meta in raw_by_sc.items():
        if sc not in new_scs:
            continue
        item = enriched_by_sc.get(sc)
        if not item:
            continue
        views = _views(item)
        comments = int(item.get("commentsCount") or 0)
        username = _owner_username(item) or meta["username"]
        posted_at = apify_instagram_item_posted_at_iso(item) or ""
        reels.append({
            "url": canonical_reel_url_from_short_code(sc),
            "username": username,
            "caption": _caption(item),
            "views": views,
            "likes": max(0, int(item.get("likesCount") or 0)),  # -1 = actor couldn't retrieve
            "comments": comments,
            "cv_ratio": _cv_ratio(views, comments),
            "video_url": item.get("videoUrl") or "",
            "video_duration": _duration_seconds(
                item.get("videoDuration") or item.get("duration")
            ),
            "posted_at": posted_at,
            "keywords": meta["keywords"],
            "thumbnail_url": reel_thumbnail_url_from_apify_item(item) or None,
        })

    def _passes_min_duration(row: Dict[str, Any]) -> bool:
        raw = row.get("video_duration")
        if raw is None:
            return False
        try:
            return float(raw) >= min_video_seconds
        except (TypeError, ValueError):
            return False

    before_dur = len(reels)
    reels = [r for r in reels if _passes_min_duration(r)]
    progress["skipped_short_video"] = before_dur - len(reels)

    # Velocity filter: drop reels that haven't sustained enough daily views.
    # views/day is scale-invariant — a 30-day-old reel with 7k views (233/day)
    # correctly fails the same threshold as a fresh reel with 7k views in 2 days (3500/day).
    before_views = len(reels)
    reels = [
        r for r in reels
        if _passes_velocity_threshold(
            int(r.get("views") or 0),
            str(r.get("posted_at") or ""),
            min_views_per_day=min_views_per_day,
        )
    ]
    progress["skipped_low_velocity"] = before_views - len(reels)
    progress["min_views_per_day"] = min_views_per_day
    progress["after_enrichment"] = len(reels)

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    filtered: List[Dict[str, Any]] = []
    for r in reels:
        p = _parse_posted_at(str(r.get("posted_at") or ""))
        if r.get("posted_at") and p > cutoff:
            filtered.append(r)
        elif not r.get("posted_at"):
            filtered.append(r)

    progress["after_date_filter"] = len(filtered)

    ranked = prerank_reels_for_similarity(filtered, keywords=keywords, recency_days=days)
    # Score everything that passed the filters — no arbitrary quality cap.
    # Safety ceiling only: prevents runaway jobs if upstream filters misconfigure.
    to_score = ranked[:MAX_SCORE_SAFETY_CAP]

    progress["cost_estimate_usd"] = _estimate_cost_usd(
        raw_n=len(items),
        enrich_n=len(urls_to_enrich),
        score_n=len(to_score),
    )

    if not to_score:
        msg = (
            "No reels enriched — Apify returned no data; see enrich_errors"
            if not reels
            else f"No reels within last {days} days after filter"
        )
        _complete_job(supabase, job_id, progress, msg)
        return

    progress["phase"] = "scoring"
    supabase.table("background_jobs").update({"result": dict(progress)}).eq("id", job_id).execute()

    scored: List[Dict[str, Any]] = []
    model = settings.openrouter_reel_analyze_model
    for reel in to_score:
        prompt = _build_similarity_prompt(analysis_brief, reel["username"], reel["caption"])
        tmp_path: Optional[Path] = None
        if reel["video_url"]:
            tf = NamedTemporaryFile(suffix=".mp4", delete=False)
            tmp_path = Path(tf.name)
            tf.close()
            if not _download_video(reel["video_url"], tmp_path):
                tmp_path.unlink(missing_ok=True)
                tmp_path = None
        try:
            result, used_video = analyze_reel_similarity(
                settings.openrouter_api_key,
                model,
                prompt,
                video_path=tmp_path,
            )
            score = int(result.get("similarity_score") or 0)
            verdict = result.get("verdict") or ""
            what_matches = result.get("what_matches") or ""
            what_differs = result.get("what_differs") or ""
            adaptation_angle = result.get("adaptation_angle") or ""
            video_summary = result.get("what_the_video_is_about") or ""
        except Exception:
            score = 0
            verdict = "error"
            what_matches = what_differs = adaptation_angle = video_summary = ""
            used_video = False
        finally:
            if tmp_path and tmp_path.is_file():
                tmp_path.unlink(missing_ok=True)

        scored.append({
            **reel,
            "similarity_score": score,
            "verdict": verdict,
            "video_analyzed": used_video,
            "what_the_video_is_about": video_summary,
            "what_matches": what_matches,
            "what_differs": what_differs,
            "adaptation_angle": adaptation_angle,
            "gemini_parsed": {
                "similarity_score": score,
                "verdict": verdict,
                "what_the_video_is_about": video_summary,
                "what_matches": what_matches,
                "what_differs": what_differs,
                "adaptation_angle": adaptation_angle,
            },
        })
        progress["scored"] = len(scored)
        if used_video:
            progress["scored_with_video"] = int(progress.get("scored_with_video") or 0) + 1
        time.sleep(0.5)

    progress["phase"] = "upserting"
    supabase.table("background_jobs").update({"result": dict(progress)}).eq("id", job_id).execute()

    qualifying = [r for r in scored if r["similarity_score"] >= threshold]
    if qualifying:
        # Persist replay payload before DB write — if upsert throws, worker keeps status=failed
        # but result.recovery_snapshot remains for apply_keyword_similarity_recovery_snapshot().
        progress["recovery_snapshot"] = {
            "version": 1,
            "client_id": client_id,
            "job_id": job_id,
            "similarity_threshold": threshold,
            "openrouter_model": model,
            "qualifying": _qualifying_to_recovery_payload(qualifying),
        }
        supabase.table("background_jobs").update({"result": dict(progress)}).eq("id", job_id).execute()

        progress["upserted"] = persist_keyword_similarity_qualifying(
            supabase,
            client_id=client_id,
            job_id=job_id,
            qualifying=qualifying,
            model=model,
        )

    progress["top_matches"] = [
        {
            "url": r["url"],
            "username": r["username"],
            "score": r["similarity_score"],
            "verdict": r["verdict"],
            "adaptation_angle": r["adaptation_angle"],
            "cv_ratio": r["cv_ratio"],
            "posted_at": r.get("posted_at", ""),
        }
        for r in sorted(scored, key=lambda x: x["similarity_score"], reverse=True)
        if r["similarity_score"] >= threshold
    ]
    _complete_job(supabase, job_id, progress)


def _complete_job(
    supabase: Any,
    job_id: str,
    progress: Dict[str, Any],
    message: Optional[str] = None,
) -> None:
    if message:
        progress["message"] = message
    progress["phase"] = "completed"
    supabase.table("background_jobs").update(
        {
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "result": progress,
        }
    ).eq("id", job_id).execute()
