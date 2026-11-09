"""Learning loop API: post ↔ reel linking, reel diagnostics, learning settings, hook/angle votes."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from supabase import Client

from core.database import get_supabase
from core.deps import resolve_client_id
from services.post_reel_linking import own_reels_query
from services.reel_diagnostics import (
    BUCKETS,
    DEFAULT_THRESHOLDS,
    analysis_job_pending,
    enqueue_reel_analysis,
    recompute_reel_diagnostics,
    resolve_thresholds,
)

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


# ── Diagnostics ──────────────────────────────────────────────────────────────

@router.get("/clients/{slug}/learning/diagnostics")
def list_diagnostics(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    limit: int = Query(60, ge=1, le=100),
) -> Dict[str, Any]:
    """Own reels with their bucket (override wins), reason, linked post and short AI read."""
    _ = slug
    client = (
        supabase.table("clients")
        .select("instagram_handle,learning_enabled,learning_thresholds")
        .eq("id", client_id)
        .limit(1)
        .execute()
    ).data[0]
    # Newest own reels first (bounded), then only their diagnostics — never an id list that
    # grows with the client's whole history.
    recent = (
        own_reels_query(supabase, client_id, client.get("instagram_handle"))
        .order("posted_at", desc=True)
        .limit(limit * 2)
        .execute()
    ).data or []
    by_reel: Dict[str, Dict[str, Any]] = {}
    if recent:
        for d in (
            supabase.table("reel_diagnostics")
            .select("reel_id,rule_bucket,override_bucket,excluded,reason,metrics,computed_at")
            .eq("client_id", client_id)
            .in_("reel_id", [r["id"] for r in recent])
            .execute()
        ).data or []:
            by_reel[str(d["reel_id"])] = d
    reels = [r for r in recent if str(r["id"]) in by_reel][:limit]
    urls = [r["post_url"] for r in reels]
    analyses: Dict[str, Dict[str, Any]] = {}
    if urls:
        for a in (
            supabase.table("reel_analyses")
            .select("post_url,why_it_worked,hook_type,analyzed_at")
            .eq("client_id", client_id)
            .in_("post_url", urls)
            .order("analyzed_at", desc=True)
            .execute()
        ).data or []:
            analyses.setdefault(str(a["post_url"]), a)
    linked: Dict[str, str] = {}
    if reels:
        for row in (
            supabase.table("generation_sessions")
            .select("id,published_reel_id")
            .eq("client_id", client_id)
            .in_("published_reel_id", [r["id"] for r in reels])
            .execute()
        ).data or []:
            linked[str(row["published_reel_id"])] = str(row["id"])
    items = []
    for r in reels:
        d = by_reel[str(r["id"])]
        a = analyses.get(str(r["post_url"]))
        items.append(
            {
                "reel_id": r["id"],
                "post_url": r["post_url"],
                "posted_at": r.get("posted_at"),
                "caption": (r.get("caption") or "")[:120],
                "views": r.get("views"),
                "bucket": d.get("override_bucket") or d["rule_bucket"],
                "rule_bucket": d["rule_bucket"],
                "override_bucket": d.get("override_bucket"),
                "excluded": bool(d.get("excluded")),
                "reason": d.get("reason") or "",
                "computed_at": d.get("computed_at"),
                "linked_session_id": linked.get(str(r["id"])),
                "analysis": {"why_it_worked": a.get("why_it_worked"), "hook_type": a.get("hook_type")} if a else None,
            }
        )
    return {
        "learning_enabled": bool(client.get("learning_enabled", True)),
        "thresholds": resolve_thresholds(client.get("learning_thresholds")),
        "default_thresholds": DEFAULT_THRESHOLDS,
        "items": items,
    }


class DiagnosticPatch(BaseModel):
    override_bucket: Optional[str] = None
    clear_override: bool = False
    excluded: Optional[bool] = None


@router.patch("/clients/{slug}/learning/diagnostics/{reel_id}")
def patch_diagnostic(
    slug: str,
    reel_id: str,
    body: DiagnosticPatch,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    """Human judgement: override the bucket (always wins) and/or exclude the reel from learning."""
    _ = slug
    patch: Dict[str, Any] = {}
    if body.clear_override:
        patch["override_bucket"] = None
        patch["overridden_at"] = None
    elif body.override_bucket is not None:
        if body.override_bucket not in BUCKETS:
            raise HTTPException(status_code=400, detail=f"override_bucket must be one of {', '.join(BUCKETS)}")
        patch["override_bucket"] = body.override_bucket
        patch["overridden_at"] = _now()
    if body.excluded is not None:
        patch["excluded"] = body.excluded
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = (
        supabase.table("reel_diagnostics")
        .update(patch)
        .eq("reel_id", reel_id)
        .eq("client_id", client_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="No diagnostic for this reel")
    return res.data[0]


@router.post("/clients/{slug}/learning/diagnostics/recompute")
def recompute_diagnostics(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    _ = slug
    return recompute_reel_diagnostics(supabase, client_id)


@router.post("/clients/{slug}/learning/diagnostics/{reel_id}/analyze")
def analyze_reel_on_demand(
    slug: str,
    reel_id: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    """Queue the AI reel analysis (hook type, why it worked) for one own reel."""
    _ = slug
    reel = (
        own_reels_query(supabase, client_id, _client_handle(supabase, client_id))
        .eq("id", reel_id)
        .limit(1)
        .execute()
    ).data
    if not reel:
        raise HTTPException(status_code=404, detail="Reel is not one of this client's own reels")
    post_url = reel[0]["post_url"]
    if analysis_job_pending(supabase, client_id, post_url):
        return {"queued": False, "already_pending": True}
    org_id = supabase.table("clients").select("org_id").eq("id", client_id).limit(1).execute().data[0]["org_id"]
    enqueue_reel_analysis(supabase, org_id=str(org_id), client_id=client_id, post_url=post_url)
    return {"queued": True, "already_pending": False}


# ── Settings ─────────────────────────────────────────────────────────────────


class LearningSettingsBody(BaseModel):
    learning_enabled: Optional[bool] = None
    thresholds: Optional[Dict[str, float]] = None


@router.put("/clients/{slug}/learning/settings")
def put_learning_settings(
    slug: str,
    body: LearningSettingsBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    """'Learn from results' switch and threshold overrides ({} resets to defaults)."""
    _ = slug
    patch: Dict[str, Any] = {}
    if body.learning_enabled is not None:
        patch["learning_enabled"] = body.learning_enabled
    if body.thresholds is not None:
        clean = {k: float(v) for k, v in body.thresholds.items() if k in DEFAULT_THRESHOLDS and v > 0}
        patch["learning_thresholds"] = clean
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to update")
    row = supabase.table("clients").update(patch).eq("id", client_id).execute().data[0]
    return {
        "learning_enabled": bool(row.get("learning_enabled", True)),
        "thresholds": resolve_thresholds(row.get("learning_thresholds")),
    }


# ── Votes on hooks / angles ──────────────────────────────────────────────────


def vote_text_key(text: str) -> str:
    return " ".join((text or "").lower().split())


class VoteBody(BaseModel):
    session_id: Optional[str] = None
    kind: str
    text: str
    vote: int  # 1 = up, -1 = down, 0 = clear


@router.put("/clients/{slug}/learning/votes")
def put_vote(
    slug: str,
    body: VoteBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    _ = slug
    if body.kind not in ("hook", "angle"):
        raise HTTPException(status_code=400, detail="kind must be hook or angle")
    if body.vote not in (-1, 0, 1):
        raise HTTPException(status_code=400, detail="vote must be -1, 0 or 1")
    key = vote_text_key(body.text)
    if not key:
        raise HTTPException(status_code=400, detail="text is required")
    if body.vote == 0:
        supabase.table("hook_votes").delete().eq("client_id", client_id).eq("kind", body.kind).eq(
            "text_key", key
        ).execute()
        return {"kind": body.kind, "text": body.text, "vote": 0}
    supabase.table("hook_votes").upsert(
        {
            "client_id": client_id,
            "session_id": body.session_id,
            "kind": body.kind,
            "text": body.text.strip()[:2000],
            "text_key": key[:2000],
            "vote": body.vote,
            "updated_at": _now(),
        },
        on_conflict="client_id,kind,text_key",
    ).execute()
    return {"kind": body.kind, "text": body.text, "vote": body.vote}


@router.get("/clients/{slug}/learning/votes")
def list_votes(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    kind: Optional[str] = Query(None),
) -> List[Dict[str, Any]]:
    """All votes for this client (the UI matches them to hooks / angles by text)."""
    _ = slug
    q = supabase.table("hook_votes").select("kind,text,text_key,vote,updated_at").eq("client_id", client_id)
    if kind:
        q = q.eq("kind", kind)
    return q.order("updated_at", desc=True).limit(500).execute().data or []
