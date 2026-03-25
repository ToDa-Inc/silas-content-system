"""Manual competitor preview + add (paste handle) — docs/COMPETITOR-FLOW-SIMPLE.md."""

from __future__ import annotations

import re
from typing import Any, Dict, Optional

from core.config import Settings
from core.database import get_supabase_for_settings
from core.id_generator import generate_competitor_id
from jobs.competitor_discovery import (
    _build_niche_profile,
    _build_relevance_prompt,
    _latest_valid_baseline,
    _scrape_account_posts,
)
from services.competitor_scoring import evaluate_competitor
from services.instagram_account_lookup import fetch_instagram_user_by_username
from services.openrouter import analyze_relevance


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


def preview_manual_competitor(
    settings: Settings,
    *,
    client_id: str,
    raw_input: str,
) -> Dict[str, Any]:
    if not settings.apify_api_token or not settings.openrouter_api_key:
        raise RuntimeError("APIFY_API_TOKEN and OPENROUTER_API_KEY required")

    username = parse_instagram_username(raw_input)
    if not username:
        if _instagram_url_is_post_or_reel_only(raw_input):
            raise ValueError(
                "That looks like a reel or post link. Paste the profile URL "
                "(instagram.com/username) or @handle."
            )
        raise ValueError("Could not parse an Instagram username from input")

    supabase = get_supabase_for_settings(settings)
    crow = supabase.table("clients").select("*").eq("id", client_id).limit(1).execute()
    if not crow.data:
        raise RuntimeError("Client not found")
    client = crow.data[0]
    cfg = _client_cfg_from_row(client)
    excl = cfg["instagram"].lower()

    account = fetch_instagram_user_by_username(settings.apify_api_token, username, exclude_username=excl)
    if not account:
        raise ValueError(f"Instagram account @{username} not found or not searchable")

    canon = (account.get("username") or username).strip()
    existing = (
        supabase.table("competitors")
        .select("id, username, added_by, relevance_score, avg_views")
        .eq("client_id", client_id)
        .eq("username", canon)
        .limit(1)
        .execute()
    )
    if existing.data:
        row = existing.data[0]
        return {
            "already_tracked": True,
            "username": row.get("username"),
            "added_by": row.get("added_by"),
            "relevance_score": row.get("relevance_score"),
            "avg_views": row.get("avg_views"),
            "message": "This account is already in your competitor list.",
        }

    account["_client_lang"] = cfg["language"]
    posts = _scrape_account_posts(settings.apify_api_token, account["username"], 20, account.get("_latestPosts"))
    if len(posts) < 1:
        raise ValueError("Not enough public posts to preview this account")

    total_views = sum(p["views"] for p in posts)
    avg_views = round(total_views / len(posts))
    avg_likes = round(sum(p["likes"] for p in posts) / len(posts))

    niche_profile = _build_niche_profile(cfg)
    prompt = _build_relevance_prompt(niche_profile, account, posts[:8])
    analysis = analyze_relevance(settings.openrouter_api_key, prompt, settings.openrouter_model)
    rel_score = int(analysis.get("relevance_score") or 0)

    disc: Dict[str, Any] = {
        "username": account["username"],
        "profileUrl": account["profileUrl"],
        "followers": account["followers"],
        "avgViews": avg_views,
        "avgLikes": avg_likes,
        "relevance": analysis,
    }

    baseline_row = _latest_valid_baseline(supabase, client_id)
    baseline_for_eval = None
    if baseline_row:
        baseline_for_eval = {
            "p90_views": baseline_row.get("p90_views") or 0,
            "median_views": baseline_row.get("median_views") or 0,
            "p10_views": baseline_row.get("p10_views") or 0,
        }

    scored: Optional[Dict[str, Any]] = None
    if baseline_for_eval:
        scored = evaluate_competitor(disc, baseline_for_eval, cfg["language"])

    return {
        "already_tracked": False,
        "username": account["username"],
        "profile_url": account["profileUrl"],
        "followers": account["followers"],
        "avg_views": avg_views,
        "avg_likes": avg_likes,
        "relevance_score": rel_score,
        "reasoning": analysis.get("reasoning"),
        "topics": analysis.get("primary_topics") or [],
        "language": analysis.get("language"),
        "content_style": analysis.get("content_style"),
        "composite_score": scored["composite_score"] if scored else None,
        "tier": scored["tier"] if scored else None,
        "tier_label": scored["tier_label"] if scored else None,
        "performance_score": scored["performance_score"] if scored else None,
        "language_bonus": scored["language_bonus"] if scored else None,
    }


def add_manual_competitor(
    settings: Settings,
    *,
    client_id: str,
    raw_input: str,
    added_by: Optional[str],
) -> Dict[str, Any]:
    """Re-scrape and save — no relevance threshold; human already confirmed in UI."""
    preview = preview_manual_competitor(settings, client_id=client_id, raw_input=raw_input)
    if preview.get("already_tracked"):
        return preview

    if not settings.apify_api_token or not settings.openrouter_api_key:
        raise RuntimeError("APIFY_API_TOKEN and OPENROUTER_API_KEY required")

    supabase = get_supabase_for_settings(settings)
    crow = supabase.table("clients").select("*").eq("id", client_id).limit(1).execute()
    if not crow.data:
        raise RuntimeError("Client not found")
    client = crow.data[0]
    cfg = _client_cfg_from_row(client)
    username = preview["username"]

    account = fetch_instagram_user_by_username(settings.apify_api_token, username, exclude_username=cfg["instagram"])
    if not account:
        raise ValueError("Account disappeared — try again")

    account["_client_lang"] = cfg["language"]
    posts = _scrape_account_posts(settings.apify_api_token, account["username"], 20, account.get("_latestPosts"))
    if len(posts) < 1:
        raise ValueError("Not enough posts to save")

    total_views = sum(p["views"] for p in posts)
    avg_views = round(total_views / len(posts))
    avg_likes = round(sum(p["likes"] for p in posts) / len(posts))

    niche_profile = _build_niche_profile(cfg)
    prompt = _build_relevance_prompt(niche_profile, account, posts[:8])
    analysis = analyze_relevance(settings.openrouter_api_key, prompt, settings.openrouter_model)
    rel_score = int(analysis.get("relevance_score") or 0)

    disc: Dict[str, Any] = {
        "username": account["username"],
        "profileUrl": account["profileUrl"],
        "followers": account["followers"],
        "avgViews": avg_views,
        "avgLikes": avg_likes,
        "relevance": analysis,
    }

    baseline_row = _latest_valid_baseline(supabase, client_id)
    baseline_for_eval = None
    if baseline_row:
        baseline_for_eval = {
            "p90_views": baseline_row.get("p90_views") or 0,
            "median_views": baseline_row.get("median_views") or 0,
            "p10_views": baseline_row.get("p10_views") or 0,
        }

    row: Dict[str, Any] = {
        "client_id": client_id,
        "username": account["username"],
        "profile_url": account["profileUrl"],
        "followers": account["followers"],
        "avg_views": avg_views,
        "avg_likes": avg_likes,
        "language": analysis.get("language"),
        "content_style": analysis.get("content_style"),
        "topics": analysis.get("primary_topics") or [],
        "reasoning": analysis.get("reasoning"),
        "relevance_score": rel_score,
        "discovery_job_id": None,
        "added_by": (added_by or "").strip() or None,
    }

    if baseline_for_eval:
        scored = evaluate_competitor(disc, baseline_for_eval, cfg["language"])
        row.update(
            {
                "performance_score": scored["performance_score"],
                "language_bonus": scored["language_bonus"],
                "composite_score": scored["composite_score"],
                "tier": scored["tier"],
                "tier_label": scored["tier_label"],
            }
        )

    existing = (
        supabase.table("competitors")
        .select("id, added_by")
        .eq("client_id", client_id)
        .eq("username", account["username"])
        .limit(1)
        .execute()
    )
    if existing.data:
        row["id"] = existing.data[0]["id"]
        if existing.data[0].get("added_by") and not row.get("added_by"):
            row["added_by"] = existing.data[0]["added_by"]
    else:
        row["id"] = generate_competitor_id()

    supabase.table("competitors").upsert(row, on_conflict="client_id,username").execute()

    return {
        "saved": True,
        "username": account["username"],
        "added_by": row.get("added_by"),
        "relevance_score": rel_score,
        "composite_score": row.get("composite_score"),
    }
