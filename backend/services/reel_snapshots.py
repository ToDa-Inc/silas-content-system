"""Append-only metric snapshots after profile/baseline sync — see docs/INTELLIGENCE-GUIDE.md."""

from __future__ import annotations

from typing import Any, Dict, List

from supabase import Client


def insert_snapshots_for_scrape_job(supabase: Client, *, client_id: str, scrape_job_id: str) -> int:
    """Insert one snapshot row per scraped_reels row tied to this scrape job."""
    res = (
        supabase.table("scraped_reels")
        .select("id, views, likes, comments")
        .eq("client_id", client_id)
        .eq("scrape_job_id", scrape_job_id)
        .execute()
    )
    rows: List[Dict[str, Any]] = res.data or []
    if not rows:
        return 0
    batch = [
        {
            "reel_id": r["id"],
            "views": r.get("views"),
            "likes": r.get("likes"),
            "comments": r.get("comments"),
        }
        for r in rows
    ]
    try:
        supabase.table("reel_snapshots").insert(batch).execute()
    except Exception:
        # Table missing or RLS — non-fatal for sync
        return 0
    return len(batch)
