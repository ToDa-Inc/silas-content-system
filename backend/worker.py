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
from core.id_generator import generate_job_id
from jobs.baseline_scrape import run_baseline_scrape
from jobs.client_auto_profile import run_client_auto_profile
from jobs.competitor_discovery import run_competitor_discovery
from jobs.daily_intelligence_tick import run_daily_intelligence_tick
from jobs.profile_scrape import run_profile_scrape
from jobs.auto_analyze_scraped import run_auto_analyze_scraped
from jobs.format_digest_recompute import run_format_digest_recompute
from jobs.milestone_scrape import run_milestone_scrape
from jobs.keyword_reel_similarity import run_keyword_reel_similarity
from jobs.niche_reel_scrape import run_niche_reel_scrape
from jobs.reel_analyze_url import run_reel_analyze_bulk, run_reel_analyze_url
from jobs.scraped_reels_refresh import run_scraped_reels_refresh


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


_CLAIM_HINT_PRINTED = False
_SCHED_HINT_PRINTED = False


def _claim_job_safe(settings: Settings) -> Optional[Dict[str, Any]]:
    """Call claim_next_job; on RPC failure print hint once and stay idle (no spam)."""
    global _CLAIM_HINT_PRINTED
    try:
        return _claim_job(settings)
    except Exception as e:
        if not _CLAIM_HINT_PRINTED:
            _CLAIM_HINT_PRINTED = True
            print(
                "claim_next_job failed — apply SQL in backend/sql/phase0_claim_next_job.sql "
                "to your Supabase database, then restart the worker.\n"
                f"Error: {e!s}"
            )
        return None


def _claim_due_schedule(settings: Settings) -> Optional[Dict[str, Any]]:
    """Fetch one due cron_schedules row (advancing next_run_at atomically)."""
    supabase = get_supabase_for_settings(settings)
    r = supabase.rpc("claim_due_schedule").execute()
    data = r.data
    if data is None:
        return None
    if isinstance(data, list):
        return data[0] if len(data) > 0 else None
    return data


def _enqueue_tick(settings: Settings, schedule: Dict[str, Any]) -> None:
    """Insert a daily_intelligence_tick job for the claimed schedule."""
    supabase = get_supabase_for_settings(settings)
    client_id = schedule.get("client_id")
    org_id = schedule.get("org_id")
    row: Dict[str, Any] = {
        "id": generate_job_id(),
        "client_id": client_id,
        "job_type": "daily_intelligence_tick",
        "payload": {"cron_name": schedule.get("cron_name")},
        "status": "queued",
        "priority": 20,  # above the fan-out sub-jobs so tick runs first
    }
    if org_id:
        row["org_id"] = org_id
    supabase.table("background_jobs").insert(row).execute()


def _claim_due_schedule_safe(settings: Settings) -> Optional[Dict[str, Any]]:
    """Same idempotent-fallback pattern as _claim_job_safe."""
    global _SCHED_HINT_PRINTED
    try:
        return _claim_due_schedule(settings)
    except Exception as e:
        if not _SCHED_HINT_PRINTED:
            _SCHED_HINT_PRINTED = True
            print(
                "claim_due_schedule failed — apply SQL in backend/sql/phase17_cron_schedules.sql "
                "to your Supabase database. Scheduler loop will stay idle until then.\n"
                f"Error: {e!s}"
            )
        return None


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
    elif jt == "format_digest_recompute":
        run_format_digest_recompute(settings, job)
    elif jt == "auto_analyze_scraped":
        run_auto_analyze_scraped(settings, job)
    elif jt == "milestone_scrape":
        run_milestone_scrape(settings, job)
    elif jt == "niche_reel_scrape":
        run_niche_reel_scrape(settings, job)
    elif jt == "keyword_reel_similarity":
        run_keyword_reel_similarity(settings, job)
    elif jt == "scraped_reels_refresh":
        run_scraped_reels_refresh(settings, job)
    elif jt == "daily_intelligence_tick":
        run_daily_intelligence_tick(settings, job)
    else:
        _fail_job(settings, job["id"], f"Unknown job_type: {jt}")


async def job_loop(settings: Settings) -> None:
    """Claim and run queued background_jobs. Unchanged behavior from pre-scheduler worker."""
    print("job_loop started — polling claim_next_job every 5s")
    idle_polls = 0
    while True:
        try:
            job = await asyncio.to_thread(_claim_job_safe, settings)
            if not job:
                idle_polls += 1
                # ~60s: confirm we are alive when the queue is empty (normal if nothing is queued).
                if idle_polls % 12 == 0:
                    print(
                        "Worker idle — no jobs with status=queued. "
                        "Queue builds when Intelligence sync enqueues scrapes, or run phase0_claim_next_job.sql "
                        "if RPC errors appeared above."
                    )
                await asyncio.sleep(5)
                continue
            idle_polls = 0
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


async def schedule_loop(settings: Settings) -> None:
    """Drain due cron_schedules rows and enqueue a daily_intelligence_tick per client.

    Runs concurrently with job_loop. A single tick job lands on the normal queue
    and is claimed by job_loop like any other job — keeps the execution path
    uniform and observable in background_jobs.

    Drains in a tight inner loop so a burst of due schedules (e.g. first run
    after deploy when many clients have next_run_at <= now()) clears in one
    outer iteration instead of one-per-minute.
    """
    print("schedule_loop started — polling claim_due_schedule every 60s")
    while True:
        try:
            drained = 0
            while drained < 50:  # hard cap per outer tick to avoid starving job_loop
                sched = await asyncio.to_thread(_claim_due_schedule_safe, settings)
                if not sched:
                    break
                try:
                    await asyncio.to_thread(_enqueue_tick, settings, sched)
                    print(
                        f"Enqueued tick for client={sched.get('client_id')} "
                        f"cron={sched.get('cron_name')} "
                        f"next_run_at={sched.get('next_run_at')}"
                    )
                    drained += 1
                except Exception:
                    # The schedule row already had next_run_at bumped by claim_due_schedule.
                    # If enqueue fails we just log — next iteration in 24h will try again.
                    print(traceback.format_exc())
            await asyncio.sleep(60)
        except Exception:
            print(traceback.format_exc())
            await asyncio.sleep(60)


async def run_loop() -> None:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required")

    print("Worker started — job_loop + schedule_loop running concurrently")
    await asyncio.gather(
        job_loop(settings),
        schedule_loop(settings),
    )


if __name__ == "__main__":
    try:
        asyncio.run(run_loop())
    except KeyboardInterrupt:
        print("\nWorker stopped (Ctrl+C).")
        raise SystemExit(0) from None
