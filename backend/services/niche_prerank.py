"""Heuristic pre-rank for niche discovery before Gemini (relevance over raw engagement)."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def _parse_posted_at(iso: str) -> Optional[datetime]:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except Exception:
        return None


def _keyword_overlap_score(caption: str, keywords: List[str]) -> float:
    if not caption or not keywords:
        return 0.0
    cl = caption.lower()
    score = 0.0
    for kw in keywords:
        kl = str(kw).strip().lower()
        if not kl:
            continue
        if kl in cl:
            score += 3.0
            continue
        parts = [p for p in kl.split() if len(p) > 1]
        if parts and all(p in cl for p in parts):
            score += 2.0
    return score


def prerank_reels_for_similarity(
    reels: List[Dict[str, Any]],
    *,
    keywords: List[str],
    recency_days: int = 14,
) -> List[Dict[str, Any]]:
    """Sort by relevance heuristics (keyword overlap, recency, light engagement signal)."""
    now = datetime.now(timezone.utc)
    scored: List[tuple[float, Dict[str, Any]]] = []
    for r in reels:
        cap = str(r.get("caption") or "")
        ko = _keyword_overlap_score(cap, keywords)
        views = int(r.get("views") or 0)
        eng = math.log10(max(views, 0) + 1) * 0.5
        dt = _parse_posted_at(str(r.get("posted_at") or ""))
        recency = 0.0
        if dt is not None:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            age_days = (now - dt.astimezone(timezone.utc)).total_seconds() / 86400.0
            if age_days <= recency_days:
                recency = max(0.0, 5.0 - age_days / max(recency_days, 1) * 5.0)
        total = ko + eng + recency
        scored.append((total, r))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [x[1] for x in scored]
