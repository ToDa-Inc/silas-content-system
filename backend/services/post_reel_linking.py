"""Link generated posts to the client's own published reels.

Auto-link only on a strong caption match: the client usually pastes the generated caption.
Hook-vs-first-line matching was dropped — short lines share stock phrases ("Hier ist der Grund")
and produced false matches on real data. Anything weaker is left for a manual pick.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

AUTO_LINK_MIN_SCORE = 0.8
# Captions shorter than this carry too little signal to auto-link.
MIN_CAPTION_TOKENS = 12
# A reel is only matched to posts created at most this long before it was published.
MAX_POST_TO_PUBLISH_DAYS = 30

_HASHTAG = re.compile(r"#\w+", re.UNICODE)
_NON_WORD = re.compile(r"[^\w\s]", re.UNICODE)


def caption_tokens(text: Optional[str]) -> set[str]:
    t = _HASHTAG.sub(" ", (text or "").lower())
    t = _NON_WORD.sub(" ", t)
    return {w for w in t.split() if len(w) > 1}


def caption_similarity(a: Optional[str], b: Optional[str]) -> float:
    """Dice coefficient on word sets (hashtags, emojis and punctuation removed)."""
    ta, tb = caption_tokens(a), caption_tokens(b)
    if len(ta) < MIN_CAPTION_TOKENS or len(tb) < MIN_CAPTION_TOKENS:
        return 0.0
    return 2 * len(ta & tb) / (len(ta) + len(tb))


def _parse_ts(v: Any) -> Optional[datetime]:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None


def best_auto_links(
    sessions: List[Dict[str, Any]],
    reels: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Pure matcher: one reel per post and one post per reel, highest score first, ≥ AUTO_LINK_MIN_SCORE."""
    candidates: List[tuple[float, str, str]] = []
    for s in sessions:
        created = _parse_ts(s.get("created_at"))
        if not created:
            continue
        for r in reels:
            posted = _parse_ts(r.get("posted_at"))
            if not posted or posted < created or posted - created > timedelta(days=MAX_POST_TO_PUBLISH_DAYS):
                continue
            score = caption_similarity(s.get("caption_body"), r.get("caption"))
            if score >= AUTO_LINK_MIN_SCORE:
                candidates.append((score, str(s["id"]), str(r["id"])))
    candidates.sort(reverse=True)
    used_s: set[str] = set()
    used_r: set[str] = set()
    out: List[Dict[str, Any]] = []
    for score, sid, rid in candidates:
        if sid in used_s or rid in used_r:
            continue
        used_s.add(sid)
        used_r.add(rid)
        out.append({"session_id": sid, "reel_id": rid, "score": round(score, 3)})
    return out


OWN_REEL_COLUMNS = "id,post_url,posted_at,caption,views,likes,comments,last_updated_at,thumbnail_url"


def own_reels_query(supabase, client_id: str, handle: Optional[str], columns: str = OWN_REEL_COLUMNS):
    q = (
        supabase.table("scraped_reels")
        .select(columns)
        .eq("client_id", client_id)
        .eq("source", "client_baseline")
        .is_("competitor_id", "null")
    )
    h = (handle or "").strip().lstrip("@").lower()
    if h:
        q = q.ilike("account_username", h)
    return q


def auto_link_published_reels(supabase, client_id: str) -> Dict[str, Any]:
    """Link unlinked posts to unlinked own reels on a strong caption match. Never unlinks."""
    crow = supabase.table("clients").select("instagram_handle").eq("id", client_id).limit(1).execute()
    handle = (crow.data or [{}])[0].get("instagram_handle")
    since = (datetime.now(timezone.utc) - timedelta(days=120)).isoformat()

    sessions = (
        supabase.table("generation_sessions")
        .select("id,created_at,caption_body")
        .eq("client_id", client_id)
        .is_("published_reel_id", "null")
        .in_("status", ["content_ready", "approved"])
        .gte("created_at", since)
        .execute()
    ).data or []
    if not sessions:
        return {"linked": 0, "sessions_checked": 0}

    linked_ids = {
        str(r["published_reel_id"])
        for r in (
            supabase.table("generation_sessions")
            .select("published_reel_id")
            .eq("client_id", client_id)
            .not_.is_("published_reel_id", "null")
            .execute()
        ).data
        or []
    }
    reels = [
        r
        for r in (own_reels_query(supabase, client_id, handle).gte("posted_at", since).execute().data or [])
        if str(r["id"]) not in linked_ids
    ]
    links = best_auto_links(sessions, reels)
    now = datetime.now(timezone.utc).isoformat()
    for link in links:
        supabase.table("generation_sessions").update(
            {
                "published_reel_id": link["reel_id"],
                "published_link_source": "auto",
                "published_match_score": link["score"],
                "published_linked_at": now,
            }
        ).eq("id", link["session_id"]).is_("published_reel_id", "null").execute()
    if links:
        logger.info("auto-linked %d posts to reels for client=%s", len(links), client_id)
    return {"linked": len(links), "sessions_checked": len(sessions), "reels_checked": len(reels)}
