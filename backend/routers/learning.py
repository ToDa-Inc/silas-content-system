"""Learning loop API: post ↔ reel linking (diagnostics, votes and settings build on this router)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from supabase import Client

from core.database import get_supabase
from core.deps import resolve_client_id
from services.post_reel_linking import own_reels_query

router = APIRouter(prefix="/api/v1", tags=["learning"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client_handle(supabase: Client, client_id: str) -> Optional[str]:
    r = supabase.table("clients").select("instagram_handle").eq("id", client_id).limit(1).execute()
    return (r.data or [{}])[0].get("instagram_handle")


def _session(supabase: Client, client_id: str, session_id: str) -> Dict[str, Any]:
    r = (
        supabase.table("generation_sessions")
        .select("id,client_id,created_at,published_reel_id,published_link_source,published_match_score,published_linked_at")
        .eq("id", session_id)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not r.data:
        raise HTTPException(status_code=404, detail="Session not found")
    return r.data[0]


@router.get("/clients/{slug}/learning/own-reels")
def list_own_reels_for_linking(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    posted_after: Optional[str] = Query(None, description="ISO timestamp; only reels posted after it"),
    limit: int = Query(30, ge=1, le=100),
) -> List[Dict[str, Any]]:
    """Client's own reels, newest first, with the post each one is already linked to."""
    _ = slug
    q = own_reels_query(supabase, client_id, _client_handle(supabase, client_id))
    if posted_after:
        q = q.gte("posted_at", posted_after)
    reels = q.order("posted_at", desc=True).limit(limit).execute().data or []
    ids = [r["id"] for r in reels]
    linked: Dict[str, str] = {}
    if ids:
        for row in (
            supabase.table("generation_sessions")
            .select("id,published_reel_id")
            .eq("client_id", client_id)
            .in_("published_reel_id", ids)
            .execute()
        ).data or []:
            linked[str(row["published_reel_id"])] = str(row["id"])
    return [
        {
            "id": r["id"],
            "post_url": r["post_url"],
            "posted_at": r.get("posted_at"),
            "caption": (r.get("caption") or "")[:160],
            "views": r.get("views"),
            "thumbnail_url": r.get("thumbnail_url"),
            "linked_session_id": linked.get(str(r["id"])),
        }
        for r in reels
    ]


class PublishedReelBody(BaseModel):
    reel_id: Optional[str] = None


@router.put("/clients/{slug}/generate/sessions/{session_id}/published-reel")
def set_published_reel(
    slug: str,
    session_id: str,
    body: PublishedReelBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    """Manually link a post to one of the client's own reels, or unlink with ``reel_id: null``."""
    _ = slug
    _session(supabase, client_id, session_id)
    if body.reel_id is None:
        patch: Dict[str, Any] = {
            "published_reel_id": None,
            "published_link_source": None,
            "published_match_score": None,
            "published_linked_at": None,
        }
    else:
        reel = (
            own_reels_query(supabase, client_id, _client_handle(supabase, client_id))
            .eq("id", body.reel_id)
            .limit(1)
            .execute()
        ).data
        if not reel:
            raise HTTPException(status_code=400, detail="Reel is not one of this client's own reels")
        other = (
            supabase.table("generation_sessions")
            .select("id")
            .eq("published_reel_id", body.reel_id)
            .neq("id", session_id)
            .limit(1)
            .execute()
        ).data
        if other:
            raise HTTPException(status_code=409, detail=f"Reel is already linked to post {other[0]['id']}")
        patch = {
            "published_reel_id": body.reel_id,
            "published_link_source": "manual",
            "published_match_score": None,
            "published_linked_at": _now(),
        }
    supabase.table("generation_sessions").update(patch).eq("id", session_id).eq("client_id", client_id).execute()
    return published_reel_summary(slug, session_id, client_id, supabase)


@router.get("/clients/{slug}/generate/sessions/{session_id}/published-reel")
def published_reel_summary(
    slug: str,
    session_id: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    """Linked reel with its current numbers and views-over-time snapshots (null when unlinked)."""
    _ = slug
    s = _session(supabase, client_id, session_id)
    rid = s.get("published_reel_id")
    if not rid:
        return {"linked": False, "reel": None}
    reel = (
        supabase.table("scraped_reels")
        .select("id,post_url,posted_at,views,likes,comments,saves,shares,last_updated_at,thumbnail_url")
        .eq("id", rid)
        .limit(1)
        .execute()
    ).data
    snaps = (
        supabase.table("reel_snapshots")
        .select("scraped_at,views,likes,comments")
        .eq("reel_id", rid)
        .order("scraped_at")
        .limit(200)
        .execute()
    ).data or []
    diag = (
        supabase.table("reel_diagnostics")
        .select("rule_bucket,override_bucket,excluded,reason,metrics,computed_at")
        .eq("reel_id", rid)
        .limit(1)
        .execute()
    ).data
    return {
        "linked": True,
        "link_source": s.get("published_link_source"),
        "match_score": s.get("published_match_score"),
        "linked_at": s.get("published_linked_at"),
        "reel": reel[0] if reel else None,
        "snapshots": snaps,
        "diagnostic": diag[0] if diag else None,
    }
