"""Apify actor runs (sync) — ports scripts/competitor-discovery.js helpers."""

from __future__ import annotations

import logging
import time
from typing import Any, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)


def instagram_profile_posts_input(usernames: List[str], results_limit: int) -> dict[str, Any]:
    """Input for ``apify~instagram-scraper`` — recent posts (includes carousel / Sidecar)."""
    return {
        "username": usernames,
        "resultsLimit": results_limit,
        "resultsType": "posts",
    }


def instagram_reel_scraper_input(
    usernames: List[str],
    results_limit: int,
    *,
    include_shares_count: bool = True,
    only_newer_than: Optional[str] = None,
) -> dict[str, Any]:
    """Input for ``apify~instagram-reel-scraper``. Shares need ``includeSharesCount`` (paid Apify tiers).

    ``only_newer_than`` pushes a server-side recency filter into Apify instead of filtering
    client-side. Actor accepts ``YYYY-MM-DD``, ISO timestamp, or relative strings matching
    ``^(\\d+)\\s*(minute|hour|day|week|month|year)s?$`` (e.g. ``"2 days"``, ``"1 week"``).
    Pay-per-result billing means this lowers cost when the profile has few new posts.
    """
    body: dict[str, Any] = {
        "username": usernames,
        "resultsLimit": results_limit,
    }
    if include_shares_count:
        body["includeSharesCount"] = True
    if only_newer_than:
        body["onlyPostsNewerThan"] = only_newer_than
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
INSTAGRAM_SCRAPER = "apify~instagram-scraper"

# Batch size for directUrls enrichment — keep small to avoid actor timeouts.
_ENRICH_BATCH_SIZE = 20


def _sasky_limit_str(max_items: int) -> str:
    """Sasky actor expects ``limit`` as a string; ``0`` means unlimited (per actor README)."""
    if max_items <= 0:
        return "0"
    return str(min(int(max_items), 5000))


def run_keyword_reel_search(
    token: str,
    keyword: str,
    max_items: int = 50,
    *,
    date: Optional[str] = None,
) -> list:
    """Instagram reel search by topic keyword / hashtag phrase; returns items with user_name, reel_url, etc.

    Input matches ``sasky/instagram-keyword-reels-urls-scraper``: ``keywords`` array + ``limit`` (string), not
    legacy ``keyword`` / ``maxItems``.
    """
    body: dict[str, Any] = {
        "keywords": [keyword.strip()],
        "limit": _sasky_limit_str(max_items),
    }
    if date and str(date).strip().lower() not in ("", "ignore"):
        body["date"] = date
    return run_actor(token, KEYWORD_REEL_ACTOR, body)


def run_keyword_reel_search_batch(
    token: str,
    keywords: List[str],
    *,
    max_items_total: int = 80,
    date: str = "last-1-week",
) -> list:
    """One Sasky run with all keywords; on failure, sequential single-keyword runs (same input schema)."""
    cleaned = [k.strip() for k in keywords if k and str(k).strip()]
    if not cleaned:
        return []

    body: dict[str, Any] = {
        "keywords": cleaned,
        "limit": _sasky_limit_str(max_items_total),
    }
    if date and str(date).strip().lower() not in ("", "ignore"):
        body["date"] = date

    try:
        return run_actor(token, KEYWORD_REEL_ACTOR, body) or []
    except Exception:
        logger.warning(
            "Sasky multi-keyword run failed; falling back to per-keyword search",
            exc_info=True,
        )

    out: List[dict] = []
    per = max(10, max_items_total // max(len(cleaned), 1))
    for kw in cleaned:
        try:
            out.extend(
                run_keyword_reel_search(token, kw, max_items=per, date=date) or []
            )
        except Exception:
            logger.warning("Sasky keyword search failed for %r", kw, exc_info=True)
        time.sleep(1)
    return out


def enrich_reel_urls_direct(
    token: str,
    urls: List[str],
    *,
    extra_input: Optional[dict] = None,
) -> Tuple[List[dict], List[str]]:
    """Fetch full reel data for Instagram reel/post URLs via apify~instagram-scraper.

    Returns ``(items, errors)``. Failed batches append to ``errors``; partial success is preserved.
    """
    if not urls:
        return [], []

    all_items: List[dict] = []
    errors: List[str] = []
    for i in range(0, len(urls), _ENRICH_BATCH_SIZE):
        chunk = urls[i : i + _ENRICH_BATCH_SIZE]
        actor_input: dict[str, Any] = {"directUrls": chunk, "resultsLimit": len(chunk)}
        if extra_input:
            actor_input.update(extra_input)
        try:
            items = run_actor(
                token,
                INSTAGRAM_SCRAPER,
                actor_input,
            )
            all_items.extend(items or [])
        except Exception as e:
            msg = f"enrich batch {i // _ENRICH_BATCH_SIZE + 1}: {type(e).__name__}: {e}"
            logger.warning(msg, exc_info=True)
            errors.append(msg[:500])
        if i + _ENRICH_BATCH_SIZE < len(urls):
            time.sleep(2)

    return all_items, errors
