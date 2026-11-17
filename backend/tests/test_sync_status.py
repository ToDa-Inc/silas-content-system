"""``latest_successful_sync_at`` drives the dashboard's "Last refreshed" date.

Only completed jobs that actually refreshed data may move it: a baseline that found no recent
reels, a reels refresh that enriched nothing, and failed jobs must not.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict, List

import pytest

from jobs import scraped_reels_refresh
from services.sync_status import latest_successful_sync_at


class _Query:
    def __init__(self, rows: List[Dict[str, Any]]) -> None:
        self._rows = rows
        self._eq: Dict[str, Any] = {}
        self._limit = 1000

    def select(self, *_a, **_k):
        return self

    def eq(self, key, value):
        self._eq[key] = value
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def execute(self):
        rows = [r for r in self._rows if all(r.get(k) == v for k, v in self._eq.items())]
        rows.sort(key=lambda r: r["completed_at"], reverse=True)
        return SimpleNamespace(data=rows[: self._limit])


class FakeSupabase:
    def __init__(self, jobs: List[Dict[str, Any]]) -> None:
        self.jobs = jobs
        self.updates: List[Dict[str, Any]] = []

    def table(self, name: str):
        assert name == "background_jobs"
        return _Query(self.jobs)


def _job(job_type: str, completed_at: str, *, status: str = "completed", **extra: Any) -> Dict[str, Any]:
    return {
        "client_id": "c1",
        "job_type": job_type,
        "status": status,
        "completed_at": completed_at,
        "payload": extra.pop("payload", {}),
        "result": extra.pop("result", {}),
    }


def test_returns_none_when_nothing_ran():
    assert latest_successful_sync_at(FakeSupabase([]), "c1") is None


def test_own_profile_scrape_counts_but_competitor_scrapes_do_not():
    db = FakeSupabase(
        [
            _job("profile_scrape", "2026-11-17T05:10:00+00:00", payload={"scrape_own": True}),
            _job("profile_scrape", "2026-11-17T05:30:00+00:00", payload={"competitor_id": "x"}),
        ]
    )
    assert latest_successful_sync_at(db, "c1") == "2026-11-17T05:10:00+00:00"


def test_own_scrape_is_found_behind_many_newer_competitor_scrapes():
    competitors = [
        _job("profile_scrape", f"2026-11-17T06:{i % 60:02d}:00+00:00", payload={"competitor_id": str(i)})
        for i in range(150)
    ]
    own = _job("profile_scrape", "2026-11-17T05:00:00+00:00", payload={"scrape_own": True})
    assert latest_successful_sync_at(FakeSupabase(competitors + [own]), "c1") == "2026-11-17T05:00:00+00:00"


def test_failed_jobs_do_not_count():
    db = FakeSupabase(
        [
            _job("profile_scrape", "2026-11-17T05:10:00+00:00", status="failed", payload={"scrape_own": True}),
            _job("scraped_reels_refresh", "2026-11-17T06:30:00+00:00", status="failed", result={"enriched": 9}),
        ]
    )
    assert latest_successful_sync_at(db, "c1") is None


def test_refresh_that_enriched_nothing_does_not_count():
    db = FakeSupabase(
        [_job("scraped_reels_refresh", "2026-11-17T06:30:00+00:00", result={"enriched": 0, "enrich_errors": ["HTTP 401"]})]
    )
    assert latest_successful_sync_at(db, "c1") is None


def test_baseline_with_no_recent_reels_does_not_count():
    db = FakeSupabase([_job("baseline_scrape", "2026-11-17T09:00:00+00:00", result={"skipped": "no_recent_reels"})])
    assert latest_successful_sync_at(db, "c1") is None


def test_newest_of_all_sources_wins_across_timestamp_formats():
    db = FakeSupabase(
        [
            _job("baseline_scrape", "2026-11-02T14:44:00+00:00", result={"reels_analyzed": 3}),
            _job("scraped_reels_refresh", "2026-11-17T06:30:00Z", result={"enriched": 12}),
            _job("profile_scrape", "2026-11-17T05:10:00+00:00", payload={"scrape_own": True}),
        ]
    )
    assert latest_successful_sync_at(db, "c1") == "2026-11-17T06:30:00Z"


# --- a refresh where every Apify batch fails must fail the job ----------------------------


class _RefreshDb:
    """Just enough Supabase for run_scraped_reels_refresh up to the enrich step."""

    def __init__(self) -> None:
        self.saved: List[Dict[str, Any]] = []

    def table(self, name: str):
        db = self

        class Q:
            def __init__(self) -> None:
                self._update: Any = None

            def select(self, *_a, **_k): return self
            def gte(self, *_a, **_k): return self
            def order(self, *_a, **_k): return self
            def limit(self, *_a, **_k): return self
            def eq(self, *_a, **_k): return self

            def update(self, payload):
                self._update = payload
                return self

            def execute(self):
                if self._update is not None:
                    db.saved.append(self._update)
                    return SimpleNamespace(data=[])
                return SimpleNamespace(
                    data=[{"id": "r1", "post_url": "https://www.instagram.com/reel/AAA/", "views": 1,
                           "likes": 0, "comments": 0, "last_updated_at": None}]
                )

        return Q()


def test_refresh_raises_when_every_enrich_batch_failed(monkeypatch):
    db = _RefreshDb()
    monkeypatch.setattr(scraped_reels_refresh, "get_supabase_for_settings", lambda _s: db)
    monkeypatch.setattr(
        scraped_reels_refresh,
        "enrich_reel_urls_direct",
        lambda *_a, **_k: ([], ["enrich batch 1: ApifyError: Apify HTTP 401"], False),
    )
    settings = SimpleNamespace(apify_api_token="t")

    with pytest.raises(RuntimeError, match="Apify enrich failed for all 1 reels"):
        scraped_reels_refresh.run_scraped_reels_refresh(settings, {"id": "job_1", "client_id": "c1", "payload": {}})

    assert db.saved[-1]["result"]["phase"] == "failed"
    assert not any(u.get("status") == "completed" for u in db.saved)


# --- the endpoint helper: never worse than the baseline date, never breaks the page ---------


def test_endpoint_uses_newer_job_date_over_baseline():
    from routers.intelligence import _last_synced_at

    db = FakeSupabase([_job("profile_scrape", "2026-11-17T05:10:00+00:00", payload={"scrape_own": True})])
    assert _last_synced_at(db, "c1", {"scraped_at": "2026-11-02T14:44:00+00:00"}) == "2026-11-17T05:10:00+00:00"


def test_endpoint_keeps_baseline_date_when_jobs_are_older_or_missing():
    from routers.intelligence import _last_synced_at

    baseline = {"scraped_at": "2026-11-17T08:00:00+00:00"}
    older = FakeSupabase([_job("profile_scrape", "2026-11-10T05:10:00+00:00", payload={"scrape_own": True})])
    assert _last_synced_at(older, "c1", baseline) == "2026-11-17T08:00:00+00:00"
    assert _last_synced_at(FakeSupabase([]), "c1", baseline) == "2026-11-17T08:00:00+00:00"


def test_endpoint_falls_back_to_baseline_date_when_the_lookup_errors():
    from routers.intelligence import _last_synced_at

    class Broken:
        def table(self, _name):
            raise RuntimeError("db down")

    assert _last_synced_at(Broken(), "c1", {"scraped_at": "2026-11-02T14:44:00+00:00"}) == "2026-11-02T14:44:00+00:00"
