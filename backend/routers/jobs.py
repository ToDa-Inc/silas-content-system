from typing import Annotated, Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from supabase import Client

from core.database import get_supabase
from core.deps import require_org_access
from models.job import JobOut

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobOut)
def get_job(
    job_id: str,
    org_id: Annotated[str, Depends(require_org_access)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    res = (
        supabase.table("background_jobs")
        .select("id, job_type, status, result, error_message, created_at, started_at, completed_at")
        .eq("id", job_id)
        .eq("org_id", org_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Job not found")
    return res.data[0]
