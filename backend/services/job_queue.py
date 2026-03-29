"""Guard against duplicate queued/running jobs (Apify cost)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from supabase import Client


def _parse_job_ts(raw: Any) -> Optional[datetime]:
    if raw is None:
        return None
    try:
        s = str(raw).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def fail_abandoned_queued_jobs(
    supabase: Client,
    *,
    client_id: str,
    job_type: str,
) -> None:
    """Mark **all** ``queued`` rows for this client + job type as failed.

    Used before enqueueing a fresh batch so stale ``queued`` rows do not block
    :func:`has_active_job`. Bulk competitor sync enqueues ``profile_scrape`` for
    the worker; abandoning old queued rows avoids duplicates when the user
    clicks sync again.
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


def fail_stale_running_jobs(
    supabase: Client,
    *,
    client_id: str,
    job_type: str,
    max_age_minutes: int = 90,
) -> None:
    """Mark ``running`` jobs older than ``max_age_minutes`` as failed.

    Prevents :func:`has_active_job` from blocking forever after a crashed API thread
    or killed worker left rows stuck in ``running``.
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=max_age_minutes)
    res = (
        supabase.table("background_jobs")
        .select("id, created_at, started_at")
        .eq("client_id", client_id)
        .eq("job_type", job_type)
        .eq("status", "running")
        .execute()
    )
    stale_ids: List[str] = []
    for row in res.data or []:
        jid = row.get("id")
        if not jid:
            continue
        ts = _parse_job_ts(row.get("started_at")) or _parse_job_ts(row.get("created_at"))
        if ts is None or ts < cutoff:
            stale_ids.append(str(jid))
    if not stale_ids:
        return
    now_iso = now.isoformat()
    msg = (
        f"Stale running job: no heartbeat for {max_age_minutes}+ minutes "
        "(process crash or worker killed). Cleared so a new sync can run."
    )[:8000]
    supabase.table("background_jobs").update(
        {
            "status": "failed",
            "completed_at": now_iso,
            "error_message": msg,
        }
    ).in_("id", stale_ids).execute()


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
