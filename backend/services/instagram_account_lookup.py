"""Resolve an Instagram username to the same account dict shape as user search (for seeds)."""

from __future__ import annotations

from typing import Any, Dict, Optional

from services.apify import REEL_ACTOR, SEARCH_ACTOR, instagram_reel_scraper_input, run_actor


def _account_from_reel_actor_items(
    want: str,
    exclude: str,
    items: list,
) -> Optional[Dict[str, Any]]:
    """When user search does not return an exact handle, verify via reel scraper (same idea as
    ``scripts/competitor-discovery.js`` ``accountFromUsername`` + ``scrapeAccountPosts``)."""
    if not items:
        return None
    want_l = want.lower()
    if exclude and want_l == exclude:
        return None

    first = items[0]
    owner_raw = first.get("ownerUsername") or ""
    if isinstance(first.get("owner"), dict):
        owner_raw = owner_raw or (first.get("owner") or {}).get("username") or ""
    owner = str(owner_raw).strip().lstrip("@")
    if owner and owner.lower() != want_l:
        return None

    canon = owner if owner else want
    followers = 0
    oc = first.get("owner")
    if isinstance(oc, dict):
        followers = int(
            oc.get("followersCount")
            or (oc.get("edge_followed_by") or {}).get("count")
            or 0
        )
    if not followers:
        followers = int(first.get("followersCount") or 0)

    return {
        "username": canon,
        "fullName": "",
        "bio": "",
        "followers": followers,
        "isVerified": bool(first.get("verified")),
        "isPrivate": False,
        "profileUrl": f"https://www.instagram.com/{canon}/",
        "_latestPosts": items[:25],
    }


def fetch_instagram_user_by_username(
    token: str,
    username: str,
    exclude_username: str = "",
    *,
    enforce_follower_bounds: bool = True,
    reel_actor: str = REEL_ACTOR,
    include_shares_count: bool = True,
) -> Optional[Dict[str, Any]]:
    """Instagram user search; return the row whose username exactly matches (case-insensitive).

    Discovery uses ``enforce_follower_bounds=True`` (500–5M followers). Manual paste flows
    pass ``False`` so smaller accounts are not rejected as “not found”.
    """
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
        if enforce_follower_bounds and (followers < 500 or followers > 5_000_000):
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

    # User search often omits an exact handle even when the profile exists. For manual flows,
    # fall back to the reel actor (matches legacy ``--username`` in competitor-discovery.js).
    if not enforce_follower_bounds:
        reel_items = run_actor(
            token,
            reel_actor,
            instagram_reel_scraper_input(
                [want],
                25,
                include_shares_count=include_shares_count,
            ),
        )
        return _account_from_reel_actor_items(want, exclude, reel_items)

    return None
