from datetime import datetime, timezone
from typing import Annotated, Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query
from supabase import Client

from core.config import Settings, get_settings
from core.database import get_supabase
from core.id_generator import generate_job_id
from core.deps import require_org_access, resolve_client_id
from jobs.baseline_scrape import run_baseline_scrape
from jobs.client_auto_profile import run_client_auto_profile
from jobs.competitor_discovery import run_competitor_discovery
from jobs.profile_scrape import run_profile_scrape
from models.competitor import CompetitorAddBody, CompetitorOut, CompetitorPreviewBody, DiscoverBody
from models.reel import ScrapedReelOut
from services.competitor_manual import add_manual_competitor, preview_manual_competitor
from services.job_queue import fail_abandoned_queued_jobs, has_active_job
from services.scrape_cycle import find_stale_competitors

router = APIRouter(prefix="/api/v1", tags=["intelligence"])


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


@router.post("/clients/{slug}/competitors/preview")
def preview_competitor(
    slug: str,
    body: CompetitorPreviewBody,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Scrape profile + ~20 reels, AI similarity — informational only (docs/COMPETITOR-FLOW-SIMPLE.md)."""
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
    """Save competitor after human confirmation; re-scrapes on save. No relevance threshold."""
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
    fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="baseline_scrape")
    if has_active_job(supabase, client_id=client_id, job_type="baseline_scrape"):
        raise HTTPException(
            status_code=409,
            detail="A baseline_scrape job is already queued or running for this client",
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
    return res.data or []


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
