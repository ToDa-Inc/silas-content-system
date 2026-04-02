"""Background job: recompute format_digests for one client."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

from core.config import Settings
from core.database import get_supabase_for_settings
from services.format_digest import compute_format_digests


def run_format_digest_recompute(settings: Settings, job: Dict[str, Any]) -> None:
    if not settings.openrouter_api_key:
        raise RuntimeError("OPENROUTER_API_KEY required for format digest synthesis")

    supabase = get_supabase_for_settings(settings)
    job_id = job["id"]
    client_id = job.get("client_id")
    if not client_id:
        raise RuntimeError("format_digest_recompute job missing client_id")

    now = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update({"status": "running", "started_at": now}).eq(
        "id", job_id
    ).execute()

    stats = compute_format_digests(settings, supabase, str(client_id))
    done = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update(
        {
            "status": "completed",
            "completed_at": done,
            "result": stats,
        }
    ).eq("id", job_id).execute()
