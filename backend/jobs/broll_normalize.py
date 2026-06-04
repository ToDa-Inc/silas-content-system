"""Background job: transcode one broll_clips row to a render master."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

from core.config import Settings
from core.database import get_supabase_for_settings
from services.broll_normalize import normalize_broll_clip_row


def run_broll_normalize(settings: Settings, job: Dict[str, Any]) -> None:
    supabase = get_supabase_for_settings(settings)
    job_id = str(job.get("id") or "").strip()
    payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
    clip_id = str(payload.get("clip_id") or "").strip()
    client_id = str(job.get("client_id") or payload.get("client_id") or "").strip()
    if not clip_id or not client_id:
        raise ValueError("broll_normalize job missing clip_id or client_id")
    playback_url, duration_sec = normalize_broll_clip_row(
        settings, supabase, client_id=client_id, clip_id=clip_id
    )
    if job_id:
        now = datetime.now(timezone.utc).isoformat()
        supabase.table("background_jobs").update(
            {
                "status": "completed",
                "completed_at": now,
                "result": {
                    "clip_id": clip_id,
                    "master_url": playback_url,
                    "duration_sec": duration_sec,
                },
            }
        ).eq("id", job_id).execute()
