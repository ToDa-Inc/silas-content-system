"""Learning loop: diagnose each of the client's own reels against her own recent norm.

Buckets (defaults, editable per client via ``clients.learning_thresholds``):
- scale:       views ≥ 2× median, or the reel is flagged as an outlier
- adjust_cta:  views ≥ median but comments-per-view < 0.5× median  (watched, didn't act)
- adjust_hook: views < 0.7× median but likes+comments per view ≥ median  (liked, didn't stop the scroll)
- retire:      views < 0.7× median and engagement per view < median
- keep:        everything else

The median is taken over the client's last 30 reels that are ≥ 3 days old. Nothing is
bucketed until at least 10 such reels exist. A human override always wins over the rule.
Only views / likes / comments are used: Instagram retention is not available via Apify.
"""

from __future__ import annotations

import logging
import statistics
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from core.id_generator import generate_job_id
from services.post_reel_linking import own_reels_query

logger = logging.getLogger(__name__)

DEFAULT_THRESHOLDS: Dict[str, float] = {
    "min_age_days": 3,
    "median_window": 30,
    "min_reels": 10,
    "scale_views_x": 2.0,
    "low_views_x": 0.7,
    "cta_comment_rate_x": 0.5,
}
BUCKETS = ("scale", "adjust_hook", "adjust_cta", "retire", "keep")
BUCKET_LABEL = {
    "scale": "Scale it",
    "adjust_hook": "Adjust hook",
    "adjust_cta": "Adjust CTA",
    "retire": "Retire",
    "keep": "Keep",
}
# Reels older than this are not (re)bucketed — the daily refresh stops updating them anyway.
DIAGNOSE_LOOKBACK_DAYS = 120
# Auto AI analysis per run (only reels that newly became scale / retire).
MAX_AUTO_ANALYSES_PER_RUN = 5


# Counts that are used as whole numbers (and must be ≥ 1 to make sense).
_INT_THRESHOLDS = ("min_age_days", "median_window", "min_reels")


def resolve_thresholds(raw: Any) -> Dict[str, float]:
    out = dict(DEFAULT_THRESHOLDS)
    if isinstance(raw, dict):
        for k, v in raw.items():
            if k in out and isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
                out[k] = float(v)
    for k in _INT_THRESHOLDS:
        out[k] = float(max(1, round(out[k])))
    # The median needs at least as many reels in the window as the minimum asks for.
    out["median_window"] = max(out["median_window"], out["min_reels"])
    return out


def _parse_ts(v: Any) -> Optional[datetime]:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None


def _rate(num: Any, views: Any) -> float:
    v = float(views or 0)
    return float(num or 0) / v if v > 0 else 0.0


def _x(value: float, base: float) -> str:
    return f"{value / base:.1f}×" if base > 0 else "n/a"


def compute_norm(reels: List[Dict[str, Any]], th: Dict[str, float], now: datetime) -> Optional[Dict[str, Any]]:
    """Median views / comment rate / engagement rate over the last N mature reels, or None."""
    min_age = timedelta(days=th["min_age_days"])
    mature = [
        r
        for r in reels
        if (p := _parse_ts(r.get("posted_at"))) and now - p >= min_age and (r.get("views") or 0) > 0
    ]
    mature.sort(key=lambda r: str(r.get("posted_at")), reverse=True)
    window = mature[: int(th["median_window"])]
    if len(window) < int(th["min_reels"]):
        return None
    return {
        "median_views": statistics.median(float(r["views"]) for r in window),
        "median_comment_rate": statistics.median(_rate(r.get("comments"), r["views"]) for r in window),
        "median_engagement_rate": statistics.median(
            _rate((r.get("likes") or 0) + (r.get("comments") or 0), r["views"]) for r in window
        ),
        "reels_in_median": len(window),
    }


def diagnose_reel(reel: Dict[str, Any], norm: Dict[str, Any], th: Dict[str, float]) -> Dict[str, Any]:
    """Pure rule: bucket + the numbers behind it + a one-line reason."""
    views = float(reel.get("views") or 0)
    mv = norm["median_views"]
    cr = _rate(reel.get("comments"), views)
    er = _rate((reel.get("likes") or 0) + (reel.get("comments") or 0), views)
    mcr, mer = norm["median_comment_rate"], norm["median_engagement_rate"]
    vx = views / mv if mv > 0 else 0.0
    outlier = bool(reel.get("is_outlier"))

    if vx >= th["scale_views_x"] or outlier:
        bucket = "scale"
        reason = f"Views {_x(views, mv)} median" + (" · outlier" if outlier and vx < th["scale_views_x"] else "")
    elif vx >= 1.0 and mcr > 0 and cr < th["cta_comment_rate_x"] * mcr:
        bucket = "adjust_cta"
        reason = f"Views {_x(views, mv)} median · comments/view {_x(cr, mcr)}"
    elif vx < th["low_views_x"] and er >= mer:
        bucket = "adjust_hook"
        reason = f"Views {_x(views, mv)} median · engagement/view {_x(er, mer)}"
    elif vx < th["low_views_x"]:
        bucket = "retire"
        reason = f"Views {_x(views, mv)} median · engagement/view {_x(er, mer)}"
    else:
        bucket = "keep"
        reason = f"Views {_x(views, mv)} median"
    return {
        "bucket": bucket,
        "reason": f"{reason} → {BUCKET_LABEL[bucket]}",
        "metrics": {
            "views": int(views),
            "median_views": round(mv, 1),
            "views_x": round(vx, 2),
            "comment_rate_x": round(cr / mcr, 2) if mcr > 0 else None,
            "engagement_rate_x": round(er / mer, 2) if mer > 0 else None,
            "is_outlier": outlier,
            "reels_in_median": norm["reels_in_median"],
        },
    }


def _learning_analyses_last_24h(supabase, client_id: str, now: datetime) -> int:
    rows = (
        supabase.table("background_jobs")
        .select("payload")
        .eq("client_id", client_id)
        .eq("job_type", "reel_analyze_url")
        .gte("created_at", (now - timedelta(hours=24)).isoformat())
        .execute()
    ).data or []
    return sum(1 for r in rows if (r.get("payload") or {}).get("source") == "learning")


def analysis_job_pending(supabase, client_id: str, post_url: str) -> bool:
    """True when a reel_analyze_url job for this URL is already queued or running."""
    rows = (
        supabase.table("background_jobs")
        .select("payload")
        .eq("client_id", client_id)
        .eq("job_type", "reel_analyze_url")
        .in_("status", ["queued", "running"])
        .execute()
    ).data or []
    return any((r.get("payload") or {}).get("url") == post_url for r in rows)


def enqueue_reel_analysis(supabase, *, org_id: str, client_id: str, post_url: str) -> None:
    supabase.table("background_jobs").insert(
        {
            "id": generate_job_id(),
            "org_id": org_id,
            "client_id": client_id,
            "job_type": "reel_analyze_url",
            "payload": {"url": post_url, "skip_apify": False, "source": "learning"},
            "status": "queued",
            "priority": 30,
        }
    ).execute()


def recompute_reel_diagnostics(supabase, client_id: str, *, now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    crow = (
        supabase.table("clients")
        .select("org_id,instagram_handle,learning_thresholds,learning_enabled")
        .eq("id", client_id)
        .limit(1)
        .execute()
    ).data
    if not crow:
        return {"status": "client_not_found"}
    client = crow[0]
    th = resolve_thresholds(client.get("learning_thresholds"))

    reels = (
        own_reels_query(
            supabase,
            client_id,
            client.get("instagram_handle"),
            columns="id,post_url,posted_at,views,likes,comments,is_outlier",
        )
        .gte("posted_at", (now - timedelta(days=DIAGNOSE_LOOKBACK_DAYS)).isoformat())
        .order("posted_at", desc=True)
        .limit(1000)
        .execute()
    ).data or []
    norm = compute_norm(reels, th, now)
    if norm is None:
        return {"status": "not_enough_data", "reels": len(reels), "min_reels": int(th["min_reels"])}

    existing = {
        str(r["reel_id"]): r
        for r in (
            supabase.table("reel_diagnostics")
            .select("reel_id,override_bucket,excluded,analyzed_bucket")
            .eq("client_id", client_id)
            .execute()
        ).data
        or []
    }
    min_age = timedelta(days=th["min_age_days"])
    rows: List[Dict[str, Any]] = []
    to_analyze: List[Dict[str, Any]] = []
    for r in reels:
        p = _parse_ts(r.get("posted_at"))
        if not p or now - p < min_age or not (r.get("views") or 0):
            continue
        d = diagnose_reel(r, norm, th)
        rows.append(
            {
                "reel_id": r["id"],
                "client_id": client_id,
                "rule_bucket": d["bucket"],
                "metrics": d["metrics"],
                "reason": d["reason"],
                "computed_at": now.isoformat(),
            }
        )
        prev = existing.get(str(r["id"])) or {}
        effective = prev.get("override_bucket") or d["bucket"]
        if (
            effective in ("scale", "retire")
            and not prev.get("excluded")
            and prev.get("analyzed_bucket") != effective
        ):
            to_analyze.append({"reel": r, "bucket": effective})

    for i in range(0, len(rows), 200):
        # Upsert only rule fields: override_bucket / excluded / analyzed_bucket are kept.
        supabase.table("reel_diagnostics").upsert(rows[i : i + 200], on_conflict="reel_id").execute()

    analyzed = 0
    # Paid video analyses: only when the client uses learning, and at most
    # MAX_AUTO_ANALYSES_PER_RUN per client per day across every trigger.
    budget = 0
    if to_analyze and client.get("org_id") and client.get("learning_enabled") is not False:
        budget = max(0, MAX_AUTO_ANALYSES_PER_RUN - _learning_analyses_last_24h(supabase, client_id, now))
    if to_analyze and budget > 0:
        done_urls = {
            str(a["post_url"])
            for a in (
                supabase.table("reel_analyses")
                .select("post_url")
                .eq("client_id", client_id)
                .in_("post_url", [t["reel"]["post_url"] for t in to_analyze])
                .execute()
            ).data
            or []
        }
        for t in to_analyze:
            url = t["reel"]["post_url"]
            if url not in done_urls:
                if analyzed >= budget:
                    continue
                enqueue_reel_analysis(supabase, org_id=str(client["org_id"]), client_id=client_id, post_url=url)
                analyzed += 1
            supabase.table("reel_diagnostics").update({"analyzed_bucket": t["bucket"]}).eq(
                "reel_id", t["reel"]["id"]
            ).execute()

    counts: Dict[str, int] = {b: 0 for b in BUCKETS}
    for row in rows:
        counts[row["rule_bucket"]] += 1
    return {"status": "ok", "diagnosed": len(rows), "counts": counts, "norm": norm, "analyses_queued": analyzed}
