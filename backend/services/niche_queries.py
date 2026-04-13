"""Niche keyword / hashtag lists from clients.niche_config — shared by competitor_discovery and niche_reel_scrape."""

from __future__ import annotations

from typing import Any, Dict, List


def pick_default_keyword(niche_config: List) -> str:
    if not niche_config:
        return "instagram marketing"
    n0 = niche_config[0]
    k_de = n0.get("keywords_de") or []
    k_en = n0.get("keywords") or []
    if k_de:
        return str(k_de[0])
    if k_en:
        return str(k_en[0])
    return str(n0.get("name") or "content creator")


def collect_hashtag_queries(niches: List, max_q: int = 6) -> List[str]:
    """Topic hashtags from niche_config (no #). Used as reel-search keywords."""
    out: List[str] = []
    seen: set[str] = set()
    for n in niches or []:
        if not isinstance(n, dict):
            continue
        for key in ("hashtags", "hashtags_de"):
            for h in n.get(key) or []:
                s = str(h).strip().lstrip("#")
                if not s:
                    continue
                low = s.lower()
                if low in seen:
                    continue
                seen.add(low)
                out.append(s)
                if len(out) >= max_q:
                    return out
    return out


def collect_keywords(niches: List, payload: Dict[str, Any]) -> List[str]:
    """Same as scripts competitor-batch-discover (--keywords / --lang)."""
    raw = payload.get("keywords")
    if isinstance(raw, list) and len(raw) > 0:
        out = [str(x).strip() for x in raw if str(x).strip()]
        if out:
            return out
    one = payload.get("keyword")
    if one and str(one).strip():
        return [str(one).strip()]
    mode = str(payload.get("keyword_mode") or "all").lower()
    if mode not in ("all", "de", "en"):
        mode = "all"
    seen: set[str] = set()
    ordered: List[str] = []
    for n in niches or []:
        if mode in ("all", "de"):
            for k in n.get("keywords_de") or []:
                s = str(k).strip()
                if s and s not in seen:
                    seen.add(s)
                    ordered.append(s)
        if mode in ("all", "en"):
            for k in n.get("keywords") or []:
                s = str(k).strip()
                if s and s not in seen:
                    seen.add(s)
                    ordered.append(s)
    if not ordered:
        return [pick_default_keyword(niches)]
    return ordered


def build_niche_reel_search_queries(
    niches: List,
    payload: Dict[str, Any],
    *,
    include_hashtags: bool = True,
    max_hashtag_queries: int = 6,
) -> List[str]:
    """Ordered unique queries: niche keywords (+ optional hashtags)."""
    kws = collect_keywords(niches, payload)
    if not include_hashtags or max_hashtag_queries <= 0:
        return kws
    seen = {k.lower() for k in kws}
    for h in collect_hashtag_queries(niches, max_q=max_hashtag_queries):
        low = h.lower()
        if low in seen:
            continue
        seen.add(low)
        kws.append(h)
    return kws
