"""Enqueue background jobs for format digest recomputation (after scrapes)."""

from __future__ import annotations

from supabase import Client

from core.id_generator import generate_job_id
from services.job_queue import has_active_job


def enqueue_format_digest_recompute(
    supabase: Client,
    *,
    org_id: str,
    client_id: str,
) -> bool:
    """Queue a single format_digest_recompute job if none queued/running for this client."""
    if has_active_job(supabase, client_id=client_id, job_type="format_digest_recompute"):
        return False
    supabase.table("background_jobs").insert(
        {
            "id": generate_job_id(),
            "org_id": org_id,
            "client_id": client_id,
            "job_type": "format_digest_recompute",
            "payload": {},
            "status": "queued",
        }
    ).execute()
    return True


def enqueue_auto_analyze_scraped(
    supabase: Client,
    *,
    org_id: str,
    client_id: str,
    batch_limit: int = 50,
) -> bool:
    """Queue auto-analyze for scraped reels missing reel_analyses (caption-only)."""
    if has_active_job(supabase, client_id=client_id, job_type="auto_analyze_scraped"):
        return False
    bl = max(1, min(int(batch_limit), 100))
    supabase.table("background_jobs").insert(
        {
            "id": generate_job_id(),
            "org_id": org_id,
            "client_id": client_id,
            "job_type": "auto_analyze_scraped",
            "payload": {"batch_limit": bl},
            "status": "queued",
        }
    ).execute()
    return True
