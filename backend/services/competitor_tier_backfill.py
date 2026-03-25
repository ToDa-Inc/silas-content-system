"""Re-score competitors that have relevance but no tier once a baseline exists."""

from __future__ import annotations

from typing import Any, Dict, Optional

from supabase import Client

from services.competitor_scoring import evaluate_competitor


def _latest_valid_baseline(supabase: Client, client_id: str) -> Optional[dict]:
    res = (
        supabase.table("client_baselines")
        .select("*")
        .eq("client_id", client_id)
        .order("scraped_at", desc=True)
        .limit(5)
        .execute()
    )
    if not res.data:
        return None
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    for row in res.data:
        exp = row.get("expires_at")
        if not exp:
            return row
        try:
            exp_dt = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
            if exp_dt > now:
                return row
        except (ValueError, TypeError):
            return row
    return res.data[0]


def backfill_competitor_tiers(supabase: Client, client_id: str, client_lang: str) -> int:
    """Update tier fields for competitors missing tier but having relevance_score and avg_views."""
    baseline_row = _latest_valid_baseline(supabase, client_id)
    if not baseline_row:
        return 0
    baseline_for_eval: Dict[str, Any] = {
        "p90_views": baseline_row.get("p90_views") or 0,
        "median_views": baseline_row.get("median_views") or 0,
        "p10_views": baseline_row.get("p10_views") or 0,
    }
    res = supabase.table("competitors").select("*").eq("client_id", client_id).execute()
    updated = 0
    for comp in res.data or []:
        if comp.get("tier") is not None:
            continue
        rel = comp.get("relevance_score")
        if rel is None:
            continue
        disc: Dict[str, Any] = {
            "username": comp.get("username"),
            "profileUrl": comp.get("profile_url"),
            "followers": comp.get("followers"),
            "avgViews": int(comp.get("avg_views") or 0),
            "avgLikes": int(comp.get("avg_likes") or 0),
            "relevance": {
                "relevance_score": int(rel),
                "content_style": comp.get("content_style"),
                "language": comp.get("language"),
                "primary_topics": comp.get("topics") or [],
                "reasoning": comp.get("reasoning") or "",
            },
        }
        scored = evaluate_competitor(disc, baseline_for_eval, client_lang)
        supabase.table("competitors").update(
            {
                "performance_score": scored["performance_score"],
                "language_bonus": scored["language_bonus"],
                "composite_score": scored["composite_score"],
                "tier": scored["tier"],
                "tier_label": scored["tier_label"],
            }
        ).eq("id", comp["id"]).execute()
        updated += 1
    return updated
