"""Auto-analyze scraped reels that have no reel_analyses row (text-only, skip_apify).

The 7-day "mature metrics" rule applies only in format_digest.py (ranking), not here — we need
analysis rows for all reels so format classification and backlog can catch up.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Set, Tuple

from core.config import Settings
from core.database import get_supabase_for_settings
from services.instagram_post_url import canonical_instagram_post_url
from services.format_digest_jobs import enqueue_auto_analyze_scraped
from services.job_queue import has_active_job
from jobs.reel_analyze_url import _execute_reel_analyze_url_core, _niche_context_for_reel_analysis

# PostgREST max-rows is often 1000 but can be lower per project; unbounded .execute() truncates.
_PAGE = 1000


def _all_reel_analysis_urls(supabase, client_id: str) -> Set[str]:
    out: Set[str] = set()
    offset = 0
    while True:
        res = (
            supabase.table("reel_analyses")
            .select("post_url")
            .eq("client_id", client_id)
            .range(offset, offset + _PAGE - 1)
            .execute()
        )
        rows = res.data or []
        for row in rows:
            u = row.get("post_url")
            if u:
                out.add(canonical_instagram_post_url(str(u)))
        if len(rows) < _PAGE:
            break
        offset += _PAGE
    return out


def _all_scraped_reel_rows(supabase, client_id: str) -> List[Dict[str, Any]]:
    rows_out: List[Dict[str, Any]] = []
    offset = 0
    while True:
        res = (
            supabase.table("scraped_reels")
            .select("id, post_url, posted_at")
            .eq("client_id", client_id)
            .range(offset, offset + _PAGE - 1)
            .execute()
        )
        batch = res.data or []
        rows_out.extend(batch)
        if len(batch) < _PAGE:
            break
        offset += _PAGE
    return rows_out


def _posted_at_sort_key(posted_raw: Any) -> Tuple[int, float]:
    """Older posts first (better for digest maturity); missing dates last."""
    if posted_raw is None or str(posted_raw).strip() == "":
        return (1, 0.0)
    try:
        ts = datetime.fromisoformat(str(posted_raw).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        ts = ts.astimezone(timezone.utc)
        return (0, -ts.timestamp())
    except (ValueError, TypeError):
        return (1, 0.0)


def run_auto_analyze_scraped(settings: Settings, job: Dict[str, Any]) -> None:
    if not settings.openrouter_api_key:
        raise RuntimeError("OPENROUTER_API_KEY required")

    supabase = get_supabase_for_settings(settings)
    job_id = job["id"]
    client_id = job.get("client_id")
    if not client_id:
        raise RuntimeError("auto_analyze_scraped job missing client_id")

    payload = job.get("payload") or {}
    batch_limit = int(payload.get("batch_limit") or 50)
    batch_limit = max(1, min(batch_limit, 100))

    now = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").update({"status": "running", "started_at": now}).eq(
        "id", job_id
    ).execute()

    analyzed_urls = _all_reel_analysis_urls(supabase, str(client_id))
    scraped_rows = _all_scraped_reel_rows(supabase, str(client_id))

    raw_candidates: List[Dict[str, Any]] = []
    for row in scraped_rows:
        pu = row.get("post_url")
        if not pu:
            continue
        key = canonical_instagram_post_url(str(pu))
        if key in analyzed_urls:
            continue
        raw_candidates.append(
            {
                "post_url": str(pu),
                "id": row.get("id"),
                "posted_at": row.get("posted_at"),
            }
        )

    raw_candidates.sort(key=lambda r: _posted_at_sort_key(r.get("posted_at")))
    candidates = [{"post_url": r["post_url"], "id": r.get("id")} for r in raw_candidates]

    niche_ctx = _niche_context_for_reel_analysis(supabase, str(client_id))
    succeeded = 0
    errors: List[str] = []
    batch = candidates[:batch_limit]
    for item in batch:
        url = item["post_url"]
        try:
            out = _execute_reel_analyze_url_core(
                settings,
                supabase,
                client_id=str(client_id),
                analysis_job_id=str(job_id),
                reel_url=url,
                analysis_source="auto_scrape",
                niche_context=niche_ctx,
                skip_apify=True,
            )
            if out.get("persist_error"):
                errors.append(f"{url}: persist_error={out.get('persist_error')!s}"[:300])
            elif out.get("analysis_id"):
                succeeded += 1
            else:
                errors.append(f"{url}: no analysis_id after analyze (unexpected)"[:300])
        except Exception as e:
            errors.append(f"{url}: {e!s}"[:300])

    remaining_after = len(candidates) - len(batch)
    org_id = job.get("org_id")

    # Mark completed first: has_active_job(auto_analyze_scraped) is true while this row is
    # running, so enqueue must run after status is completed or the next job never queues.
    done = datetime.now(timezone.utc).isoformat()
    result_body: Dict[str, Any] = {
        "candidates_found": len(candidates),
        "scraped_reels_rows_loaded": len(scraped_rows),
        "analyzed_urls_loaded": len(analyzed_urls),
        "processed": len(batch),
        "succeeded": succeeded,
        "remaining_estimate": max(0, remaining_after),
        "errors": errors[:15],
        "chained_next": False,
    }
    supabase.table("background_jobs").update(
        {
            "status": "completed",
            "completed_at": done,
            "result": result_body,
        }
    ).eq("id", job_id).execute()

    chained_next = False
    enqueue_note: str | None = None
    if remaining_after > 0 and org_id:
        try:
            chained_next = enqueue_auto_analyze_scraped(
                supabase,
                org_id=str(org_id),
                client_id=str(client_id),
                batch_limit=batch_limit,
            )
        except Exception as e:
            enqueue_note = f"enqueue_exception:{e!s}"[:400]
    elif remaining_after > 0 and not org_id:
        enqueue_note = "missing_org_id_on_job_no_chain"

    if remaining_after > 0 and not chained_next:
        if enqueue_note is None:
            if has_active_job(
                supabase, client_id=str(client_id), job_type="auto_analyze_scraped"
            ):
                enqueue_note = "blocked_has_active_auto_analyze_job"
            else:
                enqueue_note = "enqueue_returned_false_no_active_job_check_rpc"

    if enqueue_note:
        result_body["enqueue_note"] = enqueue_note

    if chained_next:
        result_body["chained_next"] = True
        supabase.table("background_jobs").update({"result": result_body}).eq("id", job_id).execute()
    elif enqueue_note:
        supabase.table("background_jobs").update({"result": result_body}).eq("id", job_id).execute()
