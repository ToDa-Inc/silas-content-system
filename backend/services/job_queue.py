"""Guard against duplicate queued/running jobs (Apify cost)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from supabase import Client


def fail_abandoned_queued_jobs(
    supabase: Client,
    *,
    client_id: str,
    job_type: str,
) -> None:
    """Mark **all** ``queued`` rows for this client + job type as failed.

    Dashboard endpoints run work inline (insert ``running``, no worker). Rows left
    at ``queued`` are from the old queue-only API or a stopped ``worker.py`` and
    would otherwise block :func:`has_active_job` forever. Safe for
    ``competitor_discovery`` and ``baseline_scrape`` (nothing else should queue
    those for the same client).
    """
    now = datetime.now(timezone.utc).isoformat()
    msg = (
        "Abandoned queued job: not claimed by a worker. "
        "Superseded by a new inline dashboard request."
    )[:8000]
    supabase.table("background_jobs").update(
        {
            "status": "failed",
            "completed_at": now,
            "error_message": msg,
        }
    ).eq("client_id", client_id).eq("job_type", job_type).eq("status", "queued").execute()


def has_active_job(
    supabase: Client,
    *,
    client_id: str,
    job_type: str,
    payload_match: Optional[Dict[str, Any]] = None,
) -> bool:
    """True if a queued/running job exists for this client + type (+ optional payload keys)."""
    res = (
        supabase.table("background_jobs")
        .select("id, payload")
        .eq("client_id", client_id)
        .eq("job_type", job_type)
        .in_("status", ["queued", "running"])
        .execute()
    )
    rows = res.data or []
    if not payload_match:
        return len(rows) > 0
    for row in rows:
        p = row.get("payload") or {}
        if all(p.get(k) == v for k, v in payload_match.items()):
            return True
    return False
