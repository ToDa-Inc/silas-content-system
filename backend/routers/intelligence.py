from datetime import datetime, timezone
from typing import Annotated, Any, Dict
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from supabase import Client

from core.database import get_supabase
from core.deps import resolve_org_id
from models.competitor import CompetitorOut, DiscoverBody

router = APIRouter(prefix="/api/v1", tags=["intelligence"])


def _client_id_for_slug(supabase: Client, org_id: str, slug: str) -> str:
    res = (
        supabase.table("clients")
        .select("id")
        .eq("org_id", org_id)
        .eq("slug", slug)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Client not found")
    return res.data[0]["id"]


@router.get("/clients/{slug}/competitors", response_model=list[CompetitorOut])
def list_competitors(
    slug: str,
    org_id: Annotated[str, Depends(resolve_org_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> list[dict]:
    cid = _client_id_for_slug(supabase, org_id, slug)
    res = (
        supabase.table("competitors")
        .select("*")
        .eq("client_id", cid)
        .order("composite_score", desc=True)
        .execute()
    )
    return res.data or []


@router.post("/clients/{slug}/competitors/discover")
def discover_competitors(
    slug: str,
    body: DiscoverBody,
    org_id: Annotated[str, Depends(resolve_org_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    cid = _client_id_for_slug(supabase, org_id, slug)
    payload = {
        "keyword": body.keyword,
        "limit": body.limit,
        "threshold": body.threshold,
        "posts_per_account": body.posts_per_account,
    }
    row = {
        "id": str(uuid4()),
        "org_id": org_id,
        "client_id": cid,
        "job_type": "competitor_discovery",
        "payload": {k: v for k, v in payload.items() if v is not None},
        "status": "queued",
    }
    res = supabase.table("background_jobs").insert(row).execute()
    if not res.data:
        raise HTTPException(status_code=400, detail="Failed to queue job")
    return {"job_id": res.data[0]["id"]}


@router.get("/clients/{slug}/baseline")
def get_baseline(
    slug: str,
    org_id: Annotated[str, Depends(resolve_org_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    cid = _client_id_for_slug(supabase, org_id, slug)
    res = (
        supabase.table("client_baselines")
        .select("*")
        .eq("client_id", cid)
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
    org_id: Annotated[str, Depends(resolve_org_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    cid = _client_id_for_slug(supabase, org_id, slug)
    row = {
        "id": str(uuid4()),
        "org_id": org_id,
        "client_id": cid,
        "job_type": "baseline_scrape",
        "payload": {},
        "status": "queued",
    }
    res = supabase.table("background_jobs").insert(row).execute()
    if not res.data:
        raise HTTPException(status_code=400, detail="Failed to queue job")
    return {"job_id": res.data[0]["id"]}
