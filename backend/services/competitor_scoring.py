"""Performance + tier scoring — ports evaluateCompetitor from competitor-eval.js."""

from __future__ import annotations

from typing import Any


def _language_bonus(client_lang: str, detected: str | None) -> int:
    if not detected:
        return 0
    d = detected.lower()
    c = (client_lang or "").lower()
    if c in ("de", "german") and ("german" in d or d in ("de", "ger", "deutsch")):
        return 10
    if c in ("en", "english") and ("english" in d or d in ("en", "eng")):
        return 10
    return 0


def evaluate_competitor(
    competitor: dict[str, Any],
    baseline: dict[str, Any],
    client_lang: str,
    min_views_override: int | None = None,
) -> dict[str, Any]:
    relevance = competitor.get("relevance") or {}
    relevance_score = int(relevance.get("relevance_score") or 0)
    avg_views = int(competitor.get("avgViews") or competitor.get("avg_views") or 0)
    avg_likes = int(competitor.get("avgLikes") or competitor.get("avg_likes") or 0)
    content_style = relevance.get("content_style") or "unknown"
    language = relevance.get("language") or "unknown"

    blueprint_v = int(baseline.get("p90_views") or 0)
    min_useful = int(baseline.get("median_views") or 0)
    peer_v = int(baseline.get("p10_views") or 0)
    min_views = min_views_override if min_views_override is not None else min_useful

    performance_score = 0
    if avg_views >= blueprint_v and blueprint_v > 0:
        performance_score = 100
    elif avg_views >= min_useful and min_useful > 0:
        performance_score = 75
    elif avg_views >= peer_v and peer_v > 0:
        performance_score = 40
    elif avg_views >= 1000:
        performance_score = 20
    else:
        performance_score = 5

    lang_bonus = _language_bonus(client_lang, language)

    composite_score = round(
        (relevance_score * 0.50) + (performance_score * 0.40) + (lang_bonus * 1.0)
    )

    tier = 4
    tier_label = "SKIP — Too small or too different to learn from"
    if composite_score >= 80 and avg_views >= min_views:
        tier = 1
        tier_label = "BLUEPRINT — Study their viral patterns, replicate hooks and formats"
    elif composite_score >= 60 and avg_views >= peer_v:
        tier = 2
        tier_label = "STRONG — Worth tracking, good content angles to adapt"
    elif relevance_score >= 60 and avg_views >= 1000:
        tier = 3
        tier_label = "PEER — Similar niche, smaller scale. Watch for breakout content"

    return {
        "username": competitor.get("username"),
        "profile_url": competitor.get("profileUrl") or competitor.get("profile_url"),
        "followers": competitor.get("followers"),
        "avg_views": avg_views,
        "avg_likes": avg_likes,
        "language": language,
        "content_style": content_style,
        "topics": relevance.get("primary_topics") or [],
        "reasoning": relevance.get("reasoning") or "",
        "relevance_score": relevance_score,
        "performance_score": performance_score,
        "language_bonus": lang_bonus,
        "composite_score": composite_score,
        "tier": tier,
        "tier_label": tier_label,
    }
