"""Shared engagement rates and niche benchmarks for scraped_reels (API + generation)."""

from __future__ import annotations

from typing import Any, Dict, List

from supabase import Client


def _int_metric_val(val: Any) -> int:
    try:
        return int(val or 0)
    except (TypeError, ValueError):
        return 0


def enrich_engagement_metrics(reel: dict) -> dict:
    """Mutates and returns ``reel`` with engagement_rate, save_rate, share_rate (0–1 floats)."""
    v = _int_metric_val(reel.get("views"))
    l = _int_metric_val(reel.get("likes"))
    c = _int_metric_val(reel.get("comments"))
    s = _int_metric_val(reel.get("saves"))
    sh = _int_metric_val(reel.get("shares"))
    total_eng = l + c + s + sh
    reel["engagement_rate"] = round(total_eng / v, 4) if v > 0 else None
    reel["save_rate"] = round(s / v, 4) if v > 0 else None
    reel["share_rate"] = round(sh / v, 4) if v > 0 else None
    return reel


def compute_niche_benchmarks(supabase: Client, client_id: str) -> Dict[str, Any]:
    """Aggregates over competitor reels only (competitor_id IS NOT NULL)."""
    try:
        res = (
            supabase.table("scraped_reels")
            .select("views, likes, comments, saves, shares, video_duration")
            .eq("client_id", client_id)
            .not_.is_("competitor_id", "null")
            .execute()
        )
    except Exception:
        return {
            "reel_count": 0,
            "niche_avg_views": None,
            "niche_avg_likes": None,
            "niche_avg_engagement_rate": None,
            "niche_avg_duration_seconds": None,
        }

    rows: List[dict] = [dict(x) for x in (res.data or [])]
    n = len(rows)
    if n == 0:
        return {
            "reel_count": 0,
            "niche_avg_views": None,
            "niche_avg_likes": None,
            "niche_avg_engagement_rate": None,
            "niche_avg_duration_seconds": None,
        }

    sum_v = sum(_int_metric_val(r.get("views")) for r in rows)
    sum_l = sum(_int_metric_val(r.get("likes")) for r in rows)
    ers: List[float] = []
    durs: List[int] = []
    for r in rows:
        rr = enrich_engagement_metrics(dict(r))
        er = rr.get("engagement_rate")
        if er is not None:
            ers.append(float(er))
        vd = r.get("video_duration")
        if vd is not None:
            try:
                di = int(vd)
                if di > 0:
                    durs.append(di)
            except (TypeError, ValueError):
                pass

    return {
        "reel_count": n,
        "niche_avg_views": round(sum_v / n),
        "niche_avg_likes": round(sum_l / n),
        "niche_avg_engagement_rate": round(sum(ers) / len(ers), 4) if ers else None,
        "niche_avg_duration_seconds": round(sum(durs) / len(durs)) if durs else None,
    }
