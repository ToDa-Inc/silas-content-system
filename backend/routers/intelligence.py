from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from supabase import Client

from core.config import Settings, get_settings
from core.database import get_supabase, get_supabase_for_settings
from core.id_generator import generate_job_id
from core.deps import require_org_access, resolve_client_id
from jobs.baseline_scrape import run_baseline_scrape
from jobs.client_auto_profile import run_client_auto_profile
from jobs.competitor_discovery import run_competitor_discovery
from jobs.profile_scrape import run_profile_scrape
from jobs.reel_analyze_url import (
    instagram_reel_url_is_valid,
    run_reel_analyze_bulk,
    run_reel_analyze_url,
)
from models.competitor import (
    CompetitorAddBody,
    CompetitorOut,
    CompetitorPreviewBody,
    DiscoverBody,
    ScrapeCompetitorReelsBody,
)
from models.reel import (
    AnalyzeReelBulkBody,
    AnalyzeReelUrlBody,
    ReelAnalysisDetailOut,
    ReelAnalysisOut,
    ScrapedReelOut,
    TopicSearchBody,
)
from services.apify import run_keyword_reel_search
from services.competitor_manual import add_manual_competitor, preview_manual_competitor
from services.job_queue import fail_abandoned_queued_jobs, has_active_job
from services.scrape_cycle import find_stale_competitors

router = APIRouter(prefix="/api/v1", tags=["intelligence"])


def _ensure_utc(dt: datetime) -> datetime:
    """Postgres / ISO strings often yield naive datetimes; activity compares to UTC-aware `since`."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_since(since: Optional[str]) -> datetime:
    if not since or not since.strip():
        return datetime.now(timezone.utc) - timedelta(hours=24)
    try:
        return _ensure_utc(datetime.fromisoformat(since.replace("Z", "+00:00")))
    except (ValueError, TypeError):
        return datetime.now(timezone.utc) - timedelta(hours=24)


def _dt_from_row(val: Any) -> Optional[datetime]:
    if not val:
        return None
    try:
        return _ensure_utc(datetime.fromisoformat(str(val).replace("Z", "+00:00")))
    except (ValueError, TypeError):
        return None


def _compute_client_stats(supabase: Client, client_id: str) -> Dict[str, Any]:
    res = (
        supabase.table("scraped_reels")
        .select("views, likes, posted_at")
        .eq("client_id", client_id)
        .is_("competitor_id", "null")
        .execute()
    )
    rows: List[dict] = res.data or []
    rows.sort(key=lambda r: str(r.get("posted_at") or ""), reverse=True)
    window = rows[:30]
    n = len(window)
    if n == 0:
        return {
            "average_views_last_30_reels": None,
            "average_likes_last_30_reels": None,
            "total_own_reels": 0,
            "avg_views_change_vs_prior_week_pct": None,
        }
    views = [int(r.get("views") or 0) for r in window]
    likes = [int(r.get("likes") or 0) for r in window]
    avg_v = round(sum(views) / n) if views else None
    avg_l = round(sum(likes) / n) if likes else None
    return {
        "average_views_last_30_reels": avg_v,
        "average_likes_last_30_reels": avg_l,
        "total_own_reels": len(rows),
        "avg_views_change_vs_prior_week_pct": None,
    }


def _group_keyword_reel_items(items: list) -> List[Dict[str, Any]]:
    by_user: dict[str, dict] = defaultdict(lambda: {"reel_urls": [], "keywords": set()})
    for it in items:
        u = str(it.get("user_name") or it.get("username") or "").strip().lower()
        if not u:
            continue
        ru = str(it.get("reel_url") or it.get("url") or "").strip()
        kw = str(it.get("keyword") or "").strip()
        if ru:
            by_user[u]["reel_urls"].append(ru)
        if kw:
            by_user[u]["keywords"].add(kw)
    accounts: List[Dict[str, Any]] = []
    for username, d in sorted(by_user.items(), key=lambda x: -len(x[1]["reel_urls"])):
        accounts.append(
            {
                "username": username,
                "reel_count": len(d["reel_urls"]),
                "sample_urls": d["reel_urls"][:8],
            }
        )
    return accounts


def _normalize_post_url_key(url: str) -> str:
    if not url:
        return ""
    return url.strip().split("?")[0].split("#")[0].rstrip("/")


def _coerce_json_weighted_total(val: Any) -> Optional[float]:
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        s = val.strip().strip('"')
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _normalize_silas_rating(val: Any) -> Optional[str]:
    if val is None:
        return None
    if isinstance(val, str):
        t = val.strip()
        return t or None
    return str(val)


def _attach_reel_analyses(supabase: Client, client_id: str, reels: list[dict]) -> None:
    """Merge latest reel_analyses summary onto each scraped_reels row (by reel_id, else post_url)."""
    if not reels:
        return
    select_v2 = (
        "id, reel_id, post_url, total_score, replicability_rating, analyzed_at, prompt_version, "
        "weighted_total:full_analysis_json->weighted_total, silas_rating:full_analysis_json->>rating"
    )
    select_legacy = (
        "id, reel_id, post_url, total_score, replicability_rating, analyzed_at, prompt_version"
    )
    try:
        ares = supabase.table("reel_analyses").select(select_v2).eq("client_id", client_id).execute()
    except Exception:
        ares = supabase.table("reel_analyses").select(select_legacy).eq("client_id", client_id).execute()
    rows = ares.data or []
    by_reel: Dict[str, dict] = {}
    by_url: Dict[str, dict] = {}
    for a in rows:
        rid = a.get("reel_id")
        if rid:
            by_reel[str(rid)] = a
        pu = a.get("post_url")
        if pu:
            by_url[_normalize_post_url_key(str(pu))] = a
    for reel in reels:
        rid = reel.get("id")
        pu = _normalize_post_url_key(str(reel.get("post_url") or ""))
        chosen: Optional[dict] = None
        if rid and str(rid) in by_reel:
            chosen = by_reel[str(rid)]
        elif pu and pu in by_url:
            chosen = by_url[pu]
        if chosen:
            reel["analysis"] = {
                "id": str(chosen["id"]),
                "total_score": chosen.get("total_score"),
                "replicability_rating": chosen.get("replicability_rating"),
                "analyzed_at": chosen.get("analyzed_at"),
                "prompt_version": chosen.get("prompt_version"),
                "weighted_total": _coerce_json_weighted_total(chosen.get("weighted_total")),
                "silas_rating": _normalize_silas_rating(chosen.get("silas_rating")),
            }


def _fail_job(supabase: Client, job_id: str, message: str) -> None:
    supabase.table("background_jobs").update(
        {
            "status": "failed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "error_message": message[:8000],
        }
    ).eq("id", job_id).execute()


def _fetch_job_row(supabase: Client, job_id: str) -> dict:
    res = supabase.table("background_jobs").select("*").eq("id", job_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Job row missing after run")
    return res.data


def _background_reel_analyze(job_id: str) -> None:
    settings = get_settings()
    supabase = get_supabase_for_settings(settings)
    res = supabase.table("background_jobs").select("*").eq("id", job_id).single().execute()
    if not res.data:
        return
    try:
        run_reel_analyze_url(settings, res.data)
    except Exception as e:
        _fail_job(supabase, job_id, str(e))


def _reel_analyze_busy(supabase: Client, client_id: str) -> bool:
    for jt in ("reel_analyze_url", "reel_analyze_bulk"):
        if has_active_job(supabase, client_id=client_id, job_type=jt):
            return True
    return False


def _background_reel_analyze_bulk(job_id: str) -> None:
    settings = get_settings()
    supabase = get_supabase_for_settings(settings)
    res = supabase.table("background_jobs").select("*").eq("id", job_id).single().execute()
    if not res.data:
        return
    try:
        run_reel_analyze_bulk(settings, res.data)
    except Exception as e:
        _fail_job(supabase, job_id, str(e))


@router.post("/clients/{slug}/competitors/preview")
def preview_competitor(
    slug: str,
    body: CompetitorPreviewBody,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Parse handle + duplicate check only (no Apify / LLM)."""
    try:
        return preview_manual_competitor(settings, client_id=client_id, raw_input=body.input)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/clients/{slug}/competitors/add")
def add_competitor_manual(
    slug: str,
    body: CompetitorAddBody,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Insert a minimal competitors row (no scrape)."""
    try:
        return add_manual_competitor(
            settings,
            client_id=client_id,
            raw_input=body.input,
            added_by=body.added_by,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/clients/{slug}/competitors/{competitor_id}/scrape-reels")
def scrape_one_competitor_reels(
    slug: str,
    competitor_id: str,
    body: ScrapeCompetitorReelsBody,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Run profile_scrape for a single competitor (e.g. manually added — no stale-queue filter)."""
    cres = (
        supabase.table("competitors")
        .select("id")
        .eq("id", competitor_id)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not cres.data:
        raise HTTPException(status_code=404, detail="Competitor not found for this client")

    fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="profile_scrape")
    if has_active_job(
        supabase,
        client_id=client_id,
        job_type="profile_scrape",
        payload_match={"competitor_id": competitor_id},
    ):
        raise HTTPException(
            status_code=409,
            detail="A scrape is already running or queued for this competitor",
        )

    job_id = generate_job_id()
    row = {
        "id": job_id,
        "org_id": org_id,
        "client_id": client_id,
        "job_type": "profile_scrape",
        "payload": {
            "competitor_id": competitor_id,
            "results_limit": body.limit,
        },
        "status": "running",
    }
    supabase.table("background_jobs").insert(row).execute()
    job_dict = dict(row)

    try:
        run_profile_scrape(settings, job_dict)
    except Exception as e:
        _fail_job(supabase, job_id, str(e))
        raise HTTPException(status_code=500, detail=str(e)) from e

    job_row = _fetch_job_row(supabase, job_id)
    res = job_row.get("result") or {}
    return {
        "competitor_id": competitor_id,
        "reels_processed": int(res.get("reels_processed") or 0),
        "apify_items": int(res.get("apify_items") or 0),
        "username": res.get("username"),
    }


@router.delete("/clients/{slug}/competitors/{competitor_id}")
def delete_competitor(
    slug: str,
    competitor_id: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    """Remove competitor row and scraped reels for this account (reel_analyses.reel_id SET NULL)."""
    cres = (
        supabase.table("competitors")
        .select("id, username")
        .eq("id", competitor_id)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not cres.data:
        raise HTTPException(status_code=404, detail="Competitor not found for this client")

    supabase.table("scraped_reels").delete().eq("competitor_id", competitor_id).eq("client_id", client_id).execute()

    supabase.table("competitors").delete().eq("id", competitor_id).eq("client_id", client_id).execute()

    return {"ok": True, "deleted_id": competitor_id, "username": (cres.data[0] or {}).get("username")}


@router.get("/clients/{slug}/competitors", response_model=list[CompetitorOut])
def list_competitors(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> list[dict]:
    res = (
        supabase.table("competitors")
        .select("*")
        .eq("client_id", client_id)
        .order("composite_score", desc=True)
        .execute()
    )
    return res.data or []


@router.post("/clients/{slug}/competitors/discover")
def discover_competitors(
    slug: str,
    body: DiscoverBody,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="competitor_discovery")
    if has_active_job(supabase, client_id=client_id, job_type="competitor_discovery"):
        raise HTTPException(
            status_code=409,
            detail="A competitor_discovery job is already queued or running for this client",
        )
    payload = {
        "keyword": body.keyword,
        "keywords": body.keywords,
        "keyword_mode": body.keyword_mode,
        "limit": body.limit,
        "threshold": body.threshold,
        "posts_per_account": body.posts_per_account,
    }
    row = {
        "id": generate_job_id(),
        "org_id": org_id,
        "client_id": client_id,
        "job_type": "competitor_discovery",
        "payload": {k: v for k, v in payload.items() if v is not None},
        "status": "running",
    }
    supabase.table("background_jobs").insert(row).execute()
    job_id = row["id"]
    job_dict = dict(row)

    try:
        run_competitor_discovery(settings, job_dict)
    except Exception as e:
        _fail_job(supabase, job_id, str(e))
        raise HTTPException(status_code=500, detail=str(e)) from e

    job_row = _fetch_job_row(supabase, job_id)
    return {
        "job_id": job_id,
        "status": job_row.get("status"),
        "result": job_row.get("result"),
    }


@router.post("/clients/{slug}/auto-profile")
def run_auto_profile(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="client_auto_profile")
    if has_active_job(supabase, client_id=client_id, job_type="client_auto_profile"):
        raise HTTPException(
            status_code=409,
            detail="A client_auto_profile job is already queued or running for this client",
        )
    row = {
        "id": generate_job_id(),
        "org_id": org_id,
        "client_id": client_id,
        "job_type": "client_auto_profile",
        "payload": {},
        "status": "running",
    }
    supabase.table("background_jobs").insert(row).execute()
    job_id = row["id"]
    job_dict = dict(row)
    try:
        run_client_auto_profile(settings, job_dict)
    except Exception as e:
        _fail_job(supabase, job_id, str(e))
        raise HTTPException(status_code=500, detail=str(e)) from e
    job_row = _fetch_job_row(supabase, job_id)
    return {
        "job_id": job_id,
        "status": job_row.get("status"),
        "result": job_row.get("result"),
    }


@router.get("/clients/{slug}/baseline")
def get_baseline(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    res = (
        supabase.table("client_baselines")
        .select("*")
        .eq("client_id", client_id)
        .order("scraped_at", desc=True)
        .limit(10)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="No baseline yet")
    now = datetime.now(timezone.utc)
    for row in res.data:
        exp = row.get("expires_at")
        if not exp:
            return row
        try:
            exp_dt = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
            if exp_dt > now:
                return row
        except (ValueError, TypeError):
            return row
    return res.data[0]


@router.post("/clients/{slug}/baseline/refresh")
def refresh_baseline(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Legacy — same as POST …/sync/own."""
    return _run_baseline_refresh(
        org_id=org_id, client_id=client_id, supabase=supabase, settings=settings
    )


def _run_baseline_refresh(
    *,
    org_id: str,
    client_id: str,
    supabase: Client,
    settings: Settings,
) -> Dict[str, Any]:
    fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="baseline_scrape")
    if has_active_job(supabase, client_id=client_id, job_type="baseline_scrape"):
        raise HTTPException(
            status_code=409,
            detail="A sync for your reels is already running — please wait.",
        )
    row = {
        "id": generate_job_id(),
        "org_id": org_id,
        "client_id": client_id,
        "job_type": "baseline_scrape",
        "payload": {},
        "status": "running",
    }
    supabase.table("background_jobs").insert(row).execute()
    job_id = row["id"]
    job_dict = dict(row)
    try:
        run_baseline_scrape(settings, job_dict)
    except Exception as e:
        _fail_job(supabase, job_id, str(e))
        raise HTTPException(status_code=500, detail=str(e)) from e
    job_row = _fetch_job_row(supabase, job_id)
    return {
        "job_id": job_id,
        "status": job_row.get("status"),
        "result": job_row.get("result"),
    }


@router.post("/clients/{slug}/sync/own")
def sync_own_reels(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Sync only your Instagram reels (same as legacy baseline/refresh)."""
    return _run_baseline_refresh(
        org_id=org_id, client_id=client_id, supabase=supabase, settings=settings
    )


@router.post("/clients/{slug}/sync/competitors")
def sync_competitor_reels_all(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Sync reels for every competitor (not limited to stale queue)."""
    if not settings.apify_api_token:
        raise HTTPException(status_code=503, detail="APIFY_API_TOKEN not configured")
    cres = (
        supabase.table("competitors")
        .select("id")
        .eq("client_id", client_id)
        .execute()
    )
    competitor_ids = [str(r["id"]) for r in (cres.data or [])]
    details: List[Dict[str, Any]] = []
    total_reels = 0
    for comp_id in competitor_ids:
        fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="profile_scrape")
        if has_active_job(
            supabase,
            client_id=client_id,
            job_type="profile_scrape",
            payload_match={"competitor_id": comp_id},
        ):
            details.append({"competitor_id": comp_id, "skipped": "already_running"})
            continue
        job_id = generate_job_id()
        row = {
            "id": job_id,
            "org_id": org_id,
            "client_id": client_id,
            "job_type": "profile_scrape",
            "payload": {"competitor_id": comp_id, "results_limit": 30},
            "status": "running",
        }
        supabase.table("background_jobs").insert(row).execute()
        job_dict = dict(row)
        try:
            run_profile_scrape(settings, job_dict)
        except Exception as e:
            _fail_job(supabase, job_id, str(e))
            details.append({"competitor_id": comp_id, "error": str(e)[:800]})
            continue
        job_row = _fetch_job_row(supabase, job_id)
        res = job_row.get("result") or {}
        total_reels += int(res.get("reels_processed") or 0)
        details.append({"competitor_id": comp_id, "result": res})
    return {
        "competitors_attempted": len(competitor_ids),
        "reels_processed": total_reels,
        "details": details,
    }


@router.post("/clients/{slug}/sync")
def sync_all(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Sync your reels, then every competitor's reels. See docs/INTELLIGENCE-GUIDE.md."""
    if not settings.apify_api_token:
        raise HTTPException(status_code=503, detail="APIFY_API_TOKEN not configured")
    baseline: Optional[Dict[str, Any]] = None
    try:
        baseline = _run_baseline_refresh(
            org_id=org_id, client_id=client_id, supabase=supabase, settings=settings
        )
    except HTTPException as e:
        if e.status_code == 409:
            raise
        if e.status_code == 500:
            baseline = {"error": str(e.detail)}
        else:
            raise
    except Exception as e:
        baseline = {"error": str(e)[:800]}

    cres = (
        supabase.table("competitors")
        .select("id")
        .eq("client_id", client_id)
        .execute()
    )
    competitor_ids = [str(r["id"]) for r in (cres.data or [])]
    details: List[Dict[str, Any]] = []
    total_reels = 0
    for comp_id in competitor_ids:
        fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="profile_scrape")
        if has_active_job(
            supabase,
            client_id=client_id,
            job_type="profile_scrape",
            payload_match={"competitor_id": comp_id},
        ):
            details.append({"competitor_id": comp_id, "skipped": "already_running"})
            continue
        job_id = generate_job_id()
        row = {
            "id": job_id,
            "org_id": org_id,
            "client_id": client_id,
            "job_type": "profile_scrape",
            "payload": {"competitor_id": comp_id, "results_limit": 30},
            "status": "running",
        }
        supabase.table("background_jobs").insert(row).execute()
        job_dict = dict(row)
        try:
            run_profile_scrape(settings, job_dict)
        except Exception as e:
            _fail_job(supabase, job_id, str(e))
            details.append({"competitor_id": comp_id, "error": str(e)[:800]})
            continue
        job_row = _fetch_job_row(supabase, job_id)
        res = job_row.get("result") or {}
        total_reels += int(res.get("reels_processed") or 0)
        details.append({"competitor_id": comp_id, "result": res})
    return {
        "baseline": baseline,
        "competitors_attempted": len(competitor_ids),
        "competitor_reels_processed": total_reels,
        "competitor_details": details,
    }


@router.get("/clients/{slug}/stats")
def get_intelligence_stats(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    """Summary stats for your own reels (averages over last up to 30 stored reels)."""
    return _compute_client_stats(supabase, client_id)


@router.get("/clients/{slug}/activity")
def get_intelligence_activity(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    since: Optional[str] = Query(
        None,
        description="ISO8601 lower bound; default last 24h. Client should pass last visit time.",
    ),
) -> Dict[str, Any]:
    """High-signal changes since `since`: new breakout competitor reels, optional own-reel growth."""
    since_dt = _parse_since(since)
    res = (
        supabase.table("scraped_reels")
        .select("*")
        .eq("client_id", client_id)
        .eq("is_outlier", True)
        .not_.is_("competitor_id", "null")
        .execute()
    )
    rows: List[dict] = res.data or []
    new_breakouts: List[dict] = []
    for r in rows:
        lu = r.get("last_updated_at") or r.get("first_seen_at") or r.get("created_at")
        dt = _dt_from_row(lu)
        if dt is None or dt >= since_dt:
            new_breakouts.append(r)

    growth: List[Dict[str, Any]] = []
    try:
        own = (
            supabase.table("scraped_reels")
            .select("id")
            .eq("client_id", client_id)
            .is_("competitor_id", "null")
            .limit(40)
            .execute()
        )
        own_ids = [str(x["id"]) for x in (own.data or [])]
        for rid in own_ids[:20]:
            snaps = (
                supabase.table("reel_snapshots")
                .select("views, scraped_at")
                .eq("reel_id", rid)
                .order("scraped_at", desc=True)
                .limit(2)
                .execute()
            )
            srows = snaps.data or []
            if len(srows) < 2:
                continue
            v_new = int(srows[0].get("views") or 0)
            v_old = int(srows[1].get("views") or 0)
            gained = v_new - v_old
            if gained > 0:
                growth.append(
                    {
                        "reel_id": rid,
                        "views_gained": gained,
                        "views_now": v_new,
                    }
                )
        growth.sort(key=lambda x: -x["views_gained"])
        growth = growth[:5]
        for g in growth:
            try:
                rres = (
                    supabase.table("scraped_reels")
                    .select(
                        "post_url, thumbnail_url, hook_text, caption, account_username, "
                        "views, likes, comments"
                    )
                    .eq("id", g["reel_id"])
                    .eq("client_id", client_id)
                    .limit(1)
                    .execute()
                )
                if rres.data:
                    meta = rres.data[0]
                    g["post_url"] = meta.get("post_url")
                    g["thumbnail_url"] = meta.get("thumbnail_url")
                    g["hook_text"] = meta.get("hook_text")
                    g["caption"] = meta.get("caption")
                    g["account_username"] = meta.get("account_username")
                    g["likes"] = meta.get("likes")
                    g["comments"] = meta.get("comments")
            except Exception:
                pass
    except Exception:
        growth = []

    return {
        "since": since_dt.isoformat(),
        "new_breakout_reels": new_breakouts[:12],
        "own_reel_growth": growth,
        "is_quiet": len(new_breakouts) == 0 and len(growth) == 0,
    }


@router.post("/clients/{slug}/search/topics")
def search_topic_reels(
    slug: str,
    body: TopicSearchBody,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Keyword reel search — accounts grouped by frequency. No metrics until user adds competitor."""
    _ = org_id
    _ = client_id
    if not settings.apify_api_token:
        raise HTTPException(status_code=503, detail="APIFY_API_TOKEN not configured")
    items = run_keyword_reel_search(
        settings.apify_api_token,
        body.keyword.strip(),
        max_items=body.max_items,
    )
    accounts = _group_keyword_reel_items(items)
    return {
        "keyword": body.keyword.strip(),
        "total_items": len(items),
        "accounts": accounts,
    }


@router.post("/clients/{slug}/reels/analyze-url")
def analyze_reel_by_url(
    slug: str,
    body: AnalyzeReelUrlBody,
    background_tasks: BackgroundTasks,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Enqueue Apify URL scrape + OpenRouter Gemini analysis; poll GET /api/v1/jobs/{job_id}."""
    if not instagram_reel_url_is_valid(body.url):
        raise HTTPException(status_code=400, detail="Invalid Instagram reel or post URL")
    if not settings.apify_api_token or not settings.openrouter_api_key:
        raise HTTPException(
            status_code=503,
            detail="Reel analysis requires APIFY_API_TOKEN and OPENROUTER_API_KEY",
        )
    fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="reel_analyze_url")
    if _reel_analyze_busy(supabase, client_id):
        raise HTTPException(
            status_code=409,
            detail="A reel analysis is already running or queued for this client",
        )
    job_id = generate_job_id()
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "id": job_id,
        "org_id": org_id,
        "client_id": client_id,
        "job_type": "reel_analyze_url",
        "payload": {"url": body.url.strip()},
        "status": "running",
        "started_at": now,
    }
    supabase.table("background_jobs").insert(row).execute()
    background_tasks.add_task(_background_reel_analyze, job_id)
    return {"job_id": job_id, "status": "queued"}


@router.post("/clients/{slug}/reels/analyze-bulk")
def analyze_reels_bulk(
    slug: str,
    body: AnalyzeReelBulkBody,
    background_tasks: BackgroundTasks,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Enqueue sequential URL analyses (same pipeline as analyze-url). Poll GET /api/v1/jobs/{job_id}."""
    if not settings.apify_api_token or not settings.openrouter_api_key:
        raise HTTPException(
            status_code=503,
            detail="Reel analysis requires APIFY_API_TOKEN and OPENROUTER_API_KEY",
        )
    cleaned: list[str] = []
    for u in body.urls:
        s = str(u).strip()
        if not s:
            continue
        if not instagram_reel_url_is_valid(s):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid Instagram reel or post URL: {s[:80]}",
            )
        cleaned.append(s)
    if not cleaned:
        raise HTTPException(status_code=400, detail="No valid URLs in request")

    fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="reel_analyze_bulk")
    if _reel_analyze_busy(supabase, client_id):
        raise HTTPException(
            status_code=409,
            detail="A reel analysis is already running or queued for this client",
        )

    job_id = generate_job_id()
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "id": job_id,
        "org_id": org_id,
        "client_id": client_id,
        "job_type": "reel_analyze_bulk",
        "payload": {"urls": cleaned},
        "status": "running",
        "started_at": now,
    }
    supabase.table("background_jobs").insert(row).execute()
    background_tasks.add_task(_background_reel_analyze_bulk, job_id)
    return {"job_id": job_id, "status": "queued", "count": len(cleaned)}


@router.get("/clients/{slug}/reels/active-analysis")
def get_active_reel_analysis_job(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    """Running or queued Silas reel job so the UI can resume polling after reload."""
    res = (
        supabase.table("background_jobs")
        .select("id, job_type, status, started_at")
        .eq("client_id", client_id)
        .in_("job_type", ["reel_analyze_url", "reel_analyze_bulk"])
        .in_("status", ["queued", "running"])
        .order("started_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return {"active": False}
    row = rows[0]
    return {
        "active": True,
        "job_id": row["id"],
        "job_type": row["job_type"],
        "status": row.get("status"),
        "started_at": row.get("started_at"),
    }


@router.get("/clients/{slug}/reel-analyses", response_model=list[ReelAnalysisOut])
def list_client_reel_analyses(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    limit: int = Query(20, ge=1, le=100),
) -> list[dict]:
    """Saved Silas analyses (linked to scraped_reels via reel_id). Requires sql/phase2_reel_analyses.sql."""
    select_v2 = (
        "id, client_id, reel_id, analysis_job_id, source, post_url, owner_username, "
        "instant_hook_score, relatability_score, cognitive_tension_score, clear_value_score, "
        "comment_trigger_score, total_score, replicability_rating, model_used, prompt_version, "
        "video_analyzed, analyzed_at, created_at, "
        "weighted_total:full_analysis_json->weighted_total, silas_rating:full_analysis_json->>rating"
    )
    select_legacy = (
        "id, client_id, reel_id, analysis_job_id, source, post_url, owner_username, "
        "instant_hook_score, relatability_score, cognitive_tension_score, clear_value_score, "
        "comment_trigger_score, total_score, replicability_rating, model_used, prompt_version, "
        "video_analyzed, analyzed_at, created_at"
    )
    try:
        res = (
            supabase.table("reel_analyses")
            .select(select_v2)
            .eq("client_id", client_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception:
        res = (
            supabase.table("reel_analyses")
            .select(select_legacy)
            .eq("client_id", client_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    rows = res.data or []
    for row in rows:
        row["weighted_total"] = _coerce_json_weighted_total(row.get("weighted_total"))
        row["silas_rating"] = _normalize_silas_rating(row.get("silas_rating"))
    return rows


@router.get("/clients/{slug}/reels", response_model=list[ScrapedReelOut])
def list_reels(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    outlier_only: bool = Query(False),
    own_reels_only: bool = Query(
        False,
        description="Only reels scraped from the client's own profile (competitor_id IS NULL).",
    ),
    include_analysis: bool = Query(
        False,
        description="Attach Silas analysis summary (id, score, rating) when a reel_analyses row exists.",
    ),
) -> list[dict]:
    q = supabase.table("scraped_reels").select("*").eq("client_id", client_id)
    if own_reels_only:
        q = q.is_("competitor_id", "null")
    if outlier_only:
        q = q.eq("is_outlier", True)
    if own_reels_only:
        res = q.order("views", desc=True).execute()
    else:
        res = q.order("outlier_ratio", desc=True).execute()
    data = res.data or []
    if include_analysis and data:
        try:
            _attach_reel_analyses(supabase, client_id, data)
        except Exception:
            # Table missing or RLS — return reels without analysis
            pass
    return data


@router.get("/clients/{slug}/reels/{reel_id}/analysis", response_model=ReelAnalysisDetailOut)
def get_reel_analysis_by_reel_id(
    slug: str,
    reel_id: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    """Full Silas analysis JSON for a scraped reel (requires reel_analyses row)."""
    rc = (
        supabase.table("scraped_reels")
        .select("id, post_url")
        .eq("id", reel_id)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not rc.data:
        raise HTTPException(status_code=404, detail="Reel not found for this client")

    post_url = _normalize_post_url_key(str(rc.data[0].get("post_url") or ""))

    ares = (
        supabase.table("reel_analyses")
        .select("*")
        .eq("client_id", client_id)
        .eq("reel_id", reel_id)
        .limit(1)
        .execute()
    )
    if ares.data:
        return ares.data[0]

    if post_url:
        ares2 = (
            supabase.table("reel_analyses")
            .select("*")
            .eq("client_id", client_id)
            .eq("post_url", post_url)
            .limit(1)
            .execute()
        )
        if ares2.data:
            return ares2.data[0]

    raise HTTPException(status_code=404, detail="No analysis stored for this reel")


@router.post("/clients/{slug}/reels/scrape")
def scrape_client_reels(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    found = find_stale_competitors(supabase, client_id=client_id)
    competitor_ids = found["competitor_ids"]

    total_reels = 0
    total_apify_items = 0
    details: list[Dict[str, Any]] = []

    for comp_id in competitor_ids:
        job_id = generate_job_id()
        row = {
            "id": job_id,
            "org_id": org_id,
            "client_id": client_id,
            "job_type": "profile_scrape",
            "payload": {"competitor_id": comp_id},
            "status": "running",
        }
        supabase.table("background_jobs").insert(row).execute()
        job_dict = dict(row)

        try:
            run_profile_scrape(settings, job_dict)
        except Exception as e:
            _fail_job(supabase, job_id, str(e))
            raise HTTPException(
                status_code=500,
                detail=f"profile_scrape failed for competitor {comp_id}: {e}",
            ) from e

        job_row = _fetch_job_row(supabase, job_id)
        res = job_row.get("result") or {}
        total_reels += int(res.get("reels_processed") or 0)
        total_apify_items += int(res.get("apify_items") or 0)
        details.append({"competitor_id": comp_id, "result": res})

    return {
        "competitors_scraped": len(competitor_ids),
        "reels_processed": total_reels,
        "apify_items": total_apify_items,
        "skipped_fresh": found["skipped_fresh"],
        "skipped_duplicate": found["skipped_duplicate"],
        "competitors_considered": found["competitors_considered"],
        "details": details,
    }
