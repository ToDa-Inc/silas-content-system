"""Single-reel analyze by URL: Apify → download MP4 → Gemini (OpenRouter) → scored output.

Flow:
  1. Apify xMc5Ga1oCONPmWJIa (URL input) → reel metadata + videoUrl
  2. Download videoUrl → temp .mp4
  3. Gemini 3 Flash Preview via OpenRouter → Silas scoring text
  4. Parse scores → upsert scraped_reels (source=url_paste) + reel_analyses

See docs/ANALYZE-REEL-ENDPOINT-SPEC.md, docs/REEL-VIDEO-ANALYSIS-SPEC.md.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Dict, List, Optional

import httpx

from core.config import Settings
from core.database import get_supabase_for_settings
from core.id_generator import generate_reel_id
from services.apify import instagram_reel_scraper_input, run_actor
from services.apify_posted_at import apify_instagram_item_posted_at_iso
from services.openrouter import analyze_reel_silas
from services.reel_analyze_parse import parse_silas_analysis_text
from services.reel_analyze_prompt import (
    PROMPT_VERSION,
    build_niche_context_block,
    build_reel_analysis_prompt,
)
from services.instagram_post_url import canonical_instagram_post_url
from services.apify_reel_fields import saves_and_shares_from_item, video_duration_seconds_from_item
from services.reel_thumbnail_url import reel_thumbnail_url_from_apify_item
from services.format_classifier import canonicalize_stored_format_key


class ReelAnalyzeTerminalError(Exception):
    """Expected failure for one URL (reel missing, private account, etc.)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


# ── helpers ──────────────────────────────────────────────────────────────────


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
        return str(u).strip()
    sc = item.get("shortCode")
    if sc:
        return f"https://www.instagram.com/reel/{sc}/"
    return fallback.strip()


def _owner_username(item: dict) -> str:
    return (
        str(item.get("ownerUsername") or item.get("owner_username") or "").strip() or "unknown"
    )


def _views_int(item: dict) -> int:
    return int(
        item.get("videoPlayCount")
        or item.get("videoViewCount")
        or item.get("playsCount")
        or 0
    )


def _hashtags(item: dict, caption: str) -> List[str]:
    raw = item.get("hashtags")
    if isinstance(raw, list) and raw:
        return [str(x).strip() for x in raw if x][:50]
    return re.findall(r"#[\w\u00C0-\u024F]+", caption)[:50]


def _download_video(url: str, dest: Path) -> None:
    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        dest.write_bytes(r.content)


def instagram_reel_url_is_valid(url: str) -> bool:
    t = url.lower()
    if "instagram.com" not in t:
        return False
    return bool(re.search(r"instagram\.com/(reel|reels|p|tv)(/|$)", t))


# ── persistence ──────────────────────────────────────────────────────────────


def _upsert_scraped_reel_for_url_paste(
    supabase,
    *,
    client_id: str,
    job_id: str,
    post_url: str,
    owner: str,
    item: dict,
) -> Optional[str]:
    """Insert/update a scraped_reels row with source='url_paste'. Returns the row id."""
    url_key = canonical_instagram_post_url(post_url)
    caption = _caption_text(item)
    views = _views_int(item)
    likes = int(item.get("likesCount") or item.get("likes") or 0)
    comments = int(item.get("commentsCount") or item.get("comments") or 0)
    saves, shares = saves_and_shares_from_item(item)
    thumb = reel_thumbnail_url_from_apify_item(item)
    hook = (caption.split("\n")[0][:500] if caption else "") or None
    video_duration = video_duration_seconds_from_item(item)

    existing_res = (
        supabase.table("scraped_reels")
        .select("id, competitor_id")
        .eq("client_id", client_id)
        .eq("post_url", url_key)
        .limit(1)
        .execute()
    )
    existing = existing_res.data[0] if existing_res.data else None
    reel_pk = str(existing["id"]) if existing else generate_reel_id()
    preserve_competitor = existing.get("competitor_id") if existing else None

    row = {
        "id": reel_pk,
        "client_id": client_id,
        "competitor_id": preserve_competitor,
        "scrape_job_id": job_id,
        "post_url": url_key,
        "thumbnail_url": str(thumb) if thumb else None,
        "account_username": owner,
        "account_avg_views": None,
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
        "source": "url_paste",
        "video_duration": video_duration,
    }

    # Upsert by (client_id, post_url) — update metrics if the reel already exists.
    supabase.table("scraped_reels").upsert(row, on_conflict="client_id,post_url").execute()

    # Fetch the id (may be existing row if conflict).
    res = (
        supabase.table("scraped_reels")
        .select("id")
        .eq("client_id", client_id)
        .eq("post_url", url_key)
        .limit(1)
        .execute()
    )
    if res.data:
        return str(res.data[0]["id"])
    return reel_pk


def _upsert_reel_analysis(
    supabase,
    *,
    client_id: str,
    reel_id: Optional[str],
    job_id: str,
    post_url: str,
    owner: str,
    parsed: Dict[str, Any],
    full_text: str,
    model: str,
    video_analyzed: bool,
    source: str = "analyze_url",
) -> Optional[str]:
    """Write structured analysis into reel_analyses. Returns the analysis row id."""
    url_key = canonical_instagram_post_url(post_url)
    now = datetime.now(timezone.utc).isoformat()
    scores = parsed.get("scores") or {}
    repl = parsed.get("replicable_elements")
    if not isinstance(repl, dict) or not repl:
        repl = None
    sugg = parsed.get("suggested_adaptations")
    if not isinstance(sugg, list) or not sugg:
        sugg = None

    full_analysis_json: Dict[str, Any] = {
        "full_text": full_text,
        "scores": scores,
        "video_analyzed": video_analyzed,
        "structured_summary": parsed.get("structured_summary"),
        "rating": parsed.get("rating"),
    }
    wt = parsed.get("weighted_total")
    if wt is not None:
        full_analysis_json["weighted_total"] = wt
    w_s = parsed.get("weighted_scores")
    if isinstance(w_s, dict) and w_s:
        full_analysis_json["weighted_scores"] = w_s
    r_s = parsed.get("raw_scores")
    if isinstance(r_s, dict) and r_s:
        full_analysis_json["raw_scores"] = r_s

    nf = parsed.get("normalized_format")
    if isinstance(nf, str) and nf.strip():
        nf_norm = str(nf).strip()
    else:
        nf_norm = None

    row: Dict[str, Any] = {
        "client_id": client_id,
        "reel_id": reel_id,
        "analysis_job_id": job_id,
        "source": source,
        "post_url": url_key,
        "instant_hook_score": scores.get("instant_hook"),
        "relatability_score": scores.get("high_relatability"),
        "cognitive_tension_score": scores.get("cognitive_tension"),
        "clear_value_score": scores.get("clear_value"),
        "comment_trigger_score": scores.get("comment_trigger"),
        "hook_type": parsed.get("hook_type"),
        "emotional_trigger": parsed.get("emotional_trigger"),
        "content_angle": parsed.get("content_angle"),
        "caption_structure": parsed.get("caption_structure"),
        "why_it_worked": parsed.get("why_it_worked"),
        "replicable_elements": repl,
        "suggested_adaptations": sugg,
        "full_analysis_json": full_analysis_json,
        "owner_username": owner,
        "model_used": model,
        "prompt_version": PROMPT_VERSION,
        "video_analyzed": video_analyzed,
        "analyzed_at": now,
    }
    if nf_norm:
        row["normalized_format"] = nf_norm

    supabase.table("reel_analyses").upsert(row, on_conflict="client_id,post_url").execute()

    res = (
        supabase.table("reel_analyses")
        .select("id, total_score, replicability_rating")
        .eq("client_id", client_id)
        .eq("post_url", url_key)
        .limit(1)
        .execute()
    )
    if res.data:
        return str(res.data[0]["id"])
    return None


def _complete_with_error(supabase, job_id: str, error_code: str) -> None:
    done = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update(
        {
            "status": "completed",
            "completed_at": done,
            "result": {"status": "error", "error": error_code},
        }
    ).eq("id", job_id).execute()


BULK_ANALYZE_MAX_URLS = 20


def _niche_context_for_reel_analysis(supabase, client_id: str) -> Optional[str]:
    """Prefer client_dna.analysis_brief; else Source A via build_niche_context_block."""
    res = (
        supabase.table("clients")
        .select("name, instagram_handle, language, niche_config, icp, client_dna")
        .eq("id", client_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        return None
    row = res.data[0]
    dna = row.get("client_dna")
    if isinstance(dna, dict):
        brief = str(dna.get("analysis_brief") or "").strip()
        if brief:
            return brief
    ig = str(row.get("instagram_handle") or "").replace("@", "").strip()
    return build_niche_context_block(
        client_name=str(row.get("name") or ""),
        instagram_handle=ig,
        language=str(row.get("language") or "de"),
        niches=row.get("niche_config") if isinstance(row.get("niche_config"), list) else [],
        icp=row.get("icp") if isinstance(row.get("icp"), dict) else {},
    )


def _fetch_scraped_reel_by_post_url(
    supabase, client_id: str, url_key: str
) -> Optional[Dict[str, Any]]:
    res = (
        supabase.table("scraped_reels")
        .select("*")
        .eq("client_id", client_id)
        .eq("post_url", url_key)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def _fetch_prior_silas_full_text(supabase, client_id: str, url_key: str) -> str:
    try:
        res = (
            supabase.table("reel_analyses")
            .select("full_analysis_json")
            .eq("client_id", client_id)
            .eq("post_url", url_key)
            .order("analyzed_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception:
        return ""
    if not res.data:
        return ""
    raw = res.data[0].get("full_analysis_json")
    if isinstance(raw, dict):
        return str(raw.get("full_text") or "").strip()
    return ""


def _caption_from_scraped_reel_row(row: Dict[str, Any]) -> str:
    c = row.get("caption")
    if isinstance(c, dict):
        return str(c.get("text") or "")[:8000]
    if isinstance(c, str):
        return c[:8000]
    return ""


def _execute_reel_analyze_url_core(
    settings: Settings,
    supabase,
    *,
    client_id: str,
    analysis_job_id: str,
    reel_url: str,
    analysis_source: str = "analyze_url",
    niche_context: Optional[str] = None,
    skip_apify: bool = False,
) -> Dict[str, Any]:
    """Scrape one URL, run Gemini, persist. Raises ReelAnalyzeTerminalError for expected misses."""
    url_key = canonical_instagram_post_url(reel_url)

    if skip_apify:
        sr = _fetch_scraped_reel_by_post_url(supabase, client_id, url_key)
        if not sr:
            raise ReelAnalyzeTerminalError("reel_not_in_db")
        prior = _fetch_prior_silas_full_text(supabase, client_id, url_key)
        owner = str(sr.get("account_username") or "").strip() or "unknown"
        views = int(sr.get("views") or 0)
        likes = int(sr.get("likes") or 0)
        comments = int(sr.get("comments") or 0)
        caption = _caption_from_scraped_reel_row(sr)
        post_url = str(sr.get("post_url") or reel_url)
        is_carousel = (canonicalize_stored_format_key(sr.get("format")) or "") == "carousel"
        model = settings.openrouter_reel_analyze_model
        prompt = build_reel_analysis_prompt(
            owner=owner,
            views="" if is_carousel else f"{views:,}",
            likes=f"{likes:,}",
            comments=f"{comments:,}",
            caption=caption,
            niche_context=niche_context,
            text_reanalyze=True,
            prior_full_text=prior if prior else None,
            is_carousel=is_carousel,
        )
        full_text, video_analyzed = analyze_reel_silas(
            settings.openrouter_api_key,
            model,
            prompt,
            video_path=None,
            text_reanalyze=True,
        )
        parsed = parse_silas_analysis_text(full_text)
        reel_row_id = str(sr["id"])
        persist_source = f"{analysis_source}_llm_only"
        try:
            supabase.table("scraped_reels").update({"scrape_job_id": analysis_job_id}).eq(
                "id", reel_row_id
            ).execute()
        except Exception:
            pass
        analysis_id: Optional[str] = None
        persist_error: Optional[str] = None
        try:
            analysis_id = _upsert_reel_analysis(
                supabase,
                client_id=client_id,
                reel_id=reel_row_id,
                job_id=analysis_job_id,
                post_url=post_url,
                owner=owner,
                parsed=parsed,
                full_text=full_text,
                model=model,
                video_analyzed=video_analyzed,
                source=persist_source,
            )
        except Exception as e:
            persist_error = str(e)[:800]
        scores = parsed.get("scores") or {}
        analysis_payload: Dict[str, Any] = {
            "total_score": parsed.get("total_score"),
            "rating": parsed.get("rating"),
            "scores": {
                "instant_hook": scores.get("instant_hook"),
                "high_relatability": scores.get("high_relatability"),
                "cognitive_tension": scores.get("cognitive_tension"),
                "clear_value": scores.get("clear_value"),
                "comment_trigger": scores.get("comment_trigger"),
            },
            "full_text": full_text,
            "prompt_version": PROMPT_VERSION,
            "model": model,
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
            "video_analyzed": video_analyzed,
            "skip_apify": True,
        }
        if parsed.get("weighted_total") is not None:
            analysis_payload["weighted_total"] = parsed.get("weighted_total")
        rs = parsed.get("raw_scores")
        if isinstance(rs, dict) and rs:
            analysis_payload["raw_scores"] = rs
        duration_int = video_duration_seconds_from_item(dict(sr)) or 0
        ts_out = sr.get("posted_at")
        if ts_out is not None:
            ts_out = str(ts_out)
        result_body: Dict[str, Any] = {
            "status": "completed",
            "skip_apify": True,
            "reel": {
                "url": url_key,
                "owner": owner,
                "views": views,
                "likes": likes,
                "comments": comments,
                "duration": duration_int,
                "timestamp": ts_out,
            },
            "analysis": analysis_payload,
        }
        if analysis_id:
            result_body["analysis_id"] = analysis_id
        result_body["reel_id"] = reel_row_id
        if persist_error:
            result_body["persist_error"] = persist_error
        return result_body

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
        raise ReelAnalyzeTerminalError("reel_not_found")

    item = items[0]
    video_url = item.get("videoUrl") or item.get("video_url")
    if not video_url:
        raise ReelAnalyzeTerminalError("private_account")

    tmp_f = NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp_path: Optional[Path] = Path(tmp_f.name)
    tmp_f.close()
    try:
        try:
            _download_video(str(video_url), tmp_path)
        except Exception:
            if tmp_path.is_file():
                tmp_path.unlink(missing_ok=True)
            tmp_path = None

        owner = _owner_username(item)
        views = _views_int(item)
        likes = int(item.get("likesCount") or item.get("likes") or 0)
        comments = int(item.get("commentsCount") or item.get("comments") or 0)
        caption = _caption_text(item)
        post_url = _post_url_from_item(item, reel_url)
        url_key = canonical_instagram_post_url(post_url)
        model = settings.openrouter_reel_analyze_model

        prompt = build_reel_analysis_prompt(
            owner=owner,
            views=f"{views:,}",
            likes=f"{likes:,}",
            comments=f"{comments:,}",
            caption=caption,
            niche_context=niche_context,
        )

        full_text, video_analyzed = analyze_reel_silas(
            settings.openrouter_api_key,
            model,
            prompt,
            video_path=tmp_path,
        )

        parsed = parse_silas_analysis_text(full_text)

        duration_int = video_duration_seconds_from_item(item) or 0
        ts = apify_instagram_item_posted_at_iso(item)

        reel_row_id: Optional[str] = None
        analysis_id: Optional[str] = None
        persist_error: Optional[str] = None
        try:
            reel_row_id = _upsert_scraped_reel_for_url_paste(
                supabase,
                client_id=client_id,
                job_id=analysis_job_id,
                post_url=post_url,
                owner=owner,
                item=item,
            )
            analysis_id = _upsert_reel_analysis(
                supabase,
                client_id=client_id,
                reel_id=reel_row_id,
                job_id=analysis_job_id,
                post_url=post_url,
                owner=owner,
                parsed=parsed,
                full_text=full_text,
                model=model,
                video_analyzed=video_analyzed,
                source=analysis_source,
            )
        except Exception as e:
            persist_error = str(e)[:800]

        scores = parsed.get("scores") or {}
        analysis_payload: Dict[str, Any] = {
            "total_score": parsed.get("total_score"),
            "rating": parsed.get("rating"),
            "scores": {
                "instant_hook": scores.get("instant_hook"),
                "high_relatability": scores.get("high_relatability"),
                "cognitive_tension": scores.get("cognitive_tension"),
                "clear_value": scores.get("clear_value"),
                "comment_trigger": scores.get("comment_trigger"),
            },
            "full_text": full_text,
            "prompt_version": PROMPT_VERSION,
            "model": model,
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
            "video_analyzed": video_analyzed,
        }
        if parsed.get("weighted_total") is not None:
            analysis_payload["weighted_total"] = parsed.get("weighted_total")
        rs = parsed.get("raw_scores")
        if isinstance(rs, dict) and rs:
            analysis_payload["raw_scores"] = rs

        result_body: Dict[str, Any] = {
            "status": "completed",
            "skip_apify": False,
            "reel": {
                "url": url_key,
                "owner": owner,
                "views": views,
                "likes": likes,
                "comments": comments,
                "duration": duration_int,
                "timestamp": ts,
            },
            "analysis": analysis_payload,
        }
        if analysis_id:
            result_body["analysis_id"] = analysis_id
        if reel_row_id:
            result_body["reel_id"] = reel_row_id
        if persist_error:
            result_body["persist_error"] = persist_error
        return result_body
    finally:
        if tmp_path and tmp_path.is_file():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def run_reel_analyze_url(settings: Settings, job: Dict[str, Any]) -> None:
    if not settings.openrouter_api_key:
        raise RuntimeError("OPENROUTER_API_KEY required")

    supabase = get_supabase_for_settings(settings)
    job_id = job["id"]
    client_id = job.get("client_id")
    if not client_id:
        raise RuntimeError("reel_analyze_url job missing client_id")

    payload = job.get("payload") or {}
    skip_apify = bool(payload.get("skip_apify"))
    raw_url = str(payload.get("url") or "").strip()
    reel_url = raw_url.strip()
    if not reel_url or not instagram_reel_url_is_valid(reel_url):
        raise ValueError("Invalid Instagram reel or post URL")

    if not skip_apify and not settings.apify_api_token:
        raise RuntimeError("APIFY_API_TOKEN required unless skip_apify is true")

    now = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update({"status": "running", "started_at": now}).eq(
        "id", job_id
    ).execute()

    niche_ctx = _niche_context_for_reel_analysis(supabase, client_id)
    try:
        result_body = _execute_reel_analyze_url_core(
            settings,
            supabase,
            client_id=client_id,
            analysis_job_id=job_id,
            reel_url=reel_url,
            analysis_source="analyze_url",
            niche_context=niche_ctx,
            skip_apify=skip_apify,
        )
        done = datetime.now(timezone.utc).isoformat()
        supabase.table("background_jobs").update(
            {"status": "completed", "completed_at": done, "result": result_body}
        ).eq("id", job_id).execute()
    except ReelAnalyzeTerminalError as e:
        _complete_with_error(supabase, job_id, e.code)


def run_reel_analyze_bulk(settings: Settings, job: Dict[str, Any]) -> None:
    if not settings.openrouter_api_key:
        raise RuntimeError("OPENROUTER_API_KEY required")

    supabase = get_supabase_for_settings(settings)
    job_id = job["id"]
    client_id = job.get("client_id")
    if not client_id:
        raise RuntimeError("reel_analyze_bulk job missing client_id")

    payload = job.get("payload") or {}
    skip_apify = bool(payload.get("skip_apify"))
    if not skip_apify and not settings.apify_api_token:
        raise RuntimeError("APIFY_API_TOKEN required unless skip_apify is true")

    raw_urls = payload.get("urls") or []
    if not isinstance(raw_urls, list):
        raise ValueError("reel_analyze_bulk: urls must be a list")

    urls: List[str] = []
    seen: set[str] = set()
    for u in raw_urls:
        s = str(u).strip()
        if not s or not instagram_reel_url_is_valid(s):
            continue
        key = canonical_instagram_post_url(s)
        if key in seen:
            continue
        seen.add(key)
        urls.append(s)
        if len(urls) >= BULK_ANALYZE_MAX_URLS:
            break

    if not urls:
        raise ValueError("reel_analyze_bulk: no valid Instagram URLs")

    now = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update({"status": "running", "started_at": now}).eq(
        "id", job_id
    ).execute()

    niche_ctx = _niche_context_for_reel_analysis(supabase, client_id)

    succeeded = 0
    items_out: List[Dict[str, Any]] = []
    failures: List[Dict[str, str]] = []

    for i, reel_url in enumerate(urls):
        prog = {
            "status": "running",
            "progress": {"done": i, "total": len(urls), "current_url": reel_url},
        }
        supabase.table("background_jobs").update({"result": prog}).eq("id", job_id).execute()

        try:
            one = _execute_reel_analyze_url_core(
                settings,
                supabase,
                client_id=client_id,
                analysis_job_id=job_id,
                reel_url=reel_url,
                analysis_source="analyze_bulk",
                niche_context=niche_ctx,
                skip_apify=skip_apify,
            )
            succeeded += 1
            items_out.append(
                {
                    "url": one.get("reel", {}).get("url") or canonical_instagram_post_url(reel_url),
                    "ok": True,
                    "reel_id": one.get("reel_id"),
                    "analysis_id": one.get("analysis_id"),
                }
            )
        except ReelAnalyzeTerminalError as e:
            failures.append({"url": canonical_instagram_post_url(reel_url), "error": e.code})
            items_out.append(
                {
                    "url": canonical_instagram_post_url(reel_url),
                    "ok": False,
                    "error": e.code,
                }
            )
        except Exception as e:
            err = str(e)[:500]
            failures.append({"url": canonical_instagram_post_url(reel_url), "error": err})
            items_out.append(
                {
                    "url": canonical_instagram_post_url(reel_url),
                    "ok": False,
                    "error": err,
                }
            )

    done = datetime.now(timezone.utc).isoformat()
    summary: Dict[str, Any] = {
        "status": "completed",
        "bulk": True,
        "total": len(urls),
        "succeeded": succeeded,
        "failed": len(urls) - succeeded,
        "items": items_out,
    }
    if failures:
        summary["failures"] = failures

    supabase.table("background_jobs").update(
        {"status": "completed", "completed_at": done, "result": summary}
    ).eq("id", job_id).execute()
