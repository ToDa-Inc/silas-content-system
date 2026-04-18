"""Milestone-based reel performance tracking.

For each competitor's scraped reels, record views/comments at the 24h, 48h, and
72h marks after ``posted_at`` (Instagram publish time).  A milestone is filled by
the **first** ``reel_snapshot`` whose ``scraped_at >= posted_at + milestone``.

Competitor-level averages per milestone are stored on the ``competitors`` row so
the replicate-suggestions endpoint can compare fresh reels cheaply.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from supabase import Client

logger = logging.getLogger(__name__)

MILESTONES_HOURS = (24, 48, 72)
# A snapshot must fall within [milestone, milestone + tolerance] to count.
# Daily refresh cadence means the gap between consecutive snapshots is ~24h,
# so tolerance must be >= 24h or we miss milestones by clock-timing luck.
# 26h = one full daily cycle + 2h cron-drift buffer.
MILESTONE_TOLERANCE_HOURS = 26
MIN_REELS_FOR_AVERAGE = 3


def _parse_dt(raw: Any) -> Optional[datetime]:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Per-reel milestone fill
# ---------------------------------------------------------------------------

def _milestone_cols(h: int) -> Tuple[str, str, str]:
    """Return (views_col, comments_col, timestamp_col) for a milestone."""
    return f"views_at_{h}h", f"comments_at_{h}h", f"milestone_{h}h_at"


def fill_reel_milestones(
    supabase: Client,
    *,
    competitor_id: str,
    client_id: str,
) -> Dict[str, Any]:
    """Fill milestone columns on scraped_reels for one competitor.

    For each reel missing one or more milestones, find the first snapshot at or
    after ``posted_at + Xh`` and write its views/comments as the milestone value.
    Milestones are immutable once set.
    """
    milestone_select = ", ".join(
        f"{vc}, {tc}"
        for h in MILESTONES_HOURS
        for vc, _, tc in [_milestone_cols(h)]
    )
    reel_res = (
        supabase.table("scraped_reels")
        .select(f"id, posted_at, {milestone_select}")
        .eq("client_id", client_id)
        .eq("competitor_id", competitor_id)
        .not_.is_("posted_at", "null")
        .execute()
    )
    reels: List[dict] = reel_res.data or []
    if not reels:
        return {"reels_checked": 0, "milestones_filled": 0}

    needs_fill: List[dict] = []
    for r in reels:
        posted = _parse_dt(r.get("posted_at"))
        if posted is None:
            continue
        missing = []
        for h in MILESTONES_HOURS:
            _, _, tc = _milestone_cols(h)
            if r.get(tc) is None:
                missing.append(h)
        if missing:
            needs_fill.append({"reel": r, "posted": posted, "missing": missing})

    if not needs_fill:
        return {"reels_checked": len(reels), "milestones_filled": 0}

    reel_ids = [str(nf["reel"]["id"]) for nf in needs_fill]
    snap_res = (
        supabase.table("reel_snapshots")
        .select("reel_id, views, comments, scraped_at")
        .in_("reel_id", reel_ids)
        .order("scraped_at", desc=False)
        .execute()
    )
    snaps_by_reel: Dict[str, List[dict]] = {}
    for s in snap_res.data or []:
        snaps_by_reel.setdefault(str(s["reel_id"]), []).append(s)

    total_filled = 0
    for nf in needs_fill:
        rid = str(nf["reel"]["id"])
        posted: datetime = nf["posted"]
        reel_snaps = snaps_by_reel.get(rid, [])
        if not reel_snaps:
            continue

        patch: Dict[str, Any] = {}
        for h in nf["missing"]:
            lower = posted + timedelta(hours=h)
            upper = posted + timedelta(hours=h + MILESTONE_TOLERANCE_HOURS)
            for snap in reel_snaps:
                scraped = _parse_dt(snap.get("scraped_at"))
                if scraped is None:
                    continue
                if scraped >= lower and scraped <= upper:
                    vc, cc, tc = _milestone_cols(h)
                    patch[vc] = int(snap.get("views") or 0)
                    patch[cc] = int(snap.get("comments") or 0)
                    patch[tc] = snap["scraped_at"]
                    total_filled += 1
                    break

        if patch:
            try:
                supabase.table("scraped_reels").update(patch).eq("id", rid).execute()
            except Exception:
                logger.warning("Could not write milestones for reel %s", rid, exc_info=True)

    return {"reels_checked": len(reels), "milestones_filled": total_filled}


# ---------------------------------------------------------------------------
# Competitor-level milestone averages
# ---------------------------------------------------------------------------

def compute_competitor_milestone_averages(
    supabase: Client,
    *,
    competitor_id: str,
    client_id: str,
) -> Dict[str, Any]:
    """Average per-milestone views/comments across all reels and store on competitors."""
    cols = []
    for h in MILESTONES_HOURS:
        vc, cc, _ = _milestone_cols(h)
        cols.extend([vc, cc])
    reel_res = (
        supabase.table("scraped_reels")
        .select(f"id, {', '.join(cols)}")
        .eq("client_id", client_id)
        .eq("competitor_id", competitor_id)
        .execute()
    )
    rows: List[dict] = reel_res.data or []

    patch: Dict[str, Any] = {}
    result: Dict[str, Any] = {}
    for h in MILESTONES_HOURS:
        vc, cc, _ = _milestone_cols(h)
        views_vals = [int(r[vc]) for r in rows if r.get(vc) is not None]
        comments_vals = [int(r[cc]) for r in rows if r.get(cc) is not None]
        n = len(views_vals)
        avg_v = round(sum(views_vals) / n, 2) if n >= MIN_REELS_FOR_AVERAGE else None
        avg_c = round(sum(comments_vals) / n, 2) if n >= MIN_REELS_FOR_AVERAGE else None
        patch[f"avg_views_at_{h}h"] = avg_v
        patch[f"avg_comments_at_{h}h"] = avg_c
        patch[f"sampled_at_{h}h"] = n
        result[f"sampled_{h}h"] = n
        if avg_v is not None:
            result[f"avg_views_at_{h}h"] = avg_v

    try:
        supabase.table("competitors").update(patch).eq("id", competitor_id).eq("client_id", client_id).execute()
    except Exception:
        logger.warning(
            "Could not update milestone averages for competitor %s (migration pending?)",
            competitor_id,
            exc_info=True,
        )

    return result


# ---------------------------------------------------------------------------
# Combined: fill milestones + recompute averages
# ---------------------------------------------------------------------------

def update_milestones_for_competitor(
    supabase: Client,
    *,
    competitor_id: str,
    client_id: str,
) -> Dict[str, Any]:
    """Fill any new milestones and recompute competitor averages."""
    fill = fill_reel_milestones(supabase, competitor_id=competitor_id, client_id=client_id)
    avgs = compute_competitor_milestone_averages(supabase, competitor_id=competitor_id, client_id=client_id)
    return {**fill, **avgs}


def update_milestones_for_client(
    supabase: Client, *, client_id: str
) -> Dict[str, Any]:
    """Fill milestones and recompute averages for every competitor of a client."""
    comp_res = (
        supabase.table("competitors")
        .select("id")
        .eq("client_id", client_id)
        .execute()
    )
    updated = 0
    for c in comp_res.data or []:
        update_milestones_for_competitor(
            supabase, competitor_id=str(c["id"]), client_id=client_id
        )
        updated += 1
    return {"competitors_updated": updated}
