"""keyword_reel_similarity job — find niche-aligned reels via keyword search + video similarity scoring.

Pipeline:
  1. Fetch client_dna (analysis_brief + keywords) from Supabase
  2. Keyword search via Sasky (4QFjEpnGE1PNEnQF2) → raw reel URLs
  3. Dedup against scraped_reels (by short code, any source)
  4. Batch enrich via apify~instagram-scraper directUrls
  5. Filter recency + min video duration; sort; score top N with Gemini
  6. Upsert to scraped_reels with source='keyword_similarity'

DB: apply backend/sql/phase11_scraped_reels_similarity_score.sql for similarity_score column.
"""

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
from services.apify import enrich_reel_urls_direct, run_keyword_reel_search
from services.apify_posted_at import apify_instagram_item_posted_at_iso
from services.instagram_post_url import (
    canonical_instagram_post_url,
    canonical_reel_url_from_short_code,
    instagram_post_short_code,
)
from services.openrouter import analyze_reel_similarity
from services.similarity_discovery_keywords import (
    DEFAULT_MAX_KEYWORDS,
    similarity_scan_keywords,
)

MAX_ITEMS_PER_KEYWORD = 80
MAX_TO_SCORE = 25
SIMILARITY_THRESHOLD = 65
DEFAULT_DAYS = 14


def _views(item: dict) -> int:
    return int(
        item.get("videoViewCount")
        or item.get("videoPlayCount")
        or item.get("playsCount")
        or 0
    )


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
    return f"""You are analyzing whether an Instagram reel addresses the same human problems as a specific content creator's niche.

Watch the full video carefully. The caption is provided as context but the VIDEO is your primary source — captions are often random, promotional, or unrelated to what is actually said and shown.

CLIENT DNA BRIEF:
{analysis_brief}

---

REEL TO EVALUATE:
Account: @{username}
Caption (for context only): "{caption[:400]}"

---

Based on what you SEE AND HEAR in the video: does this reel speak to the same audience and the same core human problem as the client?

Score 0-100:
- 85-100: Directly in the same space — same audience, same pain, same emotional territory
- 65-84: Clear overlap — similar problem or audience, slightly different angle
- 40-64: Partial — touches the topic but from a different angle or for a different person
- 0-39:  Different space — wrong audience or fundamentally different problem

Respond in JSON (no markdown, no backticks):
{{"similarity_score": <0-100>, "what_the_video_is_about": "<1 sentence summary of actual video content>", "what_matches": "<what overlaps with client niche>", "what_differs": "<what doesn't fit>", "adaptation_angle": "<one specific idea for how client could use this topic/angle>", "verdict": "high_match|partial_match|no_match"}}"""


def _download_video(url: str, dest: Path) -> bool:
    if not url:
        return False
    try:
        with httpx.Client(timeout=120.0, follow_redirects=True) as client:
            r = client.get(url)
            if r.status_code == 403:
                return False
            r.raise_for_status()
            dest.write_bytes(r.content)
            return dest.stat().st_size > 0
    except Exception:
        return False


def _parse_posted_at(iso: str) -> datetime:
    if not iso:
        return datetime.min
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return datetime.min


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


def run_keyword_reel_similarity(settings: Settings, job: Dict[str, Any]) -> None:
    if not settings.apify_api_token or not settings.openrouter_api_key:
        raise RuntimeError("APIFY_API_TOKEN and OPENROUTER_API_KEY required")

    supabase = get_supabase_for_settings(settings)
    job_id = job["id"]
    client_id = job.get("client_id")
    if not client_id:
        raise RuntimeError("keyword_reel_similarity job missing client_id")

    payload = job.get("payload") or {}
    days = int(payload.get("days") or DEFAULT_DAYS)
    max_to_score = int(payload.get("max_to_score") or MAX_TO_SCORE)
    threshold = int(payload.get("threshold") or SIMILARITY_THRESHOLD)
    max_keywords = int(payload.get("max_keywords") or DEFAULT_MAX_KEYWORDS)
    min_video_seconds = float(payload.get("min_video_duration_seconds") or 8.0)
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
        "upserted": 0,
        "enrich_errors": [],
    }
    supabase.table("background_jobs").update({"result": dict(progress)}).eq("id", job_id).execute()

    crow = (
        supabase.table("clients")
        .select("name, instagram_handle, client_dna, niche_config, icp")
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

    keywords, kw_provenance = similarity_scan_keywords(
        client=client,
        payload_keywords=payload_kw,
        max_keywords=max_keywords,
    )
    progress["keyword_provenance"] = kw_provenance
    progress["keyword_count"] = len(keywords)
    if not keywords:
        raise RuntimeError(
            "No reel search keywords for this client. Add client_dna.similarity_keywords, "
            "or niche_config content_angles / icp pain_points, or pass job payload.keywords."
        )

    progress["phase"] = "keyword_search"
    supabase.table("background_jobs").update({"result": dict(progress)}).eq("id", job_id).execute()

    raw_by_sc: Dict[str, Dict[str, Any]] = {}
    for kw in keywords:
        try:
            items = run_keyword_reel_search(
                settings.apify_api_token, kw, max_items=MAX_ITEMS_PER_KEYWORD
            )
            kw_urls = 0
            for it in items:
                reel_url = (it.get("reel_url") or "").strip()
                uname = (it.get("user_name") or "").lower().strip()
                if not reel_url or not uname:
                    continue
                if uname == client_handle:
                    continue
                sc = instagram_post_short_code(reel_url)
                if not sc:
                    continue
                if sc not in raw_by_sc:
                    raw_by_sc[sc] = {"username": uname, "keywords": []}
                if kw not in raw_by_sc[sc]["keywords"]:
                    raw_by_sc[sc]["keywords"].append(kw)
                kw_urls += 1
            progress["keywords_run"].append({"keyword": kw, "urls_found": kw_urls})
        except Exception as e:
            progress["keywords_run"].append({"keyword": kw, "error": str(e)[:100]})
        supabase.table("background_jobs").update({"result": dict(progress)}).eq("id", job_id).execute()
        time.sleep(2)

    progress["raw_urls_found"] = len(raw_by_sc)
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
    enriched_items, enrich_errors = enrich_reel_urls_direct(
        settings.apify_api_token, urls_to_enrich
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
            "likes": int(item.get("likesCount") or 0),
            "comments": comments,
            "cv_ratio": _cv_ratio(views, comments),
            "video_url": item.get("videoUrl") or "",
            "video_duration": item.get("videoDuration") or item.get("duration") or None,
            "posted_at": posted_at,
            "keywords": meta["keywords"],
        })

    def _passes_min_duration(row: Dict[str, Any]) -> bool:
        raw = row.get("video_duration")
        if raw is None:
            return True
        try:
            return float(raw) >= min_video_seconds
        except (TypeError, ValueError):
            return True

    before_dur = len(reels)
    reels = [r for r in reels if _passes_min_duration(r)]
    progress["skipped_short_video"] = before_dur - len(reels)
    progress["after_enrichment"] = len(reels)

    cutoff = datetime.now() - timedelta(days=days)
    dated = [r for r in reels if _parse_posted_at(r["posted_at"]) > cutoff]
    undated = [r for r in reels if not r["posted_at"]]
    filtered = dated + undated
    progress["after_date_filter"] = len(filtered)

    filtered.sort(
        key=lambda r: (
            int(_parse_posted_at(r["posted_at"]) > cutoff),
            r["cv_ratio"],
        ),
        reverse=True,
    )
    to_score = filtered[:max_to_score]

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
                settings.openrouter_reel_analyze_model,
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
        })
        progress["scored"] = len(scored)
        time.sleep(0.5)

    progress["phase"] = "upserting"
    supabase.table("background_jobs").update({"result": dict(progress)}).eq("id", job_id).execute()

    qualifying = [r for r in scored if r["similarity_score"] >= threshold]
    if qualifying:
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
            caption_text = r["caption"] or None
            hook = (caption_text.split("\n")[0][:500] if caption_text else "") or None
            rows.append({
                "id": row_id,
                "client_id": client_id,
                "post_url": r["url"],
                "account_username": r["username"],
                "views": r["views"],
                "likes": r["likes"],
                "comments": r["comments"],
                "caption": caption_text,
                "hook_text": hook,
                "posted_at": r["posted_at"] or None,
                "format": "reel",
                "source": "keyword_similarity",
                "video_duration": r["video_duration"],
                "similarity_score": r["similarity_score"],
                "scrape_job_id": job_id,
            })
        supabase.table("scraped_reels").upsert(rows, on_conflict="id").execute()
        progress["upserted"] = len(rows)

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
