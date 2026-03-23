"""Apify actor runs (sync) — ports scripts/competitor-discovery.js helpers."""

from __future__ import annotations

import time

import httpx


def _poll_run(token: str, actor_id: str, run_id: str, max_attempts: int = 60) -> None:
    with httpx.Client(timeout=120.0) as client:
        for attempt in range(max_attempts):
            time.sleep(5)
            r = client.get(
                f"https://api.apify.com/v2/acts/{actor_id}/runs/{run_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            r.raise_for_status()
            status = r.json()["data"]["status"]
            if status == "SUCCEEDED":
                return
            if status in ("FAILED", "ABORTED"):
                raise RuntimeError(f"Apify run {status}")


def run_actor(token: str, actor_id: str, body: dict) -> list:
    """Start actor, wait until SUCCEEDED, return dataset items."""
    with httpx.Client(timeout=120.0) as client:
        r = client.post(
            f"https://api.apify.com/v2/acts/{actor_id}/runs",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=body,
        )
        r.raise_for_status()
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
REEL_ACTOR = "xMc5Ga1oCONPmWJIa"
