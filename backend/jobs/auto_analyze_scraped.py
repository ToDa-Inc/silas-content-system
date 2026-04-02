"""Auto-analyze scraped reels that have no reel_analyses row (text-only, skip_apify)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Set

from core.config import Settings
from core.database import get_supabase_for_settings
from services.instagram_post_url import canonical_instagram_post_url
from jobs.reel_analyze_url import _execute_reel_analyze_url_core, _niche_context_for_reel_analysis


def run_auto_analyze_scraped(settings: Settings, job: Dict[str, Any]) -> None:
    if not settings.openrouter_api_key:
        raise RuntimeError("OPENROUTER_API_KEY required")

    supabase = get_supabase_for_settings(settings)
    job_id = job["id"]
    client_id = job.get("client_id")
    if not client_id:
        raise RuntimeError("auto_analyze_scraped job missing client_id")

    payload = job.get("payload") or {}
    batch_limit = int(payload.get("batch_limit") or 10)
    batch_limit = max(1, min(batch_limit, 20))

    now = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update({"status": "running", "started_at": now}).eq(
        "id", job_id
    ).execute()

    # Existing analyses (by canonical post URL)
    ares = (
        supabase.table("reel_analyses")
        .select("post_url")
        .eq("client_id", client_id)
        .execute()
    )
    analyzed_urls: Set[str] = set()
    for row in ares.data or []:
        u = row.get("post_url")
        if u:
            analyzed_urls.add(canonical_instagram_post_url(str(u)))

    sres = (
        supabase.table("scraped_reels")
        .select("id, post_url, posted_at")
        .eq("client_id", client_id)
        .execute()
    )

    mature_cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    candidates: List[Dict[str, Any]] = []
    for row in sres.data or []:
        pu = row.get("post_url")
        if not pu:
            continue
        key = canonical_instagram_post_url(str(pu))
        if key in analyzed_urls:
            continue
        posted_raw = row.get("posted_at")
        # No posted_at (or empty): auto-analyze now — cannot apply the 7-day maturity rule.
        if posted_raw is None or str(posted_raw).strip() == "":
            candidates.append({"post_url": str(pu), "id": row.get("id")})
            continue
        try:
            ts = datetime.fromisoformat(str(posted_raw).replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            ts = ts.astimezone(timezone.utc)
        except (ValueError, TypeError):
            # Unparseable date: treat like missing — analyze now.
            candidates.append({"post_url": str(pu), "id": row.get("id")})
            continue
        # With a valid date: only auto-analyze if posted 7+ days ago (performance usable for digests).
        if ts > mature_cutoff:
            continue
        candidates.append({"post_url": str(pu), "id": row.get("id")})

    niche_ctx = _niche_context_for_reel_analysis(supabase, str(client_id))
    succeeded = 0
    errors: List[str] = []
    for item in candidates[:batch_limit]:
        url = item["post_url"]
        try:
            _execute_reel_analyze_url_core(
                settings,
                supabase,
                client_id=str(client_id),
                analysis_job_id=str(job_id),
                reel_url=url,
                analysis_source="auto_scrape",
                niche_context=niche_ctx,
                skip_apify=True,
            )
            succeeded += 1
        except Exception as e:
            errors.append(f"{url}: {e!s}"[:300])

    done = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update(
        {
            "status": "completed",
            "completed_at": done,
            "result": {
                "candidates_found": len(candidates),
                "processed": min(batch_limit, len(candidates)),
                "succeeded": succeeded,
                "errors": errors[:15],
            },
        }
    ).eq("id", job_id).execute()
