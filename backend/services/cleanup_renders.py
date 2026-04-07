"""Delete old rendered MP4s from Storage and mark sessions cleaned."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from supabase import Client

from services.video_render import RENDERS_BUCKET


def cleanup_old_renders(supabase: Client, *, days: int = 30) -> Dict[str, Any]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    res = (
        supabase.table("generation_sessions")
        .select("id, client_id")
        .eq("render_status", "done")
        .lt("updated_at", cutoff)
        .limit(500)
        .execute()
    )
    rows: List[Dict[str, Any]] = [dict(r) for r in (res.data or [])]
    updated = 0
    for row in rows:
        cid = str(row.get("client_id") or "")
        sid = str(row.get("id") or "")
        if not cid or not sid:
            continue
        to_remove = [f"{cid}/{sid}.mp4", f"{cid}/bg_{sid}.png"]
        try:
            supabase.storage.from_(RENDERS_BUCKET).remove(to_remove)
        except Exception:
            pass
        now = datetime.now(timezone.utc).isoformat()
        supabase.table("generation_sessions").update(
            {
                "rendered_video_url": None,
                "render_status": "cleaned",
                "updated_at": now,
            }
        ).eq("id", sid).eq("client_id", cid).execute()
        updated += 1
    return {"sessions_cleaned": updated}
