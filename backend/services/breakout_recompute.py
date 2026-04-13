"""Recompute breakout flags from existing scraped_reels only (no Apify)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from supabase import Client

from services.first_day_stats import update_milestones_for_competitor

DEFAULT_OUTLIER_RATIO_THRESHOLD = 5.0


def _ratio_decimal(metric: int, avg: int) -> Optional[Decimal]:
    if avg <= 0:
        return None
    return round(Decimal(metric) / Decimal(avg), 2)


def _ratio_str(r: Optional[Decimal]) -> Optional[str]:
    return str(r) if r is not None else None


def _metrics_for_row(r: dict) -> Tuple[int, int, int]:
    return (
        int(r.get("views") or 0),
        int(r.get("likes") or 0),
        int(r.get("comments") or 0),
    )


def _outlier_fields_for_reel(
    views: int,
    likes: int,
    comments: int,
    avg_v: int,
    avg_l: int,
    avg_c: int,
    threshold: float,
) -> Dict[str, Any]:
    rv = _ratio_decimal(views, avg_v)
    rl = _ratio_decimal(likes, avg_l)
    rc = _ratio_decimal(comments, avg_c)
    is_out_v = rv is not None and float(rv) >= threshold
    is_out_l = rl is not None and float(rl) >= threshold
    is_out_c = rc is not None and float(rc) >= threshold
    is_any = is_out_v or is_out_l or is_out_c
    ratio_vals = [float(x) for x in (rv, rl, rc) if x is not None]
    max_r = max(ratio_vals) if ratio_vals else None
    legacy = f"{max_r:.2f}" if max_r is not None else None
    return {
        "account_avg_views": avg_v,
        "account_avg_likes": avg_l,
        "account_avg_comments": avg_c,
        "outlier_views_ratio": _ratio_str(rv),
        "outlier_likes_ratio": _ratio_str(rl),
        "outlier_comments_ratio": _ratio_str(rc),
        "is_outlier_views": is_out_v,
        "is_outlier_likes": is_out_l,
        "is_outlier_comments": is_out_c,
        "outlier_ratio": legacy,
        "is_outlier": is_any,
    }


def recompute_breakouts_for_client(supabase: Client, *, client_id: str) -> Dict[str, Any]:
    """
    For each competitor with scraped_reels, recompute avg views/likes/comments from those rows,
    update competitors.*avg_*, then refresh outlier columns on each reel.
    """
    clres = (
        supabase.table("clients")
        .select("outlier_ratio_threshold")
        .eq("id", client_id)
        .limit(1)
        .execute()
    )
    if not clres.data:
        return {"error": "client_not_found", "competitors_updated": 0, "reels_updated": 0}
    threshold = float(
        clres.data[0].get("outlier_ratio_threshold") or DEFAULT_OUTLIER_RATIO_THRESHOLD
    )

    rres = (
        supabase.table("scraped_reels")
        .select("id, competitor_id, views, likes, comments")
        .eq("client_id", client_id)
        .not_.is_("competitor_id", "null")
        .execute()
    )
    rows: List[dict] = rres.data or []
    by_comp: Dict[str, List[dict]] = {}
    for r in rows:
        cid = r.get("competitor_id")
        if not cid:
            continue
        by_comp.setdefault(str(cid), []).append(r)

    competitors_updated = 0
    reels_updated = 0

    for comp_id, comp_rows in by_comp.items():
        if not comp_rows:
            continue
        n = len(comp_rows)
        total_v = sum(_metrics_for_row(x)[0] for x in comp_rows)
        total_l = sum(_metrics_for_row(x)[1] for x in comp_rows)
        total_c = sum(_metrics_for_row(x)[2] for x in comp_rows)
        avg_v = max(0, round(total_v / n))
        avg_l = max(0, round(total_l / n))
        avg_c = max(0, round(total_c / n))

        supabase.table("competitors").update(
            {
                "avg_views": avg_v,
                "avg_likes": avg_l,
                "avg_comments": avg_c,
            }
        ).eq("id", comp_id).eq("client_id", client_id).execute()

        try:
            update_milestones_for_competitor(
                supabase, competitor_id=comp_id, client_id=client_id
            )
        except Exception:
            pass

        competitors_updated += 1

        for r in comp_rows:
            rid = r.get("id")
            if not rid:
                continue
            v, l, c = _metrics_for_row(r)
            patch = _outlier_fields_for_reel(v, l, c, avg_v, avg_l, avg_c, threshold)
            supabase.table("scraped_reels").update(patch).eq("id", rid).eq(
                "client_id", client_id
            ).execute()
            reels_updated += 1

    return {
        "competitors_updated": competitors_updated,
        "reels_updated": reels_updated,
        "threshold": threshold,
    }


def recompute_breakouts_all_clients(supabase: Client) -> Dict[str, Any]:
    clients = supabase.table("clients").select("id").eq("is_active", True).execute()
    total_comp = 0
    total_reels = 0
    clients_checked = 0
    for c in clients.data or []:
        clients_checked += 1
        out = recompute_breakouts_for_client(supabase, client_id=str(c["id"]))
        total_comp += int(out.get("competitors_updated") or 0)
        total_reels += int(out.get("reels_updated") or 0)
    return {
        "clients_checked": clients_checked,
        "competitors_updated": total_comp,
        "reels_updated": total_reels,
    }
