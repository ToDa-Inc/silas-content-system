"""Manual competitor preview + add (paste handle) — docs/COMPETITOR-FLOW-SIMPLE.md."""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional

from core.config import Settings
from core.database import get_supabase_for_settings
from core.id_generator import generate_competitor_id


def _instagram_url_is_post_or_reel_only(t: str) -> bool:
    """True when the link points at a post/reel/story, not a profile."""
    if "instagram.com" not in t.lower():
        return False
    return bool(
        re.search(
            r"instagram\.com/(reel|reels|p|tv|stories)(/|$)",
            t,
            re.I,
        )
    )


def parse_instagram_username(raw: str) -> Optional[str]:
    """Accept @handle, profile URL, or plain username."""
    t = (raw or "").strip()
    if not t:
        return None
    if t.startswith("@"):
        u = t[1:].split("/")[0].split("?")[0].strip()
        return u or None
    if "instagram.com" in t.lower():
        if _instagram_url_is_post_or_reel_only(t):
            return None
        m = re.search(r"instagram\.com/([^/?#]+)", t, re.I)
        if m:
            seg = m.group(1).strip().rstrip("/")
            if seg.lower() in ("reel", "reels", "p", "stories", "tv"):
                return None
            return seg or None
        return None
    if re.match(r"^[A-Za-z0-9._]+$", t):
        return t
    return None


def _client_cfg_from_row(client: dict) -> dict:
    return {
        "name": client["name"],
        "instagram": (client.get("instagram_handle") or "").replace("@", ""),
        "language": client.get("language") or "de",
        "niches": client.get("niche_config") or [],
        "icp": client.get("icp") or {},
    }


def _find_competitor_for_client(supabase: Any, client_id: str, canon: str) -> Optional[dict]:
    """Case-insensitive match on username (legacy rows may differ in casing)."""
    res = (
        supabase.table("competitors")
        .select("id, username, relevance_score, avg_views")
        .eq("client_id", client_id)
        .execute()
    )
    for r in res.data or []:
        if (r.get("username") or "").lower() == canon:
            return r
    return None


def _manual_canon_and_client(
    settings: Settings,
    client_id: str,
    raw_input: str,
) -> tuple[str, dict, Any]:
    """Parse handle, load client, return (lowercase username, client row, supabase)."""
    username = parse_instagram_username(raw_input)
    if not username:
        if _instagram_url_is_post_or_reel_only(raw_input):
            raise ValueError(
                "That looks like a reel or post link. Paste the profile URL "
                "(instagram.com/username) or @handle."
            )
        raise ValueError("Could not parse an Instagram username from input")

    canon = username.strip().lower()
    supabase = get_supabase_for_settings(settings)
    crow = supabase.table("clients").select("*").eq("id", client_id).limit(1).execute()
    if not crow.data:
        raise RuntimeError("Client not found")
    client = crow.data[0]
    cfg = _client_cfg_from_row(client)
    excl = cfg["instagram"].lower()
    if excl and canon == excl:
        raise ValueError("That is your creator's own Instagram handle — add a different account.")

    return canon, client, supabase


def preview_manual_competitor(
    settings: Settings,
    *,
    client_id: str,
    raw_input: str,
) -> Dict[str, Any]:
    """Lightweight preview: parsed handle + duplicate check only (no Apify / LLM)."""
    canon, _, supabase = _manual_canon_and_client(settings, client_id, raw_input)

    existing = _find_competitor_for_client(supabase, client_id, canon)
    if existing:
        return {
            "already_tracked": True,
            "username": existing.get("username"),
            "added_by": None,
            "relevance_score": existing.get("relevance_score"),
            "avg_views": existing.get("avg_views"),
            "message": "This account is already in your competitor list.",
        }

    return {
        "already_tracked": False,
        "username": canon,
        "profile_url": f"https://www.instagram.com/{canon}/",
        "followers": None,
        "avg_views": None,
        "avg_likes": None,
        "avg_comments": None,
        "relevance_score": None,
        "reasoning": None,
        "composite_score": None,
        "tier_label": None,
        "message": "Add to tracking saves this account. We fetch followers and avg views on save when Apify is configured; run Discover or sync reels for full scoring.",
    }


def _enrich_manual_row_from_instagram(
    settings: Settings,
    canon_username: str,
    client: dict,
    row: Dict[str, Any],
) -> None:
    """Fill followers, avg_views, avg_likes via Apify — same pipeline as competitor discovery."""
    token = (settings.apify_api_token or "").strip()
    if not token:
        return
    cfg = _client_cfg_from_row(client)
    excl = (cfg.get("instagram") or "").lower().strip("@")
    try:
        from jobs.competitor_discovery import _scrape_account_posts
        from services.instagram_account_lookup import fetch_instagram_user_by_username

        account = fetch_instagram_user_by_username(
            token,
            canon_username,
            exclude_username=excl,
            enforce_follower_bounds=False,
        )
        if not account:
            return
        un = (account.get("username") or canon_username).strip()
        row["profile_url"] = (account.get("profileUrl") or "").strip() or row["profile_url"]
        row["followers"] = int(account.get("followers") or 0)

        posts = _scrape_account_posts(token, un, 25, account.get("_latestPosts"))
        if len(posts) < 1:
            return
        total_views = sum(int(p.get("views") or 0) for p in posts)
        total_likes = sum(int(p.get("likes") or 0) for p in posts)
        total_comments = sum(int(p.get("comments") or 0) for p in posts)
        n = len(posts)
        row["avg_views"] = round(total_views / n)
        row["avg_likes"] = round(total_likes / n)
        row["avg_comments"] = round(total_comments / n)
    except Exception:
        logging.getLogger(__name__).warning(
            "Manual competitor metrics enrichment failed for @%s",
            canon_username,
            exc_info=True,
        )


def add_manual_competitor(
    settings: Settings,
    *,
    client_id: str,
    raw_input: str,
    added_by: Optional[str],
) -> Dict[str, Any]:
    """Insert a competitors row; best-effort Apify fetch for followers and avg views (no LLM)."""
    canon, client, supabase = _manual_canon_and_client(settings, client_id, raw_input)

    existing = _find_competitor_for_client(supabase, client_id, canon)
    if existing:
        return {
            "already_tracked": True,
            "username": existing.get("username"),
            "added_by": None,
            "relevance_score": existing.get("relevance_score"),
            "avg_views": existing.get("avg_views"),
            "message": "This account is already in your competitor list.",
        }

    row: Dict[str, Any] = {
        "id": generate_competitor_id(),
        "client_id": client_id,
        "username": canon,
        "profile_url": f"https://www.instagram.com/{canon}/",
        "followers": None,
        "avg_views": None,
        "avg_likes": None,
        "avg_comments": None,
        "language": None,
        "content_style": None,
        "topics": [],
        "reasoning": None,
        "relevance_score": None,
        "performance_score": None,
        "language_bonus": 0,
        "composite_score": None,
        "tier": None,
        "tier_label": None,
        "discovery_job_id": None,
    }
    # Persist added_by only after running backend/sql/phase1c_competitors_added_by.sql on Supabase.
    ab = (added_by or "").strip() or None

    _enrich_manual_row_from_instagram(settings, canon, client, row)

    supabase.table("competitors").insert(row).execute()

    return {
        "saved": True,
        "competitor_id": row["id"],
        "username": canon,
        "added_by": ab,
        "relevance_score": row.get("relevance_score"),
        "composite_score": row.get("composite_score"),
        "avg_views": row.get("avg_views"),
        "followers": row.get("followers"),
    }
