"""When was this client's data last refreshed successfully?

"Last refreshed" used to read only the manual baseline row, so the daily jobs never moved it.
This reads completed ``background_jobs`` instead. Failed jobs never count, and neither does a
baseline that found no recent reels or a reels refresh that enriched nothing.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from supabase import Client

# Competitor profile_scrape rows (one per tracked creator per day) share a job type with the
# own-handle scrape, so the own one is picked out in Python over a bounded recent window.
_PROFILE_SCAN_LIMIT = 200
_RESULT_SCAN_LIMIT = 10


def _parse(raw: Any) -> Optional[datetime]:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _completed(supabase: Client, client_id: str, job_type: str, columns: str, limit: int) -> List[Dict[str, Any]]:
    res = (
        supabase.table("background_jobs")
        .select(columns)
        .eq("client_id", client_id)
        .eq("job_type", job_type)
        .eq("status", "completed")
        .order("completed_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


def latest_successful_sync_at(supabase: Client, client_id: str) -> Optional[str]:
    """ISO ``completed_at`` of the newest good refresh for this client, or None."""
    candidates: List[Any] = []

    for job in _completed(supabase, client_id, "baseline_scrape", "completed_at, result", _RESULT_SCAN_LIMIT):
        if not (job.get("result") or {}).get("skipped"):
            candidates.append(job.get("completed_at"))
            break

    for job in _completed(supabase, client_id, "scraped_reels_refresh", "completed_at, result", _RESULT_SCAN_LIMIT):
        if int((job.get("result") or {}).get("enriched") or 0) > 0:
            candidates.append(job.get("completed_at"))
            break

    for job in _completed(supabase, client_id, "profile_scrape", "completed_at, payload", _PROFILE_SCAN_LIMIT):
        if (job.get("payload") or {}).get("scrape_own"):
            candidates.append(job.get("completed_at"))
            break

    parsed = [(dt, raw) for raw in candidates if (dt := _parse(raw)) is not None]
    return str(max(parsed, key=lambda p: p[0])[1]) if parsed else None
