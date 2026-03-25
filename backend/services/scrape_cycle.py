"""Enqueue profile_scrape jobs for competitors that are due (tier + last_scraped_at)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from supabase import Client

from core.id_generator import generate_job_id
from services.job_queue import has_active_job


def _parse_ts(value: Any) -> datetime | None:
    if value is None:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _is_stale(tier: int | None, last_scraped_at: Any, now: datetime) -> bool:
    if tier is None or tier >= 4:
        return False
    max_age = timedelta(days=7) if tier in (1, 2) else timedelta(days=30)
    parsed = _parse_ts(last_scraped_at)
    if parsed is None:
        return True
    return parsed < now - max_age


def find_stale_competitors(
    supabase: Client,
    *,
    client_id: str,
) -> Dict[str, Any]:
    """Return competitor IDs that need a profile scrape (tiers 1–3, past staleness window).

    Skips competitors that already have a queued/running ``profile_scrape`` for the same
    ``competitor_id``. Used by the dashboard (inline scrape) and by
    :func:`enqueue_stale_profile_scrapes` for cron/worker.
    """
    now = datetime.now(timezone.utc)
    competitor_ids: List[str] = []
    skipped_fresh = 0
    skipped_duplicate = 0

    cres = (
        supabase.table("competitors")
        .select("id, tier, last_scraped_at")
        .eq("client_id", client_id)
        .execute()
    )
    rows: List[dict] = cres.data or []

    for row in rows:
        tid = row.get("tier")
        if not _is_stale(tid, row.get("last_scraped_at"), now):
            if tid is not None and tid < 4:
                skipped_fresh += 1
            continue
        comp_id = row["id"]
        if has_active_job(
            supabase,
            client_id=client_id,
            job_type="profile_scrape",
            payload_match={"competitor_id": comp_id},
        ):
            skipped_duplicate += 1
            continue
        competitor_ids.append(comp_id)

    return {
        "competitor_ids": competitor_ids,
        "skipped_fresh": skipped_fresh,
        "skipped_duplicate": skipped_duplicate,
        "competitors_considered": len(rows),
    }


def enqueue_stale_profile_scrapes(
    supabase: Client,
    *,
    org_id: str,
    client_id: str,
) -> Dict[str, int]:
    """Queue one profile_scrape per stale competitor (tiers 1–3)."""
    found = find_stale_competitors(supabase, client_id=client_id)
    jobs_queued = 0

    for comp_id in found["competitor_ids"]:
        supabase.table("background_jobs").insert(
            {
                "id": generate_job_id(),
                "org_id": org_id,
                "client_id": client_id,
                "job_type": "profile_scrape",
                "payload": {"competitor_id": comp_id},
                "status": "queued",
            }
        ).execute()
        jobs_queued += 1

    return {
        "jobs_queued": jobs_queued,
        "skipped_fresh": found["skipped_fresh"],
        "skipped_duplicate": found["skipped_duplicate"],
        "competitors_considered": found["competitors_considered"],
    }


def enqueue_stale_profile_scrapes_all_clients(supabase: Client) -> Dict[str, int]:
    """Run stale enqueue across all active clients."""
    clients = supabase.table("clients").select("id, org_id").eq("is_active", True).execute()
    jobs_queued = 0
    skipped_fresh = 0
    skipped_duplicate = 0
    competitors_seen = 0
    clients_checked = 0

    for c in clients.data or []:
        clients_checked += 1
        stats = enqueue_stale_profile_scrapes(
            supabase,
            org_id=c["org_id"],
            client_id=c["id"],
        )
        jobs_queued += stats["jobs_queued"]
        skipped_fresh += stats["skipped_fresh"]
        skipped_duplicate += stats["skipped_duplicate"]
        competitors_seen += stats["competitors_considered"]

    return {
        "jobs_queued": jobs_queued,
        "clients_checked": clients_checked,
        "skipped_fresh": skipped_fresh,
        "skipped_duplicate": skipped_duplicate,
        "competitors_considered": competitors_seen,
    }
