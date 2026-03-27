"""
Background worker: polls claim_next_job() and runs job handlers.

Run (from backend/):
  python worker.py
"""

from __future__ import annotations

import asyncio
import traceback
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from core.config import Settings, get_settings
from core.database import get_supabase_for_settings
from jobs.baseline_scrape import run_baseline_scrape
from jobs.client_auto_profile import run_client_auto_profile
from jobs.competitor_discovery import run_competitor_discovery
from jobs.profile_scrape import run_profile_scrape
from jobs.reel_analyze_url import run_reel_analyze_bulk, run_reel_analyze_url


def _fail_job(settings: Settings, job_id: str, message: str) -> None:
    supabase = get_supabase_for_settings(settings)
    supabase.table("background_jobs").update(
        {
            "status": "failed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "error_message": message[:8000],
        }
    ).eq("id", job_id).execute()


def _claim_job(settings: Settings) -> Optional[Dict[str, Any]]:
    supabase = get_supabase_for_settings(settings)
    r = supabase.rpc("claim_next_job").execute()
    data = r.data
    if data is None:
        return None
    if isinstance(data, list):
        return data[0] if len(data) > 0 else None
    return data


def _process_job_sync(settings: Settings, job: Dict[str, Any]) -> None:
    jt = job.get("job_type")
    if jt == "competitor_discovery":
        run_competitor_discovery(settings, job)
    elif jt == "baseline_scrape":
        run_baseline_scrape(settings, job)
    elif jt == "profile_scrape":
        run_profile_scrape(settings, job)
    elif jt == "client_auto_profile":
        run_client_auto_profile(settings, job)
    elif jt == "reel_analyze_url":
        run_reel_analyze_url(settings, job)
    elif jt == "reel_analyze_bulk":
        run_reel_analyze_bulk(settings, job)
    else:
        _fail_job(settings, job["id"], f"Unknown job_type: {jt}")


async def run_loop() -> None:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required")

    print("Worker started — polling claim_next_job every 5s")
    while True:
        try:
            job = await asyncio.to_thread(_claim_job, settings)
            if not job:
                await asyncio.sleep(5)
                continue
            jid = job.get("id")
            print(f"Picked job {jid} type={job.get('job_type')}")
            try:
                await asyncio.to_thread(_process_job_sync, settings, job)
                print(f"Completed job {jid}")
            except Exception as e:
                tb = traceback.format_exc()
                print(tb)
                _fail_job(settings, jid, f"{e!s}\n{tb}")
        except Exception:
            print(traceback.format_exc())
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(run_loop())
