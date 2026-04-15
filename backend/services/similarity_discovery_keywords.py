"""Resolve reel-caption search keywords for keyword_reel_similarity — no hardcoded phrases."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Set, Tuple

DEFAULT_MAX_KEYWORDS = 24
_MIN_LEN = 2
_MAX_PHRASE_LEN = 120


def _from_similarity_keywords(dna: dict) -> List[str]:
    sim = dna.get("similarity_keywords") or {}
    out: List[str] = []
    if isinstance(sim, dict):
        for bucket in sim.values():
            if isinstance(bucket, list):
                out.extend(str(x).strip() for x in bucket if x)
    elif isinstance(sim, list):
        out.extend(str(x).strip() for x in sim if x)
    return out


def _from_dna_keywords(dna: dict) -> List[str]:
    fb = dna.get("keywords") or []
    out: List[str] = []
    if isinstance(fb, dict):
        for v in fb.values():
            if isinstance(v, list):
                out.extend(str(x).strip() for x in v if x)
    elif isinstance(fb, list):
        out.extend(str(x).strip() for x in fb if x)
    return out


def _from_niche_config(niche_config: Any) -> List[str]:
    if not isinstance(niche_config, list):
        return []
    out: List[str] = []
    for n in niche_config:
        if not isinstance(n, dict):
            continue
        for ang in n.get("content_angles") or []:
            if ang:
                out.append(str(ang).strip())
    return out


def _from_icp(icp: Any) -> List[str]:
    if not isinstance(icp, dict):
        return []
    out: List[str] = []
    for key in ("pain_points", "desires"):
        for x in icp.get(key) or []:
            if x:
                out.append(str(x).strip())
    return out


def _take_until_cap(
    buckets: List[Tuple[str, List[str]]],
    max_keywords: int,
) -> Tuple[List[str], List[str]]:
    seen: Set[str] = set()
    out: List[str] = []
    used_tiers: List[str] = []
    cap = max(1, max_keywords)

    for tier_name, phrases in buckets:
        if not phrases or len(out) >= cap:
            continue
        added_any = False
        for raw in phrases:
            if len(out) >= cap:
                break
            s = " ".join(str(raw).strip().split())
            if len(s) < _MIN_LEN or len(s) > _MAX_PHRASE_LEN:
                continue
            key = s.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(s)
            added_any = True
        if added_any:
            used_tiers.append(tier_name)

    return out, used_tiers


def similarity_scan_keywords(
    *,
    client: Dict[str, Any],
    payload_keywords: Optional[List[str]] = None,
    max_keywords: int = DEFAULT_MAX_KEYWORDS,
) -> Tuple[List[str], str]:
    dna = client.get("client_dna") or {}
    if not isinstance(dna, dict):
        dna = {}

    buckets: List[Tuple[str, List[str]]] = [
        ("payload", [str(k).strip() for k in (payload_keywords or []) if k]),
        ("dna.similarity_keywords", _from_similarity_keywords(dna)),
        ("dna.keywords", _from_dna_keywords(dna)),
        ("niche_config.content_angles", _from_niche_config(client.get("niche_config"))),
        ("icp.pain_points+desires", _from_icp(client.get("icp"))),
    ]

    keywords, used = _take_until_cap(buckets, max_keywords)
    provenance = "+".join(used) if used else "none"
    return keywords, provenance
