from datetime import datetime, timedelta, timezone

from services.reel_diagnostics import compute_norm, diagnose_reel, resolve_thresholds

NOW = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)
TH = resolve_thresholds({})


def _reel(days_ago, views, likes, comments, outlier=False):
    return {
        "posted_at": (NOW - timedelta(days=days_ago)).isoformat(),
        "views": views,
        "likes": likes,
        "comments": comments,
        "is_outlier": outlier,
    }


# 12 mature reels: median views 10_000, comment rate 1%, engagement rate 5%.
BASE = [_reel(4 + i, 10_000, 400, 100) for i in range(12)]
NORM = compute_norm(BASE, TH, NOW)


def test_norm_needs_ten_mature_reels():
    assert compute_norm(BASE[:9], TH, NOW) is None
    # Reels younger than 3 days don't count toward the minimum.
    young = [_reel(1, 10_000, 400, 100) for _ in range(20)]
    assert compute_norm(young, TH, NOW) is None
    assert NORM["median_views"] == 10_000
    assert NORM["reels_in_median"] == 12


def test_scale_on_double_views_or_outlier_flag():
    assert diagnose_reel(_reel(5, 25_000, 1000, 250), NORM, TH)["bucket"] == "scale"
    out = diagnose_reel(_reel(5, 11_000, 440, 110, outlier=True), NORM, TH)
    assert out["bucket"] == "scale" and "outlier" in out["reason"]


def test_adjust_cta_when_watched_but_few_comments():
    d = diagnose_reel(_reel(5, 12_000, 600, 20), NORM, TH)
    assert d["bucket"] == "adjust_cta"
    assert d["reason"] == "Views 1.2× median · comments/view 0.2× → Adjust CTA"


def test_adjust_hook_when_low_reach_but_engaged():
    assert diagnose_reel(_reel(5, 3_000, 200, 40), NORM, TH)["bucket"] == "adjust_hook"


def test_retire_when_low_reach_and_low_engagement():
    assert diagnose_reel(_reel(5, 3_000, 50, 5), NORM, TH)["bucket"] == "retire"


def test_keep_in_between():
    assert diagnose_reel(_reel(5, 9_000, 360, 90), NORM, TH)["bucket"] == "keep"


def test_thresholds_override_per_client():
    th = resolve_thresholds({"scale_views_x": 3, "bogus": 9, "low_views_x": -1})
    assert th["scale_views_x"] == 3.0 and th["low_views_x"] == 0.7 and "bogus" not in th
    assert diagnose_reel(_reel(5, 25_000, 1000, 250), NORM, th)["bucket"] == "keep"


def test_fractional_counts_are_clamped_to_whole_numbers():
    th = resolve_thresholds({"min_reels": 0.5, "median_window": 0.3, "min_age_days": 0.2})
    assert th["min_reels"] == 1 and th["median_window"] == 1 and th["min_age_days"] == 1
    # No mature reels: returns None instead of crashing on an empty median.
    assert compute_norm([], th, NOW) is None


def test_window_never_smaller_than_minimum():
    th = resolve_thresholds({"min_reels": 20, "median_window": 5})
    assert th["median_window"] == 20
