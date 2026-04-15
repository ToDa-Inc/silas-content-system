import logging
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from supabase import Client

from core.cache import cache_delete, cache_get, cache_set
from core.config import Settings, get_settings
from core.database import get_supabase, get_supabase_for_settings
from core.id_generator import generate_job_id
from core.deps import require_org_access, resolve_client_id
from jobs.baseline_scrape import run_baseline_scrape
from jobs.client_auto_profile import run_client_auto_profile
from jobs.competitor_discovery import run_competitor_discovery
from jobs.profile_scrape import run_profile_scrape
from jobs.reel_analyze_url import (
    instagram_reel_url_is_valid,
    run_reel_analyze_bulk,
    run_reel_analyze_url,
)
from models.competitor import (
    CompetitorAddBody,
    CompetitorOut,
    CompetitorPreviewBody,
    DiscoverBody,
    NicheReelScrapeBody,
    ScrapeCompetitorReelsBody,
)
from models.reel import (
    AnalyzeReelBulkBody,
    AnalyzeReelUrlBody,
    MetricPoint,
    ReelAnalysisDetailOut,
    ReelAnalysisOut,
    ReelMetricsListOut,
    ReelMetricsSeriesOut,
    ScrapedReelOut,
    TopicSearchBody,
)
from services.apify import run_keyword_reel_search
from services.instagram_post_url import canonical_instagram_post_url
from services.breakout_recompute import recompute_breakouts_for_client
from services.competitor_manual import add_manual_competitor, preview_manual_competitor
from services.job_queue import (
    fail_abandoned_queued_jobs,
    fail_stale_running_jobs,
    has_active_job,
)
from services.scrape_cycle import (
    enqueue_keyword_reel_similarity_for_client,
    find_stale_competitors,
)
from services.reel_metrics import (
    compute_niche_benchmarks,
    enrich_engagement_metrics,
    normalize_scraped_reel_row_for_api,
)

router = APIRouter(prefix="/api/v1", tags=["intelligence"])
logger = logging.getLogger(__name__)

# Weekly momentum: growth measured over posted_at + [maturity, maturity+measure), using snapshot timestamps
# only to read metrics — not to define the calendar window.
_WEEKLY_GROWTH_MATURITY_DAYS = 7
_WEEKLY_GROWTH_MEASURE_DAYS = 7

# One bulk competitor sync at a time per client (background thread in API process).
_bulk_competitor_sync_locks: dict[str, threading.Lock] = {}


def _ensure_utc(dt: datetime) -> datetime:
    """Postgres / ISO strings often yield naive datetimes; activity compares to UTC-aware `since`."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_since(since: Optional[str]) -> datetime:
    if not since or not since.strip():
        return datetime.now(timezone.utc) - timedelta(hours=24)
    try:
        return _ensure_utc(datetime.fromisoformat(since.replace("Z", "+00:00")))
    except (ValueError, TypeError):
        return datetime.now(timezone.utc) - timedelta(hours=24)


def _dt_from_row(val: Any) -> Optional[datetime]:
    if not val:
        return None
    try:
        return _ensure_utc(datetime.fromisoformat(str(val).replace("Z", "+00:00")))
    except (ValueError, TypeError):
        return None


def _parse_optional_iso8601(raw: Optional[str]) -> Optional[datetime]:
    if not raw or not str(raw).strip():
        return None
    try:
        return _ensure_utc(datetime.fromisoformat(str(raw).strip().replace("Z", "+00:00")))
    except (ValueError, TypeError):
        return None


def _metrics_range_bounds(
    from_iso: Optional[str], to_iso: Optional[str]
) -> tuple[Optional[datetime], Optional[datetime]]:
    a = _parse_optional_iso8601(from_iso)
    b = _parse_optional_iso8601(to_iso)
    if a is not None and b is not None and a > b:
        return b, a
    return a, b


def _rows_to_metric_points(rows: List[dict]) -> List[MetricPoint]:
    out: List[MetricPoint] = []
    for row in rows:
        ts = row.get("scraped_at")
        if ts is None:
            continue
        out.append(
            MetricPoint(
                scraped_at=str(ts),
                views=int(row["views"]) if row.get("views") is not None else None,
                likes=int(row["likes"]) if row.get("likes") is not None else None,
                comments=int(row["comments"]) if row.get("comments") is not None else None,
            )
        )
    return out


def _snapshot_points_for_reels_batch(
    supabase: Client,
    reel_ids: List[str],
    from_dt: Optional[datetime],
    to_dt: Optional[datetime],
) -> Dict[str, List[MetricPoint]]:
    """One round-trip for snapshots on many reels; points per reel ordered by scraped_at ascending."""
    if not reel_ids:
        return {}
    q = (
        supabase.table("reel_snapshots")
        .select("reel_id, scraped_at, views, likes, comments")
        .in_("reel_id", reel_ids)
        .order("reel_id", desc=False)
        .order("scraped_at", desc=False)
    )
    if from_dt is not None:
        q = q.gte("scraped_at", from_dt.isoformat())
    if to_dt is not None:
        q = q.lte("scraped_at", to_dt.isoformat())
    try:
        res = q.execute()
    except Exception:
        return {rid: [] for rid in reel_ids}
    by_reel: Dict[str, List[dict]] = defaultdict(list)
    for row in res.data or []:
        rid = row.get("reel_id")
        if rid is None:
            continue
        by_reel[str(rid)].append(row)
    return {rid: _rows_to_metric_points(by_reel.get(rid, [])) for rid in reel_ids}


def _snapshot_points_for_reel(
    supabase: Client,
    reel_id: str,
    from_dt: Optional[datetime],
    to_dt: Optional[datetime],
) -> List[MetricPoint]:
    m = _snapshot_points_for_reels_batch(supabase, [reel_id], from_dt, to_dt)
    return m.get(reel_id, [])


def _own_reel_metas_batch(
    supabase: Client, client_id: str, reel_ids: List[str]
) -> Dict[str, Dict[str, Any]]:
    if not reel_ids:
        return {}
    rc = (
        supabase.table("scraped_reels")
        .select("id, post_url, thumbnail_url, hook_text")
        .eq("client_id", client_id)
        .is_("competitor_id", "null")
        .in_("id", reel_ids)
        .execute()
    )
    return {str(r["id"]): r for r in (rc.data or [])}


def _own_reel_meta(
    supabase: Client, client_id: str, reel_id: str
) -> Optional[Dict[str, Any]]:
    m = _own_reel_metas_batch(supabase, client_id, [reel_id])
    return m.get(str(reel_id))


def _reel_reference_date(r: dict) -> Optional[datetime]:
    """Prefer post time, then first seen / row created — for rolling window filters (not last sync)."""
    for key in ("posted_at", "first_seen_at", "created_at"):
        dt = _dt_from_row(r.get(key))
        if dt is not None:
            return dt
    return None


def _float_ratio(val: Any) -> float:
    if val is None:
        return 0.0
    try:
        return float(val)
    except (TypeError, ValueError):
        return 0.0


def _normalize_instagram_handle(val: Any) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip().lstrip("@").lower()
    return s or None


def _client_instagram_handle(supabase: Client, client_id: str) -> Optional[str]:
    """Configured creator handle for this client — own reels should match this when set."""
    try:
        res = (
            supabase.table("clients")
            .select("instagram_handle")
            .eq("id", client_id)
            .limit(1)
            .execute()
        )
        if not res.data:
            return None
        return _normalize_instagram_handle((res.data[0] or {}).get("instagram_handle"))
    except Exception:
        return None


def _filter_scraped_rows_to_configured_handle(
    rows: List[dict], configured: Optional[str]
) -> List[dict]:
    if not configured:
        return rows
    out: List[dict] = []
    for r in rows:
        au = _normalize_instagram_handle(r.get("account_username"))
        if au == configured:
            out.append(r)
    return out


def _is_legacy_views_only_row(r: dict) -> bool:
    """Pre multi-metric scrape: is_outlier + outlier_ratio (views) only; per-metric ratios unset."""
    if r.get("is_outlier") is not True:
        return False
    if r.get("outlier_views_ratio") is not None:
        return False
    if r.get("outlier_likes_ratio") is not None or r.get("outlier_comments_ratio") is not None:
        return False
    return True


def _is_views_breakout_row(r: dict) -> bool:
    if r.get("is_outlier_views") is True:
        return True
    return _is_legacy_views_only_row(r)


def _views_breakout_display_key(r: dict) -> Tuple[float, float, str]:
    """Order for API/UI: más → menos on absolute views, then × ratio."""
    if r.get("outlier_views_ratio") is not None:
        ratio = _float_ratio(r.get("outlier_views_ratio"))
    else:
        ratio = _float_ratio(r.get("outlier_ratio"))
    metric = _float_ratio(r.get("views"))
    return (metric, ratio, str(r.get("id") or ""))


def _likes_breakout_display_key(r: dict) -> Tuple[float, float, str]:
    metric = _float_ratio(r.get("likes"))
    ratio = _float_ratio(r.get("outlier_likes_ratio"))
    return (metric, ratio, str(r.get("id") or ""))


def _comments_breakout_display_key(r: dict) -> Tuple[float, float, str]:
    metric = _float_ratio(r.get("comments"))
    ratio = _float_ratio(r.get("outlier_comments_ratio"))
    return (metric, ratio, str(r.get("id") or ""))


def _weekly_breakout_tops(
    rows: List[dict],
    days: int = 7,
    top_n_views: int = 3,
    top_n_likes: int = 3,
    top_n_comments: int = 3,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]], datetime, datetime]:
    """
    Among competitor outlier reels in `rows`, keep those whose reference date is in the last `days`,
    then pick the top N per column by absolute views / likes / comments (tie-breaker: stronger × ratio).
    """
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(days=days)
    pool: List[dict] = []
    for r in rows:
        dt = _reel_reference_date(r)
        if dt is None or dt < window_start:
            continue
        pool.append(r)

    def top_by(
        include: Any,
        sort_key_fn: Any,
        limit: int,
    ) -> List[Dict[str, Any]]:
        if not pool or limit <= 0:
            return []
        sub = [r for r in pool if include(r)]
        sub.sort(key=sort_key_fn, reverse=True)
        return [dict(x) for x in sub[:limit]]

    tv = top_by(
        _is_views_breakout_row,
        _views_breakout_display_key,
        top_n_views,
    )
    tl = top_by(
        lambda r: r.get("is_outlier_likes") is True,
        _likes_breakout_display_key,
        top_n_likes,
    )
    tc = top_by(
        lambda r: r.get("is_outlier_comments") is True,
        _comments_breakout_display_key,
        top_n_comments,
    )
    # Descending: más → menos on the column metric (views / likes / comments), then × ratio.
    tv = sorted(tv, key=_views_breakout_display_key, reverse=True)
    tl = sorted(tl, key=_likes_breakout_display_key, reverse=True)
    tc = sorted(tc, key=_comments_breakout_display_key, reverse=True)
    return tv, tl, tc, window_start, now


def _top_stored_reels_by_metrics(
    supabase: Client,
    client_id: str,
    top_n: int = 3,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Top N reels by raw views, likes, and comments — same catalog as GET /reels (all rows for client_id).
    Attaches Silas analysis summaries when present (same as list_reels with include_analysis).
    """
    def _fetch_ordered(column: str) -> List[dict]:
        res = (
            supabase.table("scraped_reels")
            .select("*")
            .eq("client_id", client_id)
            .order(column, desc=True)
            .limit(top_n)
            .execute()
        )
        return [dict(x) for x in (res.data or [])]

    tv = _fetch_ordered("views")
    tl = _fetch_ordered("likes")
    tc = _fetch_ordered("comments")

    by_id: Dict[str, dict] = {}
    for row in tv + tl + tc:
        rid = str(row.get("id") or "")
        if rid and rid not in by_id:
            by_id[rid] = row

    if by_id:
        try:
            _attach_reel_analyses(supabase, client_id, list(by_id.values()))
        except Exception:
            pass

    return tv, tl, tc


def _chunked_ids(ids: List[str], size: int) -> List[List[str]]:
    return [ids[i : i + size] for i in range(0, len(ids), size)]


def _int_metric_val(val: Any) -> int:
    try:
        return int(val or 0)
    except (TypeError, ValueError):
        return 0


def _snapshots_grouped_by_reel(supabase: Client, reel_ids: List[str]) -> Dict[str, List[dict]]:
    """All snapshot rows per reel_id, unsorted in DB; we sort each list by scraped_at descending in memory."""
    by_reel: Dict[str, List[dict]] = defaultdict(list)
    if not reel_ids:
        return by_reel
    for chunk in _chunked_ids(reel_ids, 80):
        offset = 0
        while True:
            try:
                res = (
                    supabase.table("reel_snapshots")
                    .select("reel_id, views, likes, comments, scraped_at")
                    .in_("reel_id", chunk)
                    .range(offset, offset + 999)
                    .execute()
                )
            except Exception:
                break
            batch = res.data or []
            for row in batch:
                rid = str(row.get("reel_id") or "")
                if rid:
                    by_reel[rid].append(row)
            if len(batch) < 1000:
                break
            offset += 1000
    min_ts = datetime.min.replace(tzinfo=timezone.utc)

    def _snap_key(r: dict) -> datetime:
        t = _dt_from_row(r.get("scraped_at"))
        return t if t is not None else min_ts

    for rid in list(by_reel.keys()):
        by_reel[rid].sort(key=_snap_key, reverse=True)
    return by_reel


def _pick_baseline_snapshot(snaps_desc: List[dict], cutoff: datetime) -> Optional[dict]:
    """
    Prefer the newest snapshot at or before ``cutoff`` (true multi-day growth window).

    If every snapshot is newer than ``cutoff`` (e.g. all syncs in the last week), use the **second-newest**
    snapshot so deltas reflect "since last sync" instead of falling back to all-time absolute ranks.

    If only one snapshot exists, use it (delta vs that scrape).
    """
    if not snaps_desc:
        return None
    for s in snaps_desc:
        t = _dt_from_row(s.get("scraped_at"))
        if t is not None and t <= cutoff:
            return s
    if len(snaps_desc) >= 2:
        return snaps_desc[1]
    return snaps_desc[0]


def _snapshot_newest_at_or_before(snaps_desc: List[dict], deadline: datetime) -> Optional[dict]:
    """Newest snapshot whose scraped_at is still on or before ``deadline``. ``snaps_desc``: scraped_at DESC."""
    for s in snaps_desc:
        t = _dt_from_row(s.get("scraped_at"))
        if t is not None and t <= deadline:
            return s
    return None


def _post_age_window_metric_deltas(
    snaps: List[dict],
    posted: datetime,
    now: datetime,
    *,
    maturity_days: int,
    measure_days: int,
) -> Tuple[Optional[int], Optional[int], Optional[int]]:
    """
    Delta views/likes/comments over [posted+maturity, posted+maturity+measure] (inclusive on both ends).

    Calendar window is defined only from ``posted``; snapshot ``scraped_at`` is used only to choose which
    stored readings fall inside that window (or, if none, to bracket the window — see fallbacks).
    """
    window_start = posted + timedelta(days=maturity_days)
    window_end = posted + timedelta(days=maturity_days + measure_days)
    if now < window_end:
        return None, None, None

    def delta_from_to(a: dict, b: dict) -> Tuple[int, int, int]:
        return (
            _int_metric_val(b.get("views")) - _int_metric_val(a.get("views")),
            _int_metric_val(b.get("likes")) - _int_metric_val(a.get("likes")),
            _int_metric_val(b.get("comments")) - _int_metric_val(a.get("comments")),
        )

    min_ts = datetime.min.replace(tzinfo=timezone.utc)

    def snap_time(s: dict) -> datetime:
        t = _dt_from_row(s.get("scraped_at"))
        return t if t is not None else min_ts

    snaps_desc = sorted(snaps, key=snap_time, reverse=True)

    in_window: List[Tuple[datetime, dict]] = []
    for s in snaps:
        t = _dt_from_row(s.get("scraped_at"))
        if t is not None and window_start <= t <= window_end:
            in_window.append((t, s))
    in_window.sort(key=lambda x: x[0])

    if len(in_window) >= 2:
        _, start_s = in_window[0]
        _, end_s = in_window[-1]
        if in_window[0][0] < in_window[-1][0]:
            gv, gl, gc = delta_from_to(start_s, end_s)
            return gv, gl, gc

    if len(in_window) == 1:
        _, mid_s = in_window[0]
        tm = in_window[0][0]
        pre = _snapshot_newest_at_or_before(snaps_desc, window_start)
        ts_pre = _dt_from_row(pre.get("scraped_at")) if pre else None
        if pre is not None and ts_pre is not None and ts_pre < tm:
            return delta_from_to(pre, mid_s)
        return None, None, None

    # No snapshots inside the measurement week: bracket with last reading on/before each boundary.
    start_snap = _snapshot_newest_at_or_before(snaps_desc, window_start)
    end_snap = _snapshot_newest_at_or_before(snaps_desc, window_end)
    if start_snap is None or end_snap is None:
        return None, None, None
    ts = _dt_from_row(start_snap.get("scraped_at"))
    te = _dt_from_row(end_snap.get("scraped_at"))
    if ts is None or te is None or te <= ts:
        return None, None, None
    return delta_from_to(start_snap, end_snap)


def _top_reels_by_growth(
    supabase: Client,
    client_id: str,
    top_n: int = 3,
    growth_days: int = 7,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    """
    Top N reels per column by views/likes/comments growth in the post-anchored window:
    measure days ``_WEEKLY_GROWTH_MEASURE_DAYS`` starting after ``_WEEKLY_GROWTH_MATURITY_DAYS`` from posted_at.

    Only reels with posted_at and age >= maturity+measure are ranked on growth; others are excluded from
    these columns (not filled from immature reels). Reels old enough but lacking snapshot coverage fall
    back to absolute totals among the eligible pool.

    ``growth_days`` is kept for backward compatibility on the signature; the window is fixed by module constants.
    """
    _ = growth_days
    now = datetime.now(timezone.utc)
    maturity = _WEEKLY_GROWTH_MATURITY_DAYS
    measure = _WEEKLY_GROWTH_MEASURE_DAYS
    min_age = timedelta(days=maturity + measure)

    rows: List[dict] = []
    try:
        res = (
            supabase.table("scraped_reels")
            .select("*")
            .eq("client_id", client_id)
            .execute()
        )
        rows = [dict(x) for x in (res.data or [])]
    except Exception:
        rows = []
    meta: Dict[str, Any] = {
        "scope": "growth_7d_post_age",
        "anchor": "posted_at",
        "maturity_days": maturity,
        "measure_days": measure,
        "min_post_age_days": maturity + measure,
    }
    if not rows:
        return [], [], [], meta

    ids = [str(r.get("id") or "") for r in rows if r.get("id")]
    ids = [i for i in ids if i]

    snapshots_by_reel: Dict[str, List[dict]] = {}
    if ids:
        try:
            snapshots_by_reel = _snapshots_grouped_by_reel(supabase, ids)
        except Exception:
            snapshots_by_reel = {}

    enriched: List[dict] = []
    for r in rows:
        rid = str(r.get("id") or "")
        posted = _dt_from_row(r.get("posted_at")) if rid else None
        snaps = snapshots_by_reel.get(rid, []) if rid else []
        r = dict(r)
        if posted is None or now < posted + min_age:
            r["growth_views"] = None
            r["growth_likes"] = None
            r["growth_comments"] = None
            r["_weekly_growth_eligible"] = False
        else:
            r["_weekly_growth_eligible"] = True
            gv, gl, gc = _post_age_window_metric_deltas(
                snaps,
                posted,
                now,
                maturity_days=maturity,
                measure_days=measure,
            )
            r["growth_views"] = gv
            r["growth_likes"] = gl
            r["growth_comments"] = gc
        enriched.append(r)

    def pick(metric: str, gkey: str) -> List[dict]:
        eligible = [x for x in enriched if x.get("_weekly_growth_eligible")]
        with_g = [x for x in eligible if x.get(gkey) is not None]
        without_g = [x for x in eligible if x.get(gkey) is None]
        with_g.sort(key=lambda x: _int_metric_val(x.get(gkey)), reverse=True)
        without_g.sort(key=lambda x: _int_metric_val(x.get(metric)), reverse=True)
        out: List[dict] = []
        seen: set[str] = set()
        for pool in (with_g, without_g):
            for row in pool:
                if len(out) >= top_n:
                    break
                rid = str(row.get("id") or "")
                if not rid or rid in seen:
                    continue
                seen.add(rid)
                row = dict(row)
                row.pop("_weekly_growth_eligible", None)
                out.append(row)
            if len(out) >= top_n:
                break
        return out[:top_n]

    tv = pick("views", "growth_views")
    tl = pick("likes", "growth_likes")
    tc = pick("comments", "growth_comments")

    tv = [normalize_scraped_reel_row_for_api(enrich_engagement_metrics(dict(x))) for x in tv]
    tl = [normalize_scraped_reel_row_for_api(enrich_engagement_metrics(dict(x))) for x in tl]
    tc = [normalize_scraped_reel_row_for_api(enrich_engagement_metrics(dict(x))) for x in tc]

    by_id: Dict[str, dict] = {}
    for row in tv + tl + tc:
        rid = str(row.get("id") or "")
        if rid and rid not in by_id:
            by_id[rid] = row

    if by_id:
        try:
            _attach_reel_analyses(supabase, client_id, list(by_id.values()))
        except Exception:
            pass

    return tv, tl, tc, meta


def _trending_now_reels(
    supabase: Client,
    client_id: str,
    *,
    posted_within_hours: int = 48,
    min_views_ratio: float = 0.3,
    top_n: int = 8,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Competitor reels posted recently where views / account_avg_views clears a floor (from last sync)."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=posted_within_hours)
    since_iso = since.isoformat()
    rows: List[dict] = []
    try:
        res = (
            supabase.table("scraped_reels")
            .select("*")
            .eq("client_id", client_id)
            .not_.is_("competitor_id", "null")
            .gte("posted_at", since_iso)
            .execute()
        )
        rows = [dict(x) for x in (res.data or [])]
    except Exception:
        rows = []

    enriched: List[dict] = []
    for r in rows:
        posted = _dt_from_row(r.get("posted_at"))
        if posted is None or posted < since:
            continue
        av = _int_metric_val(r.get("account_avg_views"))
        v = _int_metric_val(r.get("views"))
        if av <= 0:
            continue
        ratio = v / float(av)
        if ratio < min_views_ratio:
            continue
        rr = dict(r)
        rr["trending_ratio"] = round(ratio, 4)
        enriched.append(rr)

    enriched.sort(key=lambda x: float(x.get("trending_ratio") or 0), reverse=True)
    top = enriched[:top_n]
    for r in top:
        enrich_engagement_metrics(r)
        normalize_scraped_reel_row_for_api(r)
    if top:
        try:
            _attach_reel_analyses(supabase, client_id, top)
        except Exception:
            pass

    meta: Dict[str, Any] = {
        "scope": "trending_now",
        "posted_within_hours": posted_within_hours,
        "min_views_vs_account_avg": min_views_ratio,
        "window_start": since_iso,
        "window_end": now.isoformat(),
    }
    return top, meta


def _proven_performer_reels(
    supabase: Client,
    client_id: str,
    *,
    min_post_age_days: int = 14,
    top_n: int = 5,
    candidate_limit: int = 200,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Older competitor reels: rank by view growth vs snapshot anchored ~min_post_age_days after post, else by views."""
    now = datetime.now(timezone.utc)
    max_posted_at = now - timedelta(days=min_post_age_days)
    max_posted_iso = max_posted_at.isoformat()
    rows: List[dict] = []
    try:
        res = (
            supabase.table("scraped_reels")
            .select("*")
            .eq("client_id", client_id)
            .not_.is_("competitor_id", "null")
            .lte("posted_at", max_posted_iso)
            .order("views", desc=True)
            .limit(candidate_limit)
            .execute()
        )
        rows = [dict(x) for x in (res.data or [])]
    except Exception:
        rows = []

    ids = [str(r.get("id") or "") for r in rows if r.get("id")]
    ids = [i for i in ids if i]
    snapshots_by_reel: Dict[str, List[dict]] = {}
    if ids:
        try:
            snapshots_by_reel = _snapshots_grouped_by_reel(supabase, ids)
        except Exception:
            snapshots_by_reel = {}

    settle_td = timedelta(days=min_post_age_days)
    with_snap: List[dict] = []
    fallback: List[dict] = []

    for r in rows:
        rid = str(r.get("id") or "")
        posted = _dt_from_row(r.get("posted_at"))
        if posted is None:
            continue
        settle_cutoff = posted + settle_td
        snaps = snapshots_by_reel.get(rid, []) if rid else []
        baseline = _pick_baseline_snapshot(snaps, settle_cutoff) if snaps else None
        current_v = _int_metric_val(r.get("views"))
        rr = dict(r)
        if baseline is not None:
            base_v = _int_metric_val(baseline.get("views"))
            rr["growth_views"] = current_v - base_v
            rr["proven_growth_source"] = "snapshots"
            with_snap.append(rr)
        else:
            rr["growth_views"] = None
            rr["proven_growth_source"] = "raw_views"
            fallback.append(rr)

    with_snap.sort(key=lambda x: _int_metric_val(x.get("growth_views")), reverse=True)
    fallback.sort(key=lambda x: _int_metric_val(x.get("views")), reverse=True)

    out: List[dict] = []
    seen: set[str] = set()
    for pool in (with_snap, fallback):
        for r in pool:
            rid = str(r.get("id") or "")
            if not rid or rid in seen:
                continue
            seen.add(rid)
            out.append(r)
            if len(out) >= top_n:
                break
        if len(out) >= top_n:
            break

    for r in out:
        enrich_engagement_metrics(r)
        normalize_scraped_reel_row_for_api(r)
    if out:
        try:
            _attach_reel_analyses(supabase, client_id, out)
        except Exception:
            pass

    meta: Dict[str, Any] = {
        "scope": "proven_performers",
        "min_post_age_days": min_post_age_days,
        "candidate_limit": candidate_limit,
        "baseline_anchor": f"snapshot at or before ~{min_post_age_days}d after post (falls back to sync-pair if newer)",
        "as_of": now.isoformat(),
    }
    return out, meta


def _compute_client_stats(supabase: Client, client_id: str) -> Dict[str, Any]:
    handle = _client_instagram_handle(supabase, client_id)
    # Count own reels: use a direct COUNT query filtered by handle when available,
    # avoiding the old 800-row in-memory fetch.
    if handle:
        count_res = (
            supabase.table("scraped_reels")
            .select("id", count="exact")
            .eq("client_id", client_id)
            .is_("competitor_id", "null")
            .ilike("account_username", handle)
            .execute()
        )
        total_own = int(count_res.count or 0)
    else:
        count_res = (
            supabase.table("scraped_reels")
            .select("id", count="exact")
            .eq("client_id", client_id)
            .is_("competitor_id", "null")
            .execute()
        )
        total_own = int(count_res.count or 0)
    # Fetch last 30 own reels for averages — filtered server-side by handle when available
    base_q = (
        supabase.table("scraped_reels")
        .select("views, likes, posted_at, account_username")
        .eq("client_id", client_id)
        .is_("competitor_id", "null")
        .order("posted_at", desc=True, nullsfirst=False)
    )
    if handle:
        base_q = base_q.ilike("account_username", handle)
    res = base_q.limit(30).execute()
    window: List[dict] = res.data or []
    n = len(window)
    if n == 0:
        return {
            "average_views_last_30_reels": None,
            "average_likes_last_30_reels": None,
            "total_own_reels": total_own,
            "avg_views_change_vs_prior_week_pct": None,
        }
    views = [int(r.get("views") or 0) for r in window]
    likes = [int(r.get("likes") or 0) for r in window]
    avg_v = round(sum(views) / n) if views else None
    avg_l = round(sum(likes) / n) if likes else None
    return {
        "average_views_last_30_reels": avg_v,
        "average_likes_last_30_reels": avg_l,
        "total_own_reels": total_own,
        "avg_views_change_vs_prior_week_pct": None,
    }


def _group_keyword_reel_items(items: list) -> List[Dict[str, Any]]:
    by_user: dict[str, dict] = defaultdict(lambda: {"reel_urls": [], "keywords": set()})
    for it in items:
        u = str(it.get("user_name") or it.get("username") or "").strip().lower()
        if not u:
            continue
        ru = str(it.get("reel_url") or it.get("url") or "").strip()
        kw = str(it.get("keyword") or "").strip()
        if ru:
            by_user[u]["reel_urls"].append(ru)
        if kw:
            by_user[u]["keywords"].add(kw)
    accounts: List[Dict[str, Any]] = []
    for username, d in sorted(by_user.items(), key=lambda x: -len(x[1]["reel_urls"])):
        accounts.append(
            {
                "username": username,
                "reel_count": len(d["reel_urls"]),
                "sample_urls": d["reel_urls"][:8],
            }
        )
    return accounts


def _coerce_json_weighted_total(val: Any) -> Optional[float]:
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        s = val.strip().strip('"')
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _normalize_silas_rating(val: Any) -> Optional[str]:
    if val is None:
        return None
    if isinstance(val, str):
        t = val.strip()
        return t or None
    return str(val)


def _attach_reel_analyses(supabase: Client, client_id: str, reels: list[dict]) -> None:
    """Merge latest reel_analyses summary onto each scraped_reels row (by reel_id, else post_url)."""
    if not reels:
        return
    select_v2 = (
        "id, reel_id, post_url, total_score, replicability_rating, analyzed_at, prompt_version, "
        "weighted_total:full_analysis_json->weighted_total, silas_rating:full_analysis_json->>rating"
    )
    select_legacy = (
        "id, reel_id, post_url, total_score, replicability_rating, analyzed_at, prompt_version"
    )
    rid_list = sorted({str(r["id"]) for r in reels if r.get("id")})

    def _load_rows(select_cols: str) -> List[dict]:
        seen: set[str] = set()
        out: List[dict] = []
        step = _ANALYSIS_IN_CHUNK
        # Track which reel_ids got a match so we skip their post_url lookup
        matched_reel_ids: set[str] = set()
        for i in range(0, len(rid_list), step):
            chunk = rid_list[i : i + step]
            ares = (
                supabase.table("reel_analyses")
                .select(select_cols)
                .eq("client_id", client_id)
                .in_("reel_id", chunk)
                .execute()
            )
            for row in ares.data or []:
                sid = str(row.get("id", ""))
                if sid and sid not in seen:
                    seen.add(sid)
                    out.append(row)
                    rid = row.get("reel_id")
                    if rid:
                        matched_reel_ids.add(str(rid))
        # Only query by post_url for reels that weren't found by reel_id
        # Build a reduced url_list excluding URLs whose reel_id already matched
        reel_id_to_url = {
            str(r["id"]): str(r.get("post_url") or "").strip()
            for r in reels if r.get("id") and r.get("post_url")
        }
        urls_needing_lookup = [
            url for rid_str, url in reel_id_to_url.items()
            if rid_str not in matched_reel_ids and url
        ]
        # Deduplicate
        urls_needing_lookup = sorted(set(urls_needing_lookup))
        for i in range(0, len(urls_needing_lookup), step):
            chunk = urls_needing_lookup[i : i + step]
            ares = (
                supabase.table("reel_analyses")
                .select(select_cols)
                .eq("client_id", client_id)
                .in_("post_url", chunk)
                .execute()
            )
            for row in ares.data or []:
                sid = str(row.get("id", ""))
                if sid and sid not in seen:
                    seen.add(sid)
                    out.append(row)
        return out

    try:
        rows = _load_rows(select_v2)
    except Exception:
        rows = _load_rows(select_legacy)
    by_reel: Dict[str, dict] = {}
    by_url: Dict[str, dict] = {}
    for a in rows:
        rid = a.get("reel_id")
        if rid:
            by_reel[str(rid)] = a
        pu = a.get("post_url")
        if pu:
            by_url[canonical_instagram_post_url(str(pu))] = a
    for reel in reels:
        rid = reel.get("id")
        pu = canonical_instagram_post_url(str(reel.get("post_url") or ""))
        chosen: Optional[dict] = None
        if rid and str(rid) in by_reel:
            chosen = by_reel[str(rid)]
        elif pu and pu in by_url:
            chosen = by_url[pu]
        if chosen:
            reel["analysis"] = {
                "id": str(chosen["id"]),
                "total_score": chosen.get("total_score"),
                "replicability_rating": chosen.get("replicability_rating"),
                "analyzed_at": chosen.get("analyzed_at"),
                "prompt_version": chosen.get("prompt_version"),
                "weighted_total": _coerce_json_weighted_total(chosen.get("weighted_total")),
                "silas_rating": _normalize_silas_rating(chosen.get("silas_rating")),
            }


def _fail_job(supabase: Client, job_id: str, message: str) -> None:
    supabase.table("background_jobs").update(
        {
            "status": "failed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "error_message": message[:8000],
        }
    ).eq("id", job_id).execute()


def _fetch_job_row(supabase: Client, job_id: str) -> dict:
    res = supabase.table("background_jobs").select("*").eq("id", job_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Job row missing after run")
    return res.data


def _background_reel_analyze(job_id: str) -> None:
    settings = get_settings()
    supabase = get_supabase_for_settings(settings)
    res = supabase.table("background_jobs").select("*").eq("id", job_id).single().execute()
    if not res.data:
        return
    try:
        run_reel_analyze_url(settings, res.data)
    except Exception as e:
        _fail_job(supabase, job_id, str(e))


def _reel_analyze_busy(supabase: Client, client_id: str) -> bool:
    for jt in ("reel_analyze_url", "reel_analyze_bulk"):
        if has_active_job(supabase, client_id=client_id, job_type=jt):
            return True
    return False


def _background_reel_analyze_bulk(job_id: str) -> None:
    settings = get_settings()
    supabase = get_supabase_for_settings(settings)
    res = supabase.table("background_jobs").select("*").eq("id", job_id).single().execute()
    if not res.data:
        return
    try:
        run_reel_analyze_bulk(settings, res.data)
    except Exception as e:
        _fail_job(supabase, job_id, str(e))


@router.post("/clients/{slug}/competitors/preview")
def preview_competitor(
    slug: str,
    body: CompetitorPreviewBody,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Parse handle + duplicate check only (no Apify / LLM)."""
    try:
        return preview_manual_competitor(settings, client_id=client_id, raw_input=body.input)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/clients/{slug}/competitors/add")
def add_competitor_manual(
    slug: str,
    body: CompetitorAddBody,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Insert a minimal competitors row (no scrape)."""
    try:
        return add_manual_competitor(
            settings,
            client_id=client_id,
            raw_input=body.input,
            added_by=body.added_by,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/clients/{slug}/competitors/{competitor_id}/scrape-reels")
def scrape_one_competitor_reels(
    slug: str,
    competitor_id: str,
    body: ScrapeCompetitorReelsBody,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Run profile_scrape for a single competitor (e.g. manually added — no stale-queue filter)."""
    cres = (
        supabase.table("competitors")
        .select("id")
        .eq("id", competitor_id)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not cres.data:
        raise HTTPException(status_code=404, detail="Competitor not found for this client")

    fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="profile_scrape")
    if has_active_job(
        supabase,
        client_id=client_id,
        job_type="profile_scrape",
        payload_match={"competitor_id": competitor_id},
    ):
        raise HTTPException(
            status_code=409,
            detail="A scrape is already running or queued for this competitor",
        )

    job_id = generate_job_id()
    row = {
        "id": job_id,
        "org_id": org_id,
        "client_id": client_id,
        "job_type": "profile_scrape",
        "payload": {
            "competitor_id": competitor_id,
            "results_limit": body.limit,
        },
        "status": "running",
    }
    supabase.table("background_jobs").insert(row).execute()
    job_dict = dict(row)

    try:
        run_profile_scrape(settings, job_dict)
    except Exception as e:
        _fail_job(supabase, job_id, str(e))
        raise HTTPException(status_code=500, detail=str(e)) from e

    job_row = _fetch_job_row(supabase, job_id)
    res = job_row.get("result") or {}
    return {
        "competitor_id": competitor_id,
        "reels_processed": int(res.get("reels_processed") or 0),
        "apify_items": int(res.get("apify_items") or 0),
        "username": res.get("username"),
    }


@router.delete("/clients/{slug}/competitors/{competitor_id}")
def delete_competitor(
    slug: str,
    competitor_id: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    """Remove competitor row and scraped reels for this account (reel_analyses.reel_id SET NULL)."""
    cres = (
        supabase.table("competitors")
        .select("id, username")
        .eq("id", competitor_id)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not cres.data:
        raise HTTPException(status_code=404, detail="Competitor not found for this client")

    supabase.table("scraped_reels").delete().eq("competitor_id", competitor_id).eq("client_id", client_id).execute()

    supabase.table("competitors").delete().eq("id", competitor_id).eq("client_id", client_id).execute()

    return {"ok": True, "deleted_id": competitor_id, "username": (cres.data[0] or {}).get("username")}


@router.get("/clients/{slug}/competitors", response_model=list[CompetitorOut])
def list_competitors(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    limit: int = Query(300, ge=1, le=1000, description="Max competitors to return."),
) -> list[dict]:
    res = (
        supabase.table("competitors")
        .select("*")
        .eq("client_id", client_id)
        .order("composite_score", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


@router.post("/clients/{slug}/competitors/discover")
def discover_competitors(
    slug: str,
    body: DiscoverBody,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="competitor_discovery")
    if has_active_job(supabase, client_id=client_id, job_type="competitor_discovery"):
        raise HTTPException(
            status_code=409,
            detail="A competitor_discovery job is already queued or running for this client",
        )
    payload = {
        "keyword": body.keyword,
        "keywords": body.keywords,
        "keyword_mode": body.keyword_mode,
        "limit": body.limit,
        "threshold": body.threshold,
        "posts_per_account": body.posts_per_account,
    }
    row = {
        "id": generate_job_id(),
        "org_id": org_id,
        "client_id": client_id,
        "job_type": "competitor_discovery",
        "payload": {k: v for k, v in payload.items() if v is not None},
        "status": "running",
    }
    supabase.table("background_jobs").insert(row).execute()
    job_id = row["id"]
    job_dict = dict(row)

    try:
        run_competitor_discovery(settings, job_dict)
    except Exception as e:
        _fail_job(supabase, job_id, str(e))
        raise HTTPException(status_code=500, detail=str(e)) from e

    job_row = _fetch_job_row(supabase, job_id)
    return {
        "job_id": job_id,
        "status": job_row.get("status"),
        "result": job_row.get("result"),
    }


@router.post("/clients/{slug}/niche-reels/scrape")
def enqueue_niche_reel_scrape(
    slug: str,
    body: NicheReelScrapeBody,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Queue keyword-based niche reel discovery; worker writes scraped_reels (source niche_search)."""
    if not settings.apify_api_token:
        raise HTTPException(status_code=503, detail="APIFY_API_TOKEN not configured on API server")

    fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="niche_reel_scrape")
    fail_stale_running_jobs(
        supabase, client_id=client_id, job_type="niche_reel_scrape", max_age_minutes=180
    )
    if has_active_job(supabase, client_id=client_id, job_type="niche_reel_scrape"):
        raise HTTPException(
            status_code=409,
            detail="A niche reel scrape is already queued or running for this client",
        )

    payload = {
        "keyword": body.keyword,
        "keywords": body.keywords,
        "keyword_mode": body.keyword_mode,
        "max_items_per_keyword": body.max_items_per_keyword,
        "max_total_reels": body.max_total_reels,
        "include_hashtags": body.include_hashtags,
        "max_hashtag_queries": body.max_hashtag_queries,
    }
    row = {
        "id": generate_job_id(),
        "org_id": org_id,
        "client_id": client_id,
        "job_type": "niche_reel_scrape",
        "payload": {k: v for k, v in payload.items() if v is not None},
        "status": "queued",
    }
    supabase.table("background_jobs").insert(row).execute()
    return {
        "job_id": row["id"],
        "status": "queued",
        "message": "Niche reel scrape queued — the background worker will fetch and save reels. Poll GET /api/v1/jobs/{job_id}.",
    }


@router.post("/clients/{slug}/auto-profile")
def run_auto_profile(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="client_auto_profile")
    if has_active_job(supabase, client_id=client_id, job_type="client_auto_profile"):
        raise HTTPException(
            status_code=409,
            detail="A client_auto_profile job is already queued or running for this client",
        )
    row = {
        "id": generate_job_id(),
        "org_id": org_id,
        "client_id": client_id,
        "job_type": "client_auto_profile",
        "payload": {},
        "status": "running",
    }
    supabase.table("background_jobs").insert(row).execute()
    job_id = row["id"]
    job_dict = dict(row)
    try:
        run_client_auto_profile(settings, job_dict)
    except Exception as e:
        _fail_job(supabase, job_id, str(e))
        raise HTTPException(status_code=500, detail=str(e)) from e
    job_row = _fetch_job_row(supabase, job_id)
    return {
        "job_id": job_id,
        "status": job_row.get("status"),
        "result": job_row.get("result"),
    }


@router.get("/clients/{slug}/baseline")
def get_baseline(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    res = (
        supabase.table("client_baselines")
        .select("*")
        .eq("client_id", client_id)
        .order("scraped_at", desc=True)
        .limit(10)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="No baseline yet")
    now = datetime.now(timezone.utc)
    for row in res.data:
        exp = row.get("expires_at")
        if not exp:
            return row
        try:
            exp_dt = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
            if exp_dt > now:
                return row
        except (ValueError, TypeError):
            return row
    return res.data[0]


@router.post("/clients/{slug}/baseline/refresh")
def refresh_baseline(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Legacy — same as POST …/sync/own."""
    return _run_baseline_refresh(
        org_id=org_id, client_id=client_id, supabase=supabase, settings=settings
    )


def _run_baseline_refresh(
    *,
    org_id: str,
    client_id: str,
    supabase: Client,
    settings: Settings,
) -> Dict[str, Any]:
    fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="baseline_scrape")
    if has_active_job(supabase, client_id=client_id, job_type="baseline_scrape"):
        raise HTTPException(
            status_code=409,
            detail="A sync for your reels is already running — please wait.",
        )
    row = {
        "id": generate_job_id(),
        "org_id": org_id,
        "client_id": client_id,
        "job_type": "baseline_scrape",
        "payload": {},
        "status": "running",
    }
    supabase.table("background_jobs").insert(row).execute()
    job_id = row["id"]
    job_dict = dict(row)
    try:
        run_baseline_scrape(settings, job_dict)
    except Exception as e:
        _fail_job(supabase, job_id, str(e))
        raise HTTPException(status_code=500, detail=str(e)) from e
    job_row = _fetch_job_row(supabase, job_id)
    return {
        "job_id": job_id,
        "status": job_row.get("status"),
        "result": job_row.get("result"),
    }


def _competitor_scrape_background_worker(
    *,
    settings: Settings,
    org_id: str,
    client_id: str,
    competitor_ids: List[str],
    results_limit: int,
    lock: threading.Lock,
) -> None:
    """Runs after HTTP response: Apify scrapes sequentially (uses client outlier threshold, e.g. 5×)."""
    try:
        supabase = get_supabase_for_settings(settings)
        fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="profile_scrape")
        fail_stale_running_jobs(supabase, client_id=client_id, job_type="profile_scrape")
        for comp_id in competitor_ids:
            if has_active_job(
                supabase,
                client_id=client_id,
                job_type="profile_scrape",
                payload_match={"competitor_id": comp_id},
            ):
                continue
            job_id = generate_job_id()
            row = {
                "id": job_id,
                "org_id": org_id,
                "client_id": client_id,
                "job_type": "profile_scrape",
                "payload": {"competitor_id": comp_id, "results_limit": results_limit},
                "status": "running",
            }
            supabase.table("background_jobs").insert(row).execute()
            job_dict = dict(row)
            try:
                run_profile_scrape(settings, job_dict)
            except Exception as e:
                logger.exception("profile_scrape failed for competitor %s", comp_id)
                _fail_job(supabase, job_id, str(e))
    finally:
        lock.release()


def _try_start_competitor_scrapes_background(
    *,
    settings: Settings,
    org_id: str,
    client_id: str,
    supabase: Client,
    results_limit: int = 30,
) -> Optional[Dict[str, Any]]:
    """
    Spawn a daemon thread to run all competitor profile scrapes without blocking the request.
    Returns None if another bulk sync is already running for this client (caller: 409 or skip).
    """
    cres = (
        supabase.table("competitors")
        .select("id")
        .eq("client_id", client_id)
        .execute()
    )
    competitor_ids = [str(r["id"]) for r in (cres.data or [])]
    if not competitor_ids:
        return {
            "mode": "background",
            "competitors_attempted": 0,
            "reels_processed": 0,
            "message": "No competitors to sync.",
            "details": [],
        }

    lock = _bulk_competitor_sync_locks.setdefault(client_id, threading.Lock())
    if not lock.acquire(blocking=False):
        return None

    thread = threading.Thread(
        target=_competitor_scrape_background_worker,
        kwargs={
            "settings": settings,
            "org_id": org_id,
            "client_id": client_id,
            "competitor_ids": competitor_ids,
            "results_limit": results_limit,
            "lock": lock,
        },
        daemon=True,
        name="competitor-scrape-sync",
    )
    try:
        thread.start()
    except RuntimeError:
        lock.release()
        raise

    return {
        "mode": "background",
        "competitors_attempted": len(competitor_ids),
        # Not known until the background thread finishes; avoid misleading 0 in JSON.
        "reels_processed": None,
        "message": (
            "Competitor scrapes started on this API server (no separate worker needed). "
            "Refresh in a few minutes for updated reels and breakout flags."
        ),
        "details": [],
    }


@router.post("/clients/{slug}/sync/own")
def sync_own_reels(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Sync only your Instagram reels (same as legacy baseline/refresh)."""
    return _run_baseline_refresh(
        org_id=org_id, client_id=client_id, supabase=supabase, settings=settings
    )


@router.post("/clients/{slug}/sync/competitors")
def sync_competitor_reels_all(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Start competitor scrapes in a background thread on this API process; returns immediately."""
    if not settings.apify_api_token:
        raise HTTPException(status_code=503, detail="APIFY_API_TOKEN not configured")
    out = _try_start_competitor_scrapes_background(
        settings=settings,
        org_id=org_id,
        client_id=client_id,
        supabase=supabase,
        results_limit=30,
    )
    if out is None:
        raise HTTPException(
            status_code=409,
            detail="A competitor sync is already running for this client — wait for it to finish.",
        )
    return out


@router.post("/clients/{slug}/recompute-breakouts")
def recompute_client_breakouts(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    """Refresh breakout flags from reels already in DB (no Apify / Instagram fetch)."""
    _ = org_id
    out = recompute_breakouts_for_client(supabase, client_id=client_id)
    if out.get("error") == "client_not_found":
        raise HTTPException(status_code=404, detail="Client not found")
    return out


@router.post("/clients/{slug}/sync")
def sync_all(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Sync your reels, then every competitor's reels. See docs/INTELLIGENCE-GUIDE.md."""
    if not settings.apify_api_token:
        raise HTTPException(status_code=503, detail="APIFY_API_TOKEN not configured")
    baseline: Optional[Dict[str, Any]] = None
    try:
        baseline = _run_baseline_refresh(
            org_id=org_id, client_id=client_id, supabase=supabase, settings=settings
        )
    except HTTPException as e:
        if e.status_code == 409:
            raise
        if e.status_code == 500:
            baseline = {"error": str(e.detail)}
        else:
            raise
    except Exception as e:
        baseline = {"error": str(e)[:800]}

    comp_sync = _try_start_competitor_scrapes_background(
        settings=settings,
        org_id=org_id,
        client_id=client_id,
        supabase=supabase,
        results_limit=30,
    )
    if comp_sync is None:
        comp_sync = {
            "mode": "skipped_locked",
            "competitors_attempted": 0,
            "reels_processed": 0,
            "message": "Competitor bulk sync already running — skipped duplicate start.",
            "details": [],
        }
    return {
        "baseline": baseline,
        "competitors_attempted": comp_sync["competitors_attempted"],
        "competitor_reels_processed": comp_sync.get("reels_processed"),
        "competitor_sync_mode": comp_sync.get("mode"),
        "competitor_details": comp_sync.get("details") or [],
        "competitor_sync_message": comp_sync.get("message"),
    }


@router.get("/clients/{slug}/stats")
def get_intelligence_stats(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    """Summary stats for your own reels (averages over last up to 30 stored reels)."""
    return _compute_client_stats(supabase, client_id)


@router.get("/clients/{slug}/stats/outlier-count")
def get_outlier_count(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    """Cheap count of competitor reels marked as outliers. Used by Intelligence page teaser card."""
    try:
        res = (
            supabase.table("scraped_reels")
            .select("id", count="exact")
            .eq("client_id", client_id)
            .eq("is_outlier", True)
            .not_.is_("competitor_id", "null")
            .execute()
        )
        return {"count": int(res.count or 0)}
    except Exception:
        return {"count": 0}


@router.get("/clients/{slug}/activity")
def get_intelligence_activity(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    since: Optional[str] = Query(
        None,
        description="Deprecated for weekly momentum; still affects response `since` echo.",
    ),
) -> Dict[str, Any]:
    """Weekly momentum: growth in days 7–14 after posted_at (snapshot-backed); plus own-reel highlights."""
    since_dt = _parse_since(since)

    # --- Cache check (3-minute TTL per client) ---
    _cache_key = f"activity:{client_id}"
    cached = cache_get(_cache_key, ttl_seconds=180)
    if cached is not None:
        # Update the `since` echo to match the current request but return cached data
        result = dict(cached)
        result["since"] = since_dt.isoformat()
        return result

    window_end = datetime.now(timezone.utc)

    # --- Parallel execution of the three independent heavy calls ---
    # _top_reels_by_growth, _trending_now_reels, _proven_performer_reels, and
    # compute_niche_benchmarks have no data dependencies on each other.
    # Run them concurrently via ThreadPoolExecutor.
    tv: List[Dict[str, Any]] = []
    tl: List[Dict[str, Any]] = []
    tc: List[Dict[str, Any]] = []
    growth_meta: Dict[str, Any] = {}
    niche_benchmarks: Dict[str, Any] = {}
    trend_reels: List[Dict[str, Any]] = []
    trend_meta: Dict[str, Any] = {}
    proven_reels: List[Dict[str, Any]] = []
    proven_meta: Dict[str, Any] = {}

    def _run_top_growth() -> Tuple[List, List, List, Dict]:
        return _top_reels_by_growth(supabase, client_id, top_n=3, growth_days=7)

    def _run_benchmarks() -> Dict:
        return compute_niche_benchmarks(supabase, client_id)

    def _run_trending() -> Tuple[List, Dict]:
        return _trending_now_reels(supabase, client_id)

    def _run_proven() -> Tuple[List, Dict]:
        return _proven_performer_reels(supabase, client_id)

    with ThreadPoolExecutor(max_workers=4) as executor:
        f_growth    = executor.submit(_run_top_growth)
        f_benchmarks = executor.submit(_run_benchmarks)
        f_trending  = executor.submit(_run_trending)
        f_proven    = executor.submit(_run_proven)

        try:
            tv, tl, tc, growth_meta = f_growth.result()
        except Exception:
            growth_meta = {"scope": "growth_7d_post_age"}

        try:
            niche_benchmarks = f_benchmarks.result()
        except Exception:
            niche_benchmarks = {}

        try:
            trend_reels, trend_meta = f_trending.result()
        except Exception:
            trend_reels, trend_meta = [], {"scope": "trending_now", "error": "compute_failed"}

        try:
            proven_reels, proven_meta = f_proven.result()
        except Exception:
            proven_reels, proven_meta = [], {"scope": "proven_performers", "error": "compute_failed"}

    # --- Own-reel growth (sequential — depends on nothing above, kept simple) ---
    growth: List[Dict[str, Any]] = []
    try:
        ig_handle = _client_instagram_handle(supabase, client_id)
        own_cap = 120 if ig_handle else 40
        own = (
            supabase.table("scraped_reels")
            .select("id, account_username")
            .eq("client_id", client_id)
            .is_("competitor_id", "null")
            .order("posted_at", desc=True, nullsfirst=False)
            .limit(own_cap)
            .execute()
        )
        own_rows = _filter_scraped_rows_to_configured_handle(own.data or [], ig_handle)
        own_ids = [str(x["id"]) for x in own_rows][:20]
        if own_ids:
            snap_all = (
                supabase.table("reel_snapshots")
                .select("reel_id, views, scraped_at")
                .in_("reel_id", own_ids)
                .execute()
            )
            srows_all = snap_all.data or []
            latest_two: Dict[str, List[dict]] = defaultdict(list)
            for row in sorted(
                srows_all,
                key=lambda r: str(r.get("scraped_at") or ""),
                reverse=True,
            ):
                rid = str(row.get("reel_id") or "")
                if not rid or len(latest_two[rid]) >= 2:
                    continue
                latest_two[rid].append(row)
            for rid, srows in latest_two.items():
                if len(srows) < 2:
                    continue
                v_new = int(srows[0].get("views") or 0)
                v_old = int(srows[1].get("views") or 0)
                gained = v_new - v_old
                if gained > 0:
                    growth.append(
                        {
                            "reel_id": rid,
                            "views_gained": gained,
                            "views_now": v_new,
                        }
                    )
        growth.sort(key=lambda x: -x["views_gained"])
        growth = growth[:5]
        if growth:
            try:
                gids = [g["reel_id"] for g in growth]
                rres = (
                    supabase.table("scraped_reels")
                    .select(
                        "id, post_url, thumbnail_url, hook_text, caption, account_username, "
                        "views, likes, comments"
                    )
                    .eq("client_id", client_id)
                    .in_("id", gids)
                    .execute()
                )
                by_id = {str(r["id"]): r for r in (rres.data or [])}
                for g in growth:
                    meta = by_id.get(str(g["reel_id"]))
                    if not meta:
                        continue
                    g["post_url"] = meta.get("post_url")
                    g["thumbnail_url"] = meta.get("thumbnail_url")
                    g["hook_text"] = meta.get("hook_text")
                    g["caption"] = meta.get("caption")
                    g["account_username"] = meta.get("account_username")
                    g["likes"] = meta.get("likes")
                    g["comments"] = meta.get("comments")
            except Exception:
                pass
    except Exception:
        growth = []

    has_weekly = bool(tv or tl or tc)
    has_lanes = bool(trend_reels or proven_reels)
    is_quiet = not has_weekly and len(growth) == 0 and not has_lanes

    result = {
        "since": since_dt.isoformat(),
        "new_breakout_reels": [],
        "niche_benchmarks": niche_benchmarks,
        "trending_now": {"meta": trend_meta, "reels": trend_reels},
        "proven_performers": {"meta": proven_meta, "reels": proven_reels},
        "week_breakouts": {
            "scope": growth_meta.get("scope", "growth_7d_post_age"),
            "anchor": growth_meta.get("anchor", "posted_at"),
            "maturity_days": growth_meta.get("maturity_days", _WEEKLY_GROWTH_MATURITY_DAYS),
            "measure_days": growth_meta.get("measure_days", _WEEKLY_GROWTH_MEASURE_DAYS),
            "min_post_age_days": growth_meta.get("min_post_age_days"),
            "window_start": None,
            "window_end": window_end.isoformat(),
            "days": growth_meta.get("measure_days", _WEEKLY_GROWTH_MEASURE_DAYS),
            "top_n_by_type": {"views": 3, "likes": 3, "comments": 3},
            "top_by_views": tv,
            "top_by_likes": tl,
            "top_by_comments": tc,
        },
        "own_reel_growth": growth,
        "is_quiet": is_quiet,
    }

    # --- Store in cache ---
    cache_set(_cache_key, result)
    return result


@router.post("/clients/{slug}/search/topics")
def search_topic_reels(
    slug: str,
    body: TopicSearchBody,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Keyword reel search — accounts grouped by frequency. No metrics until user adds competitor."""
    _ = org_id
    _ = client_id
    if not settings.apify_api_token:
        raise HTTPException(status_code=503, detail="APIFY_API_TOKEN not configured")
    items = run_keyword_reel_search(
        settings.apify_api_token,
        body.keyword.strip(),
        max_items=body.max_items,
    )
    accounts = _group_keyword_reel_items(items)
    return {
        "keyword": body.keyword.strip(),
        "total_items": len(items),
        "accounts": accounts,
    }


@router.post("/clients/{slug}/reels/analyze-url")
def analyze_reel_by_url(
    slug: str,
    body: AnalyzeReelUrlBody,
    background_tasks: BackgroundTasks,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Enqueue Apify URL scrape + OpenRouter Gemini analysis; poll GET /api/v1/jobs/{job_id}."""
    if not instagram_reel_url_is_valid(body.url):
        raise HTTPException(status_code=400, detail="Invalid Instagram reel or post URL")
    if not settings.openrouter_api_key:
        raise HTTPException(
            status_code=503,
            detail="Reel analysis requires OPENROUTER_API_KEY",
        )
    if not body.skip_apify and not settings.apify_api_token:
        raise HTTPException(
            status_code=503,
            detail="Full reel analysis requires APIFY_API_TOKEN (or set skip_apify for LLM-only re-run)",
        )
    fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="reel_analyze_url")
    if _reel_analyze_busy(supabase, client_id):
        raise HTTPException(
            status_code=409,
            detail="A reel analysis is already running or queued for this client",
        )
    job_id = generate_job_id()
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "id": job_id,
        "org_id": org_id,
        "client_id": client_id,
        "job_type": "reel_analyze_url",
        "payload": {"url": body.url.strip(), "skip_apify": body.skip_apify},
        "status": "running",
        "started_at": now,
    }
    supabase.table("background_jobs").insert(row).execute()
    background_tasks.add_task(_background_reel_analyze, job_id)
    return {"job_id": job_id, "status": "queued"}


@router.post("/clients/{slug}/reels/analyze-bulk")
def analyze_reels_bulk(
    slug: str,
    body: AnalyzeReelBulkBody,
    background_tasks: BackgroundTasks,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Enqueue sequential URL analyses (same pipeline as analyze-url). Poll GET /api/v1/jobs/{job_id}."""
    if not settings.openrouter_api_key:
        raise HTTPException(
            status_code=503,
            detail="Reel analysis requires OPENROUTER_API_KEY",
        )
    if not body.skip_apify and not settings.apify_api_token:
        raise HTTPException(
            status_code=503,
            detail="Bulk reel analysis requires APIFY_API_TOKEN (or skip_apify for LLM-only)",
        )
    cleaned: list[str] = []
    for u in body.urls:
        s = str(u).strip()
        if not s:
            continue
        if not instagram_reel_url_is_valid(s):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid Instagram reel or post URL: {s[:80]}",
            )
        cleaned.append(s)
    if not cleaned:
        raise HTTPException(status_code=400, detail="No valid URLs in request")

    fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="reel_analyze_bulk")
    if _reel_analyze_busy(supabase, client_id):
        raise HTTPException(
            status_code=409,
            detail="A reel analysis is already running or queued for this client",
        )

    job_id = generate_job_id()
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "id": job_id,
        "org_id": org_id,
        "client_id": client_id,
        "job_type": "reel_analyze_bulk",
        "payload": {"urls": cleaned, "skip_apify": body.skip_apify},
        "status": "running",
        "started_at": now,
    }
    supabase.table("background_jobs").insert(row).execute()
    background_tasks.add_task(_background_reel_analyze_bulk, job_id)
    return {"job_id": job_id, "status": "queued", "count": len(cleaned)}


@router.get("/clients/{slug}/reels/active-analysis")
def get_active_reel_analysis_job(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    """Running or queued Silas reel job so the UI can resume polling after reload."""
    res = (
        supabase.table("background_jobs")
        .select("id, job_type, status, started_at")
        .eq("client_id", client_id)
        .in_("job_type", ["reel_analyze_url", "reel_analyze_bulk"])
        .in_("status", ["queued", "running"])
        .order("started_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return {"active": False}
    row = rows[0]
    return {
        "active": True,
        "job_id": row["id"],
        "job_type": row["job_type"],
        "status": row.get("status"),
        "started_at": row.get("started_at"),
    }


@router.get("/clients/{slug}/reel-analyses", response_model=list[ReelAnalysisOut])
def list_client_reel_analyses(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    limit: int = Query(20, ge=1, le=100),
) -> list[dict]:
    """Saved Silas analyses (linked to scraped_reels via reel_id). Requires sql/phase2_reel_analyses.sql."""
    select_v2 = (
        "id, client_id, reel_id, analysis_job_id, source, post_url, owner_username, "
        "instant_hook_score, relatability_score, cognitive_tension_score, clear_value_score, "
        "comment_trigger_score, total_score, replicability_rating, model_used, prompt_version, "
        "video_analyzed, analyzed_at, created_at, "
        "weighted_total:full_analysis_json->weighted_total, silas_rating:full_analysis_json->>rating"
    )
    select_legacy = (
        "id, client_id, reel_id, analysis_job_id, source, post_url, owner_username, "
        "instant_hook_score, relatability_score, cognitive_tension_score, clear_value_score, "
        "comment_trigger_score, total_score, replicability_rating, model_used, prompt_version, "
        "video_analyzed, analyzed_at, created_at"
    )
    try:
        res = (
            supabase.table("reel_analyses")
            .select(select_v2)
            .eq("client_id", client_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception:
        res = (
            supabase.table("reel_analyses")
            .select(select_legacy)
            .eq("client_id", client_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    rows = res.data or []
    for row in rows:
        row["weighted_total"] = _coerce_json_weighted_total(row.get("weighted_total"))
        row["silas_rating"] = _normalize_silas_rating(row.get("silas_rating"))
    return rows


@router.post("/clients/{slug}/reels/niche-discovery/run")
def run_niche_discovery_job(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Enqueue keyword_reel_similarity (Sasky + instagram-scraper + video similarity). Worker runs it."""
    if not settings.apify_api_token or not settings.openrouter_api_key:
        raise HTTPException(
            status_code=503,
            detail="Niche discovery requires APIFY_API_TOKEN and OPENROUTER_API_KEY",
        )
    fail_abandoned_queued_jobs(supabase, client_id=client_id, job_type="keyword_reel_similarity")
    stats = enqueue_keyword_reel_similarity_for_client(
        supabase, org_id=org_id, client_id=client_id
    )
    if stats.get("skipped"):
        raise HTTPException(
            status_code=409,
            detail="A keyword_reel_similarity job is already queued or running for this client",
        )
    job_id = stats.get("job_id")
    if not job_id:
        raise HTTPException(status_code=500, detail="Failed to enqueue niche discovery job")
    return {
        "job_id": job_id,
        "status": "queued",
        "message": "Poll GET /api/v1/jobs/{job_id}; list results at GET …/reels/niche-discovery when complete.",
    }


@router.get("/clients/{slug}/reels/niche-discovery", response_model=list[ScrapedReelOut])
def list_niche_discovery_reels(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    limit: int = Query(40, ge=1, le=100),
) -> list[dict]:
    """Reels found via keyword search + similarity scoring (source=keyword_similarity)."""
    res = (
        supabase.table("scraped_reels")
        .select("*")
        .eq("client_id", client_id)
        .eq("source", "keyword_similarity")
        .order("similarity_score", desc=True)
        .limit(limit)
        .execute()
    )
    data = res.data or []
    for row in data:
        enrich_engagement_metrics(row)
        normalize_scraped_reel_row_for_api(row)
    return data


@router.get("/clients/{slug}/reels", response_model=list[ScrapedReelOut])
def list_reels(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    outlier_only: bool = Query(False),
    own_reels_only: bool = Query(
        False,
        description="Only reels scraped from the client's own profile (competitor_id IS NULL).",
    ),
    include_analysis: bool = Query(
        False,
        description="Attach Silas analysis summary (id, score, rating) when a reel_analyses row exists.",
    ),
    limit: int = Query(
        50,
        ge=1,
        le=500,
        description="Max reels to return. Defaults to 50 (most recent by posted_at).",
    ),
    sort_by: str = Query(
        "posted_at",
        description="Sort field: posted_at (default), views, outlier_ratio.",
    ),
) -> list[dict]:
    q = supabase.table("scraped_reels").select("*").eq("client_id", client_id)
    if own_reels_only:
        q = q.is_("competitor_id", "null")
    if outlier_only:
        q = q.eq("is_outlier", True)
    # Sort order: posted_at desc by default so newest reels come first
    _sort_col = sort_by if sort_by in ("posted_at", "views", "outlier_ratio") else "posted_at"
    res = q.order(_sort_col, desc=True, nullsfirst=False).limit(limit).execute()
    data = res.data or []
    for row in data:
        enrich_engagement_metrics(row)
        normalize_scraped_reel_row_for_api(row)
    if include_analysis and data:
        try:
            _attach_reel_analyses(supabase, client_id, data)
        except Exception:
            # Table missing or RLS — return reels without analysis
            pass
    return data


@router.get("/clients/{slug}/reels/adapt-preview", response_model=list[ScrapedReelOut])
def adapt_preview_reels(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    limit: int = Query(5, ge=1, le=20, description="How many reels to return after ranking."),
    pool: int = Query(
        250,
        ge=50,
        le=500,
        description="Max competitor reels to load from DB before sorting (by views desc).",
    ),
    min_views: int = Query(
        100,
        ge=0,
        le=10_000_000,
        description="Only rank reels with at least this many views (stabilizes views/comments).",
    ),
) -> list[dict]:
    """
    Top competitor reels by views ÷ comments for Generate → URL adapt.

    Lower ratio = more comments per view (stronger discussion). Excludes the client's own
    profile reels (competitor_id must be set). Thumbnails + metrics only.
    """
    _ = slug
    try:
        q = (
            supabase.table("scraped_reels")
            .select("*")
            .eq("client_id", client_id)
            .not_.is_("competitor_id", "null")
        )
        if min_views > 0:
            q = q.gte("views", min_views)
        res = q.order("views", desc=True).limit(pool).execute()
    except Exception as e:
        logger.warning("adapt_preview_reels: fetch failed: %s", e)
        return []

    rows: List[dict] = [dict(x) for x in (res.data or [])]
    for row in rows:
        enrich_engagement_metrics(row)
        normalize_scraped_reel_row_for_api(row)

    def _cvr_sort_key(r: dict) -> float:
        v = r.get("comment_view_ratio")
        if v is None:
            return float("inf")
        try:
            return float(v)
        except (TypeError, ValueError):
            return float("inf")

    rows.sort(key=_cvr_sort_key, reverse=False)
    return rows[:limit]


# ---------------------------------------------------------------------------
# Replicate suggestions — outbreakers vs milestone-based account average
# ---------------------------------------------------------------------------

_MILESTONE_HOURS = (24, 48, 72)


def _pick_milestone_avg(comp: dict, hours: int) -> Optional[float]:
    """Select the best milestone average for a given hours param.

    Tries the exact match first (e.g. hours=48 → avg_views_at_48h), then falls
    back to smaller milestones (24h), then to None.
    """
    candidates = sorted(
        (h for h in _MILESTONE_HOURS if h <= hours), reverse=True
    ) or list(_MILESTONE_HOURS)
    for h in candidates:
        col = f"avg_views_at_{h}h"
        sampled_col = f"sampled_at_{h}h"
        val = comp.get(col)
        sampled = int(comp.get(sampled_col) or 0)
        if val is not None and float(val) > 0 and sampled >= 3:
            return float(val)
    return None


@router.get("/clients/{slug}/reels/replicate-suggestions", response_model=list[ScrapedReelOut])
def replicate_suggestions(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    hours: int = Query(24, ge=1, le=168, description="How far back to look for recently posted reels."),
    limit: int = Query(8, ge=1, le=30, description="Max reels to return."),
) -> list[dict]:
    """
    Competitor reels posted in the last *hours* ranked by outbreaker ratio.

    Ratio = reel's current views / competitor's avg views at the matching
    milestone (24h/48h/72h).  Falls back to account_avg_views when milestone
    data is insufficient.
    """
    _ = slug
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=hours)
    since_iso = since.isoformat()

    try:
        reel_res = (
            supabase.table("scraped_reels")
            .select("*")
            .eq("client_id", client_id)
            .not_.is_("competitor_id", "null")
            .gte("posted_at", since_iso)
            .execute()
        )
    except Exception as e:
        logger.warning("replicate_suggestions: reel fetch failed: %s", e)
        return []

    rows: List[dict] = [dict(x) for x in (reel_res.data or [])]
    if not rows:
        return []

    comp_ids = list({str(r["competitor_id"]) for r in rows if r.get("competitor_id")})
    comp_map: Dict[str, Dict[str, Any]] = {}
    if comp_ids:
        milestone_cols = ", ".join(
            f"avg_views_at_{h}h, avg_comments_at_{h}h, sampled_at_{h}h"
            for h in _MILESTONE_HOURS
        )
        try:
            cres = (
                supabase.table("competitors")
                .select(f"id, avg_views, {milestone_cols}")
                .in_("id", comp_ids)
                .execute()
            )
            for c in cres.data or []:
                comp_map[str(c["id"])] = c
        except Exception:
            pass

    enriched: List[dict] = []
    for r in rows:
        posted = _dt_from_row(r.get("posted_at"))
        if posted is None or posted < since:
            continue
        v = _int_metric_val(r.get("views"))
        if v <= 0:
            continue

        cid = str(r.get("competitor_id") or "")
        comp = comp_map.get(cid, {})
        milestone_avg = _pick_milestone_avg(comp, hours)

        if milestone_avg is not None:
            ratio = round(v / milestone_avg, 4)
            ratio_source = "milestone_avg"
        else:
            fallback = _int_metric_val(r.get("account_avg_views"))
            if fallback <= 0:
                continue
            ratio = round(v / float(fallback), 4)
            ratio_source = "account_avg_fallback"

        rr = dict(r)
        rr["outbreaker_ratio"] = ratio
        rr["outbreaker_ratio_source"] = ratio_source
        enriched.append(rr)

    enriched.sort(key=lambda x: float(x.get("outbreaker_ratio") or 0), reverse=True)
    top = enriched[:limit]
    for r in top:
        enrich_engagement_metrics(r)
        normalize_scraped_reel_row_for_api(r)
    if top:
        try:
            _attach_reel_analyses(supabase, client_id, top)
        except Exception:
            pass
    return top


_METRICS_MAX_REEL_IDS = 10
_METRICS_DEFAULT_OWN_LIMIT = 30
_ANALYSIS_IN_CHUNK = 80


@router.get("/clients/{slug}/reels/metrics", response_model=ReelMetricsListOut)
def list_own_reels_metrics(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    reel_ids: Optional[str] = Query(
        None,
        description="Comma-separated reel ids (max 10). Omit to use up to 30 own reels by posted_at.",
    ),
    from_: Optional[str] = Query(None, alias="from", description="ISO8601 lower bound on scraped_at"),
    to: Optional[str] = Query(None, description="ISO8601 upper bound on scraped_at"),
) -> ReelMetricsListOut:
    """Snapshot time series for own reels (competitor_id NULL) — dashboard / compare charts."""
    from_dt, to_dt = _metrics_range_bounds(from_, to)
    target_ids: List[str] = []
    if reel_ids and reel_ids.strip():
        seen: set[str] = set()
        for part in reel_ids.split(","):
            s = part.strip()
            if s and s not in seen:
                seen.add(s)
                target_ids.append(s)
        if len(target_ids) > _METRICS_MAX_REEL_IDS:
            raise HTTPException(
                status_code=400,
                detail=f"reel_ids accepts at most {_METRICS_MAX_REEL_IDS} reel ids",
            )
    else:
        ig_handle = _client_instagram_handle(supabase, client_id)
        fetch_n = _METRICS_DEFAULT_OWN_LIMIT * 4 if ig_handle else _METRICS_DEFAULT_OWN_LIMIT
        own = (
            supabase.table("scraped_reels")
            .select("id, account_username")
            .eq("client_id", client_id)
            .is_("competitor_id", "null")
            .order("posted_at", desc=True)
            .limit(fetch_n)
            .execute()
        )
        filtered = _filter_scraped_rows_to_configured_handle(own.data or [], ig_handle)
        target_ids = [str(x["id"]) for x in filtered[:_METRICS_DEFAULT_OWN_LIMIT]]

    metas = _own_reel_metas_batch(supabase, client_id, target_ids)
    snap_ids = list(metas.keys())
    points_by = _snapshot_points_for_reels_batch(supabase, snap_ids, from_dt, to_dt)
    series: List[ReelMetricsSeriesOut] = []
    for rid in target_ids:
        meta = metas.get(str(rid))
        if not meta:
            continue
        points = points_by.get(str(rid), [])
        series.append(
            ReelMetricsSeriesOut(
                reel_id=str(meta["id"]),
                post_url=meta.get("post_url"),
                thumbnail_url=meta.get("thumbnail_url"),
                hook_text=meta.get("hook_text"),
                points=points,
            )
        )
    return ReelMetricsListOut(reels=series)


@router.get("/clients/{slug}/reels/{reel_id}/metrics", response_model=ReelMetricsSeriesOut)
def get_own_reel_metrics(
    slug: str,
    reel_id: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    from_: Optional[str] = Query(None, alias="from", description="ISO8601 lower bound on scraped_at"),
    to: Optional[str] = Query(None, description="ISO8601 upper bound on scraped_at"),
) -> ReelMetricsSeriesOut:
    """Snapshot time series for one own reel."""
    from_dt, to_dt = _metrics_range_bounds(from_, to)
    meta = _own_reel_meta(supabase, client_id, reel_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Own reel not found for this client")
    points = _snapshot_points_for_reel(supabase, reel_id, from_dt, to_dt)
    return ReelMetricsSeriesOut(
        reel_id=str(meta["id"]),
        post_url=meta.get("post_url"),
        thumbnail_url=meta.get("thumbnail_url"),
        hook_text=meta.get("hook_text"),
        points=points,
    )


@router.get("/clients/{slug}/reels/{reel_id}/analysis", response_model=ReelAnalysisDetailOut)
def get_reel_analysis_by_reel_id(
    slug: str,
    reel_id: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    """Full Silas analysis JSON for a scraped reel (requires reel_analyses row)."""
    rc = (
        supabase.table("scraped_reels")
        .select("id, post_url")
        .eq("id", reel_id)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not rc.data:
        raise HTTPException(status_code=404, detail="Reel not found for this client")

    post_url = canonical_instagram_post_url(str(rc.data[0].get("post_url") or ""))

    ares = (
        supabase.table("reel_analyses")
        .select("*")
        .eq("client_id", client_id)
        .eq("reel_id", reel_id)
        .limit(1)
        .execute()
    )
    if ares.data:
        return ares.data[0]

    if post_url:
        ares2 = (
            supabase.table("reel_analyses")
            .select("*")
            .eq("client_id", client_id)
            .eq("post_url", post_url)
            .limit(1)
            .execute()
        )
        if ares2.data:
            return ares2.data[0]

    raise HTTPException(status_code=404, detail="No analysis stored for this reel")


@router.post("/clients/{slug}/reels/scrape")
def scrape_client_reels(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    found = find_stale_competitors(supabase, client_id=client_id)
    competitor_ids = found["competitor_ids"]

    total_reels = 0
    total_apify_items = 0
    details: list[Dict[str, Any]] = []

    for comp_id in competitor_ids:
        job_id = generate_job_id()
        row = {
            "id": job_id,
            "org_id": org_id,
            "client_id": client_id,
            "job_type": "profile_scrape",
            "payload": {"competitor_id": comp_id},
            "status": "running",
        }
        supabase.table("background_jobs").insert(row).execute()
        job_dict = dict(row)

        try:
            run_profile_scrape(settings, job_dict)
        except Exception as e:
            _fail_job(supabase, job_id, str(e))
            raise HTTPException(
                status_code=500,
                detail=f"profile_scrape failed for competitor {comp_id}: {e}",
            ) from e

        job_row = _fetch_job_row(supabase, job_id)
        res = job_row.get("result") or {}
        total_reels += int(res.get("reels_processed") or 0)
        total_apify_items += int(res.get("apify_items") or 0)
        details.append({"competitor_id": comp_id, "result": res})

    return {
        "competitors_scraped": len(competitor_ids),
        "reels_processed": total_reels,
        "apify_items": total_apify_items,
        "skipped_fresh": found["skipped_fresh"],
        "skipped_duplicate": found["skipped_duplicate"],
        "competitors_considered": found["competitors_considered"],
        "details": details,
    }
