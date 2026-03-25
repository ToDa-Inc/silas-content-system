"""Resolve an Instagram username to the same account dict shape as user search (for seeds)."""

from __future__ import annotations

from typing import Any, Dict, Optional

from services.apify import SEARCH_ACTOR, run_actor


def fetch_instagram_user_by_username(
    token: str,
    username: str,
    exclude_username: str = "",
) -> Optional[Dict[str, Any]]:
    """Instagram user search; return the row whose username exactly matches (case-insensitive)."""
    want = username.strip().lstrip("@").lower()
    if not want:
        return None
    exclude = (exclude_username or "").lower().strip("@")
    results = run_actor(
        token,
        SEARCH_ACTOR,
        {"search": want, "searchType": "user", "resultsLimit": 30},
    )
    for r in results:
        un = (r.get("username") or "").lower()
        if not un or un == exclude or un != want:
            continue
        if r.get("private"):
            continue
        followers = int(r.get("followersCount") or 0)
        if followers < 500 or followers > 5_000_000:
            continue
        return {
            "username": r.get("username"),
            "fullName": r.get("fullName") or "",
            "bio": r.get("biography") or "",
            "followers": followers,
            "isVerified": r.get("verified") or False,
            "isPrivate": r.get("private") or False,
            "profileUrl": f"https://www.instagram.com/{r.get('username')}/",
            "_latestPosts": r.get("latestPosts") or [],
        }
    return None
