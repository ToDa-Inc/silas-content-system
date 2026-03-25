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
from services.apify import REEL_ACTOR, run_actor
from services.openrouter import analyze_reel_silas
from services.reel_analyze_parse import parse_silas_analysis_text
from services.reel_analyze_prompt import PROMPT_VERSION, build_reel_analysis_prompt
from services.reel_thumbnail_url import reel_thumbnail_url_from_apify_item


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


def _normalize_post_url_key(url: str) -> str:
    """Stable key for UNIQUE(client_id, post_url) — strip query/fragment and trailing slash."""
    return url.strip().split("?")[0].split("#")[0].rstrip("/")


def _short_code_from_url(url: str) -> Optional[str]:
    m = re.search(r"instagram\.com/(?:reel|reels|p|tv)/([^/?#]+)", url, re.IGNORECASE)
    return m.group(1) if m else None


def _owner_username(item: dict) -> str:
    return (
        str(item.get("ownerUsername") or item.get("owner_username") or "").strip() or "unknown"
    )


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
    url_key = _normalize_post_url_key(post_url)
    caption = _caption_text(item)
    views = _views_int(item)
    likes = int(item.get("likesCount") or item.get("likes") or 0)
    comments = int(item.get("commentsCount") or item.get("comments") or 0)
    saves = int(item.get("saveCount") or 0)
    shares = int(item.get("shareCount") or 0)
    thumb = reel_thumbnail_url_from_apify_item(item)
    hook = (caption.split("\n")[0][:500] if caption else "") or None

    row = {
        "id": generate_reel_id(),
        "client_id": client_id,
        "competitor_id": None,
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
        "posted_at": _posted_at_iso(item),
        "format": "reel",
        "source": "url_paste",
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
    return row["id"]


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
) -> Optional[str]:
    """Write structured analysis into reel_analyses. Returns the analysis row id."""
    url_key = _normalize_post_url_key(post_url)
    now = datetime.now(timezone.utc).isoformat()
    scores = parsed.get("scores") or {}

    row: Dict[str, Any] = {
        "client_id": client_id,
        "reel_id": reel_id,
        "analysis_job_id": job_id,
        "source": "analyze_url",
        "post_url": url_key,
        "instant_hook_score": scores.get("instant_hook"),
        "relatability_score": scores.get("high_relatability"),
        "cognitive_tension_score": scores.get("cognitive_tension"),
        "clear_value_score": scores.get("clear_value"),
        "comment_trigger_score": scores.get("comment_trigger"),
        "full_analysis_json": {
            "full_text": full_text,
            "scores": scores,
            "video_analyzed": video_analyzed,
        },
        "owner_username": owner,
        "model_used": model,
        "prompt_version": PROMPT_VERSION,
        "video_analyzed": video_analyzed,
        "analyzed_at": now,
    }

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


# ── main job ─────────────────────────────────────────────────────────────────


def run_reel_analyze_url(settings: Settings, job: Dict[str, Any]) -> None:
    if not settings.apify_api_token or not settings.openrouter_api_key:
        raise RuntimeError("APIFY_API_TOKEN and OPENROUTER_API_KEY required")

    supabase = get_supabase_for_settings(settings)
    job_id = job["id"]
    client_id = job.get("client_id")
    if not client_id:
        raise RuntimeError("reel_analyze_url job missing client_id")

    payload = job.get("payload") or {}
    raw_url = str(payload.get("url") or "").strip()
    reel_url = raw_url.strip()
    if not reel_url or not instagram_reel_url_is_valid(reel_url):
        raise ValueError("Invalid Instagram reel or post URL")

    now = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update({"status": "running", "started_at": now}).eq(
        "id", job_id
    ).execute()

    model = settings.openrouter_reel_analyze_model
    tmp_path: Optional[Path] = None

    try:
        items = run_actor(
            settings.apify_api_token,
            REEL_ACTOR,
            {"username": [reel_url], "resultsLimit": 1},
        )
        if not items:
            _complete_with_error(supabase, job_id, "reel_not_found")
            return

        item = items[0]
        video_url = item.get("videoUrl") or item.get("video_url")
        if not video_url:
            _complete_with_error(supabase, job_id, "private_account")
            return

        # Download video to temp file.
        tmp_f = NamedTemporaryFile(suffix=".mp4", delete=False)
        tmp_path = Path(tmp_f.name)
        tmp_f.close()
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
        url_key = _normalize_post_url_key(post_url)

        prompt = build_reel_analysis_prompt(
            owner=owner,
            views=f"{views:,}",
            likes=f"{likes:,}",
            comments=f"{comments:,}",
            caption=caption,
        )

        full_text, video_analyzed = analyze_reel_silas(
            settings.openrouter_api_key,
            model,
            prompt,
            video_path=tmp_path,
        )

        parsed = parse_silas_analysis_text(full_text)

        duration = item.get("videoDuration")
        try:
            duration_int = int(duration) if duration is not None else 0
        except (TypeError, ValueError):
            duration_int = 0
        ts = _posted_at_iso(item)

        # ── Persist: scraped_reels (source=url_paste) + reel_analyses ────────
        reel_row_id: Optional[str] = None
        analysis_id: Optional[str] = None
        persist_error: Optional[str] = None
        try:
            reel_row_id = _upsert_scraped_reel_for_url_paste(
                supabase,
                client_id=client_id,
                job_id=job_id,
                post_url=post_url,
                owner=owner,
                item=item,
            )
            analysis_id = _upsert_reel_analysis(
                supabase,
                client_id=client_id,
                reel_id=reel_row_id,
                job_id=job_id,
                post_url=post_url,
                owner=owner,
                parsed=parsed,
                full_text=full_text,
                model=model,
                video_analyzed=video_analyzed,
            )
        except Exception as e:
            persist_error = str(e)[:800]

        scores = parsed.get("scores") or {}
        result_body: Dict[str, Any] = {
            "status": "completed",
            "reel": {
                "url": url_key,
                "owner": owner,
                "views": views,
                "likes": likes,
                "comments": comments,
                "duration": duration_int,
                "timestamp": ts,
            },
            "analysis": {
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
            },
        }
        if analysis_id:
            result_body["analysis_id"] = analysis_id
        if reel_row_id:
            result_body["reel_id"] = reel_row_id
        if persist_error:
            result_body["persist_error"] = persist_error

        done = datetime.now(timezone.utc).isoformat()
        supabase.table("background_jobs").update(
            {"status": "completed", "completed_at": done, "result": result_body}
        ).eq("id", job_id).execute()

    except Exception:
        if tmp_path and tmp_path.is_file():
            tmp_path.unlink(missing_ok=True)
        raise
    finally:
        if tmp_path and tmp_path.is_file():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def _complete_with_error(supabase, job_id: str, error_code: str) -> None:
    done = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update(
        {
            "status": "completed",
            "completed_at": done,
            "result": {"status": "error", "error": error_code},
        }
    ).eq("id", job_id).execute()
