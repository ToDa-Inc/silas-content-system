"""daily_intelligence_tick — per-client fan-out job enqueued by the scheduler.

Single source of truth for the "what runs daily" question. Enqueues (in order,
but as independent queued jobs so one failure doesn't block the others):

    1. profile_scrape (scrape_own=true)          → client's own reels
    2. profile_scrape × N competitors             → competitor reels
    3. keyword_reel_similarity (last-2-days)      → niche discovery
    4. scraped_reels_refresh                      → growth snapshots

Each sub-job is idempotent — upserts on (client_id, post_url), reel_snapshots
is append-only. A re-run of the tick within the same 24h window enqueues
duplicate jobs but has_active_job() gates 1/3/4; competitors are not gated
intentionally (several competitors in flight is fine and each fails-safe).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from core.config import Settings
from core.database import get_supabase_for_settings
from core.id_generator import generate_job_id
from services.job_queue import has_active_job

logger = logging.getLogger(__name__)


# Safety buffer on recency windows: cadence is 24h but we look back 2-4 days so
# a missed tick (worker down, Apify outage) doesn't cause permanent data loss.
_OWN_ONLY_NEWER_THAN = "4 days"
_COMPETITOR_ONLY_NEWER_THAN = "4 days"
_KEYWORD_SEARCH_WINDOW = "last-2-days"   # Sasky enum
_KEYWORD_DAYS = 3                         # client-side recency + enrichment onlyPostsNewerThan
_REFRESH_MAX_AGE_DAYS = 60
_REFRESH_BATCH_LIMIT = 500


def _enqueue(
    supabase: Any,
    *,
    org_id: Optional[str],
    client_id: str,
    job_type: str,
    payload: Dict[str, Any],
    priority: int = 0,
) -> str:
    row: Dict[str, Any] = {
        "id": generate_job_id(),
        "client_id": client_id,
        "job_type": job_type,
        "payload": payload,
        "status": "queued",
        "priority": priority,
    }
    if org_id:
        row["org_id"] = org_id
    supabase.table("background_jobs").insert(row).execute()
    return row["id"]


def run_daily_intelligence_tick(settings: Settings, job: Dict[str, Any]) -> None:
    supabase = get_supabase_for_settings(settings)
    job_id = job["id"]
    client_id = job.get("client_id")
    if not client_id:
        raise RuntimeError("daily_intelligence_tick missing client_id")
    client_id = str(client_id)
    org_id = job.get("org_id")

    now_iso = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update(
        {"status": "running", "started_at": now_iso}
    ).eq("id", job_id).execute()

    progress: Dict[str, Any] = {
        "pipeline": "daily_intelligence_tick",
        "phase": "enqueueing",
        "enqueued": {},
        "skipped": {},
    }

    # ── Step 1: client's own handle scrape ──────────────────────────────────
    # Gated by has_active_job to avoid duplicate enqueues if the previous tick
    # is still in flight (e.g. scheduler backed up after downtime).
    if has_active_job(
        supabase, client_id=client_id, job_type="profile_scrape",
        payload_match={"scrape_own": True},
    ):
        progress["skipped"]["own_scrape"] = "active_job_exists"
    else:
        try:
            jid = _enqueue(
                supabase,
                org_id=org_id,
                client_id=client_id,
                job_type="profile_scrape",
                payload={
                    "scrape_own": True,
                    "only_newer_than": _OWN_ONLY_NEWER_THAN,
                },
                priority=10,  # run before competitors
            )
            progress["enqueued"]["own_scrape"] = jid
        except Exception as e:
            progress["skipped"]["own_scrape"] = f"enqueue_error: {type(e).__name__}: {e!s}"[:400]

    # ── Step 2: competitor scrapes ──────────────────────────────────────────
    # Not gated per-competitor — sending N fresh jobs is cheaper than over-
    # engineering idempotency; the reel-scraper actor is pay-per-result so an
    # accidental dup run on a profile with no new posts costs ~$0.
    comp_ids: List[str] = []
    try:
        cres = (
            supabase.table("competitors")
            .select("id")
            .eq("client_id", client_id)
            .execute()
        )
        comp_ids = [str(r["id"]) for r in (cres.data or []) if r.get("id")]
    except Exception as e:
        progress["skipped"]["competitors_query"] = f"{type(e).__name__}: {e!s}"[:400]

    enqueued_comps: List[str] = []
    for cid in comp_ids:
        try:
            jid = _enqueue(
                supabase,
                org_id=org_id,
                client_id=client_id,
                job_type="profile_scrape",
                payload={
                    "competitor_id": cid,
                    "only_newer_than": _COMPETITOR_ONLY_NEWER_THAN,
                },
                priority=5,
            )
            enqueued_comps.append(jid)
        except Exception as e:
            logger.warning("tick: competitor enqueue failed for %s: %s", cid, e)
    progress["enqueued"]["competitor_scrapes"] = enqueued_comps

    # ── Step 3: keyword similarity (niche discovery) ────────────────────────
    if has_active_job(supabase, client_id=client_id, job_type="keyword_reel_similarity"):
        progress["skipped"]["keyword_similarity"] = "active_job_exists"
    else:
        try:
            jid = _enqueue(
                supabase,
                org_id=org_id,
                client_id=client_id,
                job_type="keyword_reel_similarity",
                payload={
                    "search_window": _KEYWORD_SEARCH_WINDOW,
                    "days": _KEYWORD_DAYS,
                },
                priority=3,
            )
            progress["enqueued"]["keyword_similarity"] = jid
        except Exception as e:
            progress["skipped"]["keyword_similarity"] = f"{type(e).__name__}: {e!s}"[:400]

    # ── Step 4: growth-snapshot refresh for all reels <60d old ──────────────
    if has_active_job(supabase, client_id=client_id, job_type="scraped_reels_refresh"):
        progress["skipped"]["refresh"] = "active_job_exists"
    else:
        try:
            jid = _enqueue(
                supabase,
                org_id=org_id,
                client_id=client_id,
                job_type="scraped_reels_refresh",
                payload={
                    "client_id": client_id,
                    "max_age_days": _REFRESH_MAX_AGE_DAYS,
                    "batch_limit": _REFRESH_BATCH_LIMIT,
                },
                priority=1,  # lowest — runs after fresh scrapes land
            )
            progress["enqueued"]["refresh"] = jid
        except Exception as e:
            progress["skipped"]["refresh"] = f"{type(e).__name__}: {e!s}"[:400]

    progress["phase"] = "completed"
    progress["competitors_found"] = len(comp_ids)
    supabase.table("background_jobs").update(
        {
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "result": progress,
        }
    ).eq("id", job_id).execute()
