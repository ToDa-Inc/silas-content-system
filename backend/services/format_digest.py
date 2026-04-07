"""Pre-compute per-format pattern digests from mature reel analyses (7d+ posted_at)."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from supabase import Client

from core.config import Settings
from services.format_classifier import canonicalize_stored_format_key, normalize_format_from_analysis
from services.content_generation import _pack_client_row_for_llm, compact_analysis_for_prompt
from services.openrouter import chat_json_completion
from services.reel_metrics import compute_niche_benchmarks, enrich_engagement_metrics

logger = logging.getLogger(__name__)

MATURITY_DAYS = 7
STALE_HOURS = 12

_SYSTEM_JSON = (
    "You are Silas — a senior Instagram Reels strategist. "
    "Reply with a single valid JSON object only (no markdown fences, no commentary)."
)


def _parse_posted_at(raw: Any) -> Optional[datetime]:
    if raw is None:
        return None
    try:
        s = str(raw).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def _is_mature(posted_at: Any, now: datetime) -> bool:
    dt = _parse_posted_at(posted_at)
    if dt is None:
        return False
    return dt <= now - timedelta(days=MATURITY_DAYS)


def _nf_for_row(row: Dict[str, Any]) -> str:
    raw = row.get("normalized_format")
    if isinstance(raw, str) and raw.strip():
        out = str(raw).strip()
    else:
        fa = row.get("full_analysis_json") if isinstance(row.get("full_analysis_json"), dict) else {}
        out = normalize_format_from_analysis(
            content_angle=row.get("content_angle"),
            full_analysis_json=fa,
        )
    ck = canonicalize_stored_format_key(out)
    return ck or out


def is_digest_stale(supabase: Client, client_id: str) -> bool:
    """True if no digests or latest computation older than STALE_HOURS."""
    try:
        res = (
            supabase.table("format_digests")
            .select("computed_at")
            .eq("client_id", client_id)
            .order("computed_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception:
        return True
    if not res.data:
        return True
    ct = _parse_posted_at(res.data[0].get("computed_at"))
    if ct is None:
        return True
    now = datetime.now(timezone.utc)
    return ct < now - timedelta(hours=STALE_HOURS)


def _digest_summary_sort_key(row: Dict[str, Any]) -> tuple:
    """Prefer avg_comment_view_ratio for ordering; fall back to legacy avg_engagement."""
    cvr = row.get("avg_comment_view_ratio")
    if cvr is not None:
        try:
            return (0, -float(cvr))
        except (TypeError, ValueError):
            pass
    ae = row.get("avg_engagement")
    if ae is not None:
        try:
            return (1, -float(ae))
        except (TypeError, ValueError):
            pass
    return (2, 0.0)


def list_format_digest_summaries(supabase: Client, client_id: str) -> List[Dict[str, Any]]:
    """Rows for GET /format-digests (picker UI).

    Uses select('*') so the query works before and after optional migrations (e.g.
    avg_comment_view_ratio). A fixed column list that includes a missing column makes
    PostgREST return an error and this endpoint would silently return [].
    """
    try:
        res = (
            supabase.table("format_digests")
            .select("*")
            .eq("client_id", client_id)
            .execute()
        )
    except Exception as e:
        logger.warning("list_format_digest_summaries: %s", e)
        return []
    out: List[Dict[str, Any]] = [dict(r) for r in (res.data or [])]
    out.sort(key=_digest_summary_sort_key)
    return out


def get_digest_for_format(
    supabase: Client, client_id: str, format_key: str
) -> Optional[Dict[str, Any]]:
    fk = (format_key or "").strip()
    if not fk:
        return None
    keys: list[str] = []
    for k in (fk, canonicalize_stored_format_key(fk)):
        if k and k not in keys:
            keys.append(k)
    _broll = frozenset({"b_roll", "b_roll_reel"})
    if any(x in keys for x in _broll):
        for x in _broll:
            if x not in keys:
                keys.append(x)
    for k in keys:
        try:
            res = (
                supabase.table("format_digests")
                .select("*")
                .eq("client_id", client_id)
                .eq("format_key", k)
                .limit(1)
                .execute()
            )
        except Exception:
            continue
        if res.data:
            return dict(res.data[0])
    return None


def _llm_synthesize_format_digest(
    settings: Settings,
    *,
    format_key: str,
    client_brief: str,
    winners_compact: List[Dict[str, Any]],
    losers_compact: List[Dict[str, Any]],
    niche_benchmarks: Dict[str, Any],
) -> Dict[str, Any]:
    user = (
        f"TASK: Synthesize winning patterns for ONE reel format: {format_key!r}.\n"
        "You are given competitor analyses split into TOP performers vs WEAKER performers "
        "(by engagement_rate within this format). Weight insights from winners heavily; "
        "use losers to name anti-patterns and what to avoid.\n\n"
        "Output JSON with this exact shape:\n"
        "{\n"
        '  "hook_patterns": [{"name": string, "description": string, "example_from_data": string}],\n'
        '  "tension_mechanisms": [{"name": string, "description": string}],\n'
        '  "value_delivery_formats": [{"name": string, "description": string}],\n'
        '  "patterns_to_avoid": [string],\n'
        '  "format_insights": {"dominant_type": string, "optimal_duration": string, '
        '"engagement_drivers": string},\n'
        '  "performance_summary": string,\n'
        '  "one_paragraph_synthesis": string,\n'
        '  "top_performer_features": [string],\n'
        '  "weak_performer_issues": [string]\n'
        "}\n\n"
        f"NICHE_BENCHMARKS:\n{json.dumps(niche_benchmarks, ensure_ascii=False)[:4000]}\n\n"
        f"CLIENT_CONTEXT:\n{client_brief[:80_000]}\n\n"
        f"TOP_PERFORMERS_ANALYSES_JSON:\n{json.dumps(winners_compact, ensure_ascii=False)[:60_000]}\n\n"
        f"WEAKER_PERFORMERS_ANALYSES_JSON:\n{json.dumps(losers_compact, ensure_ascii=False)[:60_000]}\n"
    )
    return chat_json_completion(
        settings.openrouter_api_key,
        settings.openrouter_model,
        system=_SYSTEM_JSON,
        user=user,
        max_tokens=8192,
        temperature=0.25,
    )


def compute_format_digests(
    settings: Settings,
    supabase: Client,
    client_id: str,
    *,
    client_row: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Rebuild all format_digests rows for a client. Returns stats."""
    now = datetime.now(timezone.utc)
    sel = (
        "id, reel_id, post_url, owner_username, total_score, replicability_rating, "
        "hook_type, emotional_trigger, content_angle, caption_structure, why_it_worked, "
        "replicable_elements, suggested_adaptations, full_analysis_json, "
        "normalized_format, video_analyzed"
    )
    try:
        ares = supabase.table("reel_analyses").select(sel).eq("client_id", client_id).execute()
    except Exception as e:
        logger.exception("compute_format_digests: fetch analyses")
        return {"ok": False, "error": str(e)[:500], "formats_written": 0}

    analyses = list(ares.data or [])
    reel_ids = [str(r.get("reel_id")) for r in analyses if r.get("reel_id")]
    by_reel: Dict[str, Dict[str, Any]] = {}
    if reel_ids:
        try:
            rres = supabase.table("scraped_reels").select("*").in_("id", reel_ids).execute()
            for rr in rres.data or []:
                rid = str(rr.get("id") or "")
                if rid:
                    by_reel[rid] = enrich_engagement_metrics(dict(rr))
        except Exception:
            pass

    # Attach meta + maturity + format key
    enriched: List[Dict[str, Any]] = []
    for r in analyses:
        rid = str(r.get("reel_id") or "")
        meta = by_reel.get(rid) if rid else None
        r = dict(r)
        r["_reel_meta"] = meta
        r["_format_key"] = _nf_for_row(r)
        posted = (meta or {}).get("posted_at")
        r["_mature"] = _is_mature(posted, now)
        enriched.append(r)

    mature_by_fmt: Dict[str, List[Dict[str, Any]]] = {}
    for r in enriched:
        if not r.get("_mature"):
            continue
        fk = str(r.get("_format_key") or "other")
        mature_by_fmt.setdefault(fk, []).append(r)

    if client_row is None:
        try:
            cres = (
                supabase.table("clients")
                .select(
                    "id, name, instagram_handle, language, niche_config, icp, products, "
                    "client_context, client_dna"
                )
                .eq("id", client_id)
                .limit(1)
                .execute()
            )
            client_row = dict(cres.data[0]) if cres.data else {}
        except Exception:
            client_row = {}
    try:
        client_row = dict(client_row or {})
        client_row["_niche_benchmarks"] = compute_niche_benchmarks(supabase, client_id)
    except Exception:
        client_row["_niche_benchmarks"] = {}

    client_brief = _pack_client_row_for_llm(client_row)
    nb = client_row.get("_niche_benchmarks") if isinstance(client_row.get("_niche_benchmarks"), dict) else {}

    formats_written = 0
    for fmt, rows in mature_by_fmt.items():
        n = len(rows)
        if n < 1:
            continue

        def sort_key(x: Dict[str, Any]) -> float:
            m = x.get("_reel_meta") or {}
            cvr = m.get("comment_view_ratio")
            if cvr is not None:
                try:
                    return float(cvr)
                except (TypeError, ValueError):
                    pass
            er = m.get("engagement_rate")
            if er is None:
                return -1.0
            try:
                return float(er)
            except (TypeError, ValueError):
                return -1.0

        rows_sorted = sorted(rows, key=sort_key, reverse=True)
        top_n = max(1, int(n * 0.3 + 0.999)) if n >= 3 else max(1, n // 2)
        bot_n = max(1, int(n * 0.3 + 0.999)) if n >= 3 else max(1, (n + 1) // 2)
        winners = rows_sorted[:top_n]
        losers = rows_sorted[-bot_n:] if n >= 2 else []

        ers: List[float] = []
        cvrs: List[float] = []
        srs: List[float] = []
        shrs: List[float] = []
        durs: List[int] = []
        for r in rows_sorted:
            m = r.get("_reel_meta") or {}
            if m.get("engagement_rate") is not None:
                try:
                    ers.append(float(m["engagement_rate"]))
                except (TypeError, ValueError):
                    pass
            if m.get("comment_view_ratio") is not None:
                try:
                    cvrs.append(float(m["comment_view_ratio"]))
                except (TypeError, ValueError):
                    pass
            if m.get("save_rate") is not None:
                try:
                    srs.append(float(m["save_rate"]))
                except (TypeError, ValueError):
                    pass
            if m.get("share_rate") is not None:
                try:
                    shrs.append(float(m["share_rate"]))
                except (TypeError, ValueError):
                    pass
            vd = m.get("video_duration")
            if vd is not None:
                try:
                    di = int(vd)
                    if di > 0:
                        durs.append(di)
                except (TypeError, ValueError):
                    pass

        def pack_list(lst: List[Dict[str, Any]], cap: int) -> List[Dict[str, Any]]:
            out: List[Dict[str, Any]] = []
            for r in lst[:cap]:
                meta = r.get("_reel_meta")
                out.append(
                    compact_analysis_for_prompt(
                        {k: v for k, v in r.items() if not str(k).startswith("_")},
                        reel_meta=meta if isinstance(meta, dict) else None,
                    )
                )
            return out

        winners_c = pack_list(winners, 8)
        losers_c = pack_list(losers, 6) if losers else []

        digest_json: Dict[str, Any]
        if n >= 2 and settings.openrouter_api_key:
            try:
                digest_json = _llm_synthesize_format_digest(
                    settings,
                    format_key=fmt,
                    client_brief=client_brief,
                    winners_compact=winners_c,
                    losers_compact=losers_c,
                    niche_benchmarks=nb if isinstance(nb, dict) else {},
                )
                if not isinstance(digest_json, dict):
                    digest_json = {}
            except Exception as e:
                logger.warning("format digest LLM failed for %s: %s", fmt, e)
                digest_json = {
                    "one_paragraph_synthesis": f"Format {fmt}: {n} mature reels; LLM synthesis failed.",
                    "hook_patterns": [],
                    "tension_mechanisms": [],
                    "value_delivery_formats": [],
                    "patterns_to_avoid": [],
                    "format_insights": {
                        "dominant_type": fmt,
                        "optimal_duration": "",
                        "engagement_drivers": "",
                    },
                    "performance_summary": str(e)[:200],
                    "top_performer_features": [],
                    "weak_performer_issues": [],
                }
        else:
            digest_json = {
                "one_paragraph_synthesis": (
                    f"Only {n} mature reel(s) in format {fmt}; add more scraped analyses for richer patterns."
                ),
                "hook_patterns": [],
                "tension_mechanisms": [],
                "value_delivery_formats": [],
                "patterns_to_avoid": [],
                "format_insights": {
                    "dominant_type": fmt,
                    "optimal_duration": "",
                    "engagement_drivers": "",
                },
                "performance_summary": "Insufficient mature reels for full synthesis.",
                "top_performer_features": [],
                "weak_performer_issues": [],
            }

        top_ids = []
        for r in winners[:5]:
            m = r.get("_reel_meta") or {}
            top_ids.append(
                {
                    "reel_id": r.get("reel_id"),
                    "analysis_id": r.get("id"),
                    "engagement_rate": m.get("engagement_rate"),
                    "comment_view_ratio": m.get("comment_view_ratio"),
                    "total_score": r.get("total_score"),
                }
            )

        row_db = {
            "client_id": client_id,
            "format_key": fmt,
            "reel_count": len([x for x in enriched if x.get("_format_key") == fmt]),
            "mature_count": n,
            "avg_engagement": round(sum(ers) / len(ers), 4) if ers else None,
            "avg_comment_view_ratio": round(sum(cvrs) / len(cvrs), 4) if cvrs else None,
            "avg_save_rate": round(sum(srs) / len(srs), 4) if srs else None,
            "avg_share_rate": round(sum(shrs) / len(shrs), 4) if shrs else None,
            "avg_duration_s": round(sum(durs) / len(durs)) if durs else None,
            "top_reel_ids": top_ids,
            "digest_json": digest_json,
            "computed_at": now.isoformat(),
        }
        try:
            supabase.table("format_digests").upsert(
                row_db, on_conflict="client_id,format_key"
            ).execute()
            formats_written += 1
        except Exception as e:
            logger.warning("format_digests upsert failed for %s: %s", fmt, e)

    return {"ok": True, "formats_written": formats_written, "mature_formats": len(mature_by_fmt)}


def ensure_format_digests_fresh(
    settings: Settings,
    supabase: Client,
    client_id: str,
    *,
    client_row: Optional[Dict[str, Any]] = None,
) -> None:
    """Recompute digests if stale or missing."""
    if not is_digest_stale(supabase, client_id):
        return
    compute_format_digests(settings, supabase, client_id, client_row=client_row)
