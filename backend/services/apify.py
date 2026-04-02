"""Apify actor runs (sync) — ports scripts/competitor-discovery.js helpers."""

from __future__ import annotations

import time
from typing import Any, List

import httpx


def instagram_reel_scraper_input(
    usernames: List[str],
    results_limit: int,
    *,
    include_shares_count: bool = True,
) -> dict[str, Any]:
    """Input for ``apify~instagram-reel-scraper``. Shares need ``includeSharesCount`` (paid Apify tiers)."""
    body: dict[str, Any] = {
        "username": usernames,
        "resultsLimit": results_limit,
    }
    if include_shares_count:
        body["includeSharesCount"] = True
    return body


def _poll_run(token: str, actor_id: str, run_id: str, max_attempts: int = 120) -> None:
    """Poll until SUCCEEDED/FAILED/ABORTED or max_attempts (5s interval). Default ~10 min."""
    last = "UNKNOWN"
    with httpx.Client(timeout=120.0) as client:
        for _attempt in range(max_attempts):
            time.sleep(5)
            r = client.get(
                f"https://api.apify.com/v2/acts/{actor_id}/runs/{run_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            r.raise_for_status()
            last = r.json()["data"]["status"]
            if last == "SUCCEEDED":
                return
            if last in ("FAILED", "ABORTED"):
                raise RuntimeError(f"Apify run {last}")
    raise RuntimeError(
        f"Apify run {run_id} timed out after {max_attempts * 5}s (last status: {last})"
    )


def run_actor(token: str, actor_id: str, body: dict) -> list:
    """Start actor, wait until SUCCEEDED, return dataset items."""
    with httpx.Client(timeout=120.0) as client:
        r = client.post(
            f"https://api.apify.com/v2/acts/{actor_id}/runs",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=body,
        )
        if r.status_code >= 400:
            err_body = (r.text or "")[:800]
            raise RuntimeError(
                f"Apify HTTP {r.status_code} for acts/{actor_id}/runs. "
                f"{err_body or 'No response body.'}"
            )
        data = r.json()["data"]
        run_id = data["id"]
        dataset_id = data["defaultDatasetId"]

    _poll_run(token, actor_id, run_id)

    with httpx.Client(timeout=120.0) as client:
        r = client.get(
            f"https://api.apify.com/v2/datasets/{dataset_id}/items",
            headers={"Authorization": f"Bearer {token}"},
        )
        r.raise_for_status()
        return r.json()


# Actor IDs (same as Node scripts)
SEARCH_ACTOR = "DrF9mzPPEuVizVF4l"
# Official Store actor (username~name). Legacy ID xMc5Ga1oCONPmWJIa can 403 for some tokens.
# Override with env APIFY_REEL_ACTOR if needed (see Settings).
REEL_ACTOR = "apify~instagram-reel-scraper"
# Sasky — topic/hashtag-style reel search → usernames (docs/VIRAL-DISCOVERY-SPEC.md)
KEYWORD_REEL_ACTOR = "4QFjEpnGE1PNEnQF2"


def run_keyword_reel_search(token: str, keyword: str, max_items: int = 50) -> list:
    """Instagram reel search by topic keyword / hashtag phrase; returns items with user_name, reel_url, etc."""
    return run_actor(
        token,
        KEYWORD_REEL_ACTOR,
        {"keyword": keyword.strip(), "maxItems": max_items},
    )
