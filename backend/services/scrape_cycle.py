"""Enqueue profile_scrape jobs for competitors that are due (tier + last_scraped_at)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

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


def enqueue_sync_all_jobs_for_client(
    supabase: Client,
    *,
    org_id: str,
    client_id: str,
) -> Dict[str, int]:
    """Queue baseline_scrape (own reels) + profile_scrape for every competitor (cron/worker)."""
    baseline_queued = 0
    baseline_skipped = 0
    profile_queued = 0
    profile_skipped = 0

    if has_active_job(supabase, client_id=client_id, job_type="baseline_scrape"):
        baseline_skipped = 1
    else:
        supabase.table("background_jobs").insert(
            {
                "id": generate_job_id(),
                "org_id": org_id,
                "client_id": client_id,
                "job_type": "baseline_scrape",
                "payload": {},
                "status": "queued",
            }
        ).execute()
        baseline_queued = 1

    cres = supabase.table("competitors").select("id").eq("client_id", client_id).execute()
    for row in cres.data or []:
        comp_id = str(row["id"])
        if has_active_job(
            supabase,
            client_id=client_id,
            job_type="profile_scrape",
            payload_match={"competitor_id": comp_id},
        ):
            profile_skipped += 1
            continue
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
        profile_queued += 1

    return {
        "baseline_queued": baseline_queued,
        "baseline_skipped": baseline_skipped,
        "profile_queued": profile_queued,
        "profile_skipped": profile_skipped,
        "competitors_considered": len(cres.data or []),
    }


def enqueue_sync_all_jobs_all_clients(supabase: Client) -> Dict[str, Any]:
    """For each active client, enqueue own-reel baseline + all competitor profile scrapes."""
    clients = supabase.table("clients").select("id, org_id").eq("is_active", True).execute()
    total_baseline_queued = 0
    total_baseline_skipped = 0
    total_profile_queued = 0
    total_profile_skipped = 0
    clients_checked = 0

    for c in clients.data or []:
        clients_checked += 1
        stats = enqueue_sync_all_jobs_for_client(
            supabase,
            org_id=c["org_id"],
            client_id=c["id"],
        )
        total_baseline_queued += stats["baseline_queued"]
        total_baseline_skipped += stats["baseline_skipped"]
        total_profile_queued += stats["profile_queued"]
        total_profile_skipped += stats["profile_skipped"]

    return {
        "clients_checked": clients_checked,
        "baseline_jobs_queued": total_baseline_queued,
        "baseline_jobs_skipped": total_baseline_skipped,
        "profile_jobs_queued": total_profile_queued,
        "profile_jobs_skipped": total_profile_skipped,
    }


def enqueue_keyword_reel_similarity_for_client(
    supabase: Client,
    *,
    org_id: str,
    client_id: str,
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Queue keyword_reel_similarity if none is already queued/running for this client."""
    if has_active_job(supabase, client_id=client_id, job_type="keyword_reel_similarity"):
        return {"queued": 0, "skipped": 1, "job_id": None}

    job_id = generate_job_id()
    supabase.table("background_jobs").insert(
        {
            "id": job_id,
            "org_id": org_id,
            "client_id": client_id,
            "job_type": "keyword_reel_similarity",
            "payload": payload or {},
            "status": "queued",
        }
    ).execute()
    return {"queued": 1, "skipped": 0, "job_id": job_id}


def enqueue_keyword_reel_similarity_all_clients(supabase: Client) -> Dict[str, Any]:
    """Queue keyword_reel_similarity for every active client (weekly cron)."""
    clients = supabase.table("clients").select("id, org_id").eq("is_active", True).execute()
    total_queued = 0
    total_skipped = 0
    clients_checked = 0

    for c in clients.data or []:
        clients_checked += 1
        stats = enqueue_keyword_reel_similarity_for_client(
            supabase,
            org_id=c["org_id"],
            client_id=c["id"],
        )
        total_queued += stats["queued"]
        total_skipped += stats["skipped"]

    return {
        "clients_checked": clients_checked,
        "jobs_queued": total_queued,
        "jobs_skipped": total_skipped,
    }


# ---------------------------------------------------------------------------
# Milestone scrapes — enqueue per-reel jobs for reels crossing 24h/48h/72h
# ---------------------------------------------------------------------------

_MILESTONE_HOURS = (24, 48, 72)
_MILESTONE_MAX_AGE_HOURS = 96  # ignore reels older than this


def enqueue_milestone_scrapes_for_client(
    supabase: Client, *, org_id: str, client_id: str
) -> Dict[str, Any]:
    """Enqueue milestone_scrape jobs for competitor reels that just crossed a milestone."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=_MILESTONE_MAX_AGE_HOURS)
    since_iso = since.isoformat()

    reel_res = (
        supabase.table("scraped_reels")
        .select(
            "id, post_url, posted_at, competitor_id, "
            "milestone_24h_at, milestone_48h_at, milestone_72h_at"
        )
        .eq("client_id", client_id)
        .not_.is_("competitor_id", "null")
        .not_.is_("posted_at", "null")
        .gte("posted_at", since_iso)
        .execute()
    )
    reels: List[dict] = reel_res.data or []
    if not reels:
        return {"reels_checked": 0, "jobs_queued": 0, "jobs_skipped": 0}

    queued = 0
    skipped = 0
    for r in reels:
        posted = _parse_ts(r.get("posted_at"))
        if posted is None:
            continue
        reel_url = (r.get("post_url") or "").strip()
        if not reel_url:
            continue
        competitor_id = r.get("competitor_id")
        if not competitor_id:
            continue

        for h in _MILESTONE_HOURS:
            ts_col = f"milestone_{h}h_at"
            if r.get(ts_col) is not None:
                continue
            if now < posted + timedelta(hours=h):
                continue

            if has_active_job(
                supabase,
                job_type="milestone_scrape",
                client_id=client_id,
                payload_match={"reel_id": r["id"], "milestone_hours": h},
            ):
                skipped += 1
                continue

            supabase.table("background_jobs").insert({
                "id": generate_job_id(),
                "org_id": org_id,
                "client_id": client_id,
                "job_type": "milestone_scrape",
                "payload": {
                    "reel_id": r["id"],
                    "reel_url": reel_url,
                    "milestone_hours": h,
                    "competitor_id": competitor_id,
                    "posted_at": r["posted_at"],
                },
                "status": "queued",
            }).execute()
            queued += 1

    return {"reels_checked": len(reels), "jobs_queued": queued, "jobs_skipped": skipped}


def enqueue_milestone_scrapes_all_clients(supabase: Client) -> Dict[str, Any]:
    """Enqueue milestone scrapes for all active clients."""
    clients = supabase.table("clients").select("id, org_id").eq("is_active", True).execute()
    total_reels = 0
    total_queued = 0
    total_skipped = 0
    clients_checked = 0
    for c in clients.data or []:
        clients_checked += 1
        stats = enqueue_milestone_scrapes_for_client(
            supabase, org_id=c["org_id"], client_id=c["id"]
        )
        total_reels += stats["reels_checked"]
        total_queued += stats["jobs_queued"]
        total_skipped += stats["jobs_skipped"]
    return {
        "clients_checked": clients_checked,
        "reels_checked": total_reels,
        "milestone_jobs_queued": total_queued,
        "milestone_jobs_skipped": total_skipped,
    }
