# Meeting Action Items — 5 April 2026

Deep implementation spec. Every item traces back to transcript lines, maps to exact code paths, and defines precisely what to build, where, and why.

**Priority key:** P1 = do now, P2 = do next, P3 = deferred / blocked.

---

## P1.1 — Comments-to-views ratio as primary intelligence metric

### What Silas said
> "The best thing to track is comments to views ratio. Views, comments, comments-to-views. Likes is not that important." (lines 226-229)
> "These three are the most: views, comments, views-to-comments. Likes and stuff is not interesting." (lines 512-517)

Three columns he cares about: **views**, **comments**, **comments/views ratio**. Likes and saves are noise for his workflow.

### Exact data flow today

```
Apify instagram-reel-scraper → profile_scrape.py
  → item["videoViewCount"] → row["views"]
  → item["commentsCount"]  → row["comments"]
  → upsert scraped_reels (views, comments stored as bigint columns)

GET /clients/{slug}/reels → intelligence.py list_reels()
  → fetches all scraped_reels
  → calls enrich_engagement_metrics(row) per reel
  → returns ScrapedReelOut

enrich_engagement_metrics() in services/reel_metrics.py:
  engagement_rate = (likes + comments + saves + shares) / views
  save_rate = saves / views
  share_rate = shares / views
  ← NO comment_to_view_ratio
```

The field doesn't exist anywhere. `engagement_rate` is a blended metric that dilutes comments with likes — the opposite of what Silas wants.

### Why this ratio matters for Silas's specific workflow

Silas's workflow: find English reel → check if it's viral → replicate in German. His signal for "viral" is comments-to-views, because:
1. A reel that goes viral triggers discussion (comments) proportional to reach (views).
2. Comments indicate "topic resonance" — people care enough to respond.
3. A comment CTA format inherently drives more comments, but even without a CTA, a high comment/view ratio signals the content hit a nerve.

This ratio will be used in:
- **P1.3 (Two-lane ranking):** Both lanes need this as a sorting/filtering signal.
- **P1.4 (Keyword discovery Phase 2):** When enriched keyword results come back, rank by this ratio.
- **Breakouts:** Supplement × ratio with comment/view ratio for detection.

### Implementation — exact changes

**`services/reel_metrics.py` — `enrich_engagement_metrics()`:**

Add one line after the existing save_rate/share_rate:
```python
reel["comment_to_view_ratio"] = round(c / v, 6) if v > 0 else None
```

No DB column needed. This is computed at API time, same pattern as `engagement_rate`, `save_rate`, `share_rate`. All callers of `enrich_engagement_metrics()` already return the mutated dict.

**`models/reel.py` — `ScrapedReelOut`:**

Add:
```python
comment_to_view_ratio: Optional[float] = None
```

**Callers already covered (no changes needed):**
- `list_reels()` — calls `enrich_engagement_metrics()` on every row.
- `_top_reels_by_growth()` — calls it on the top picks.
- `_top_stored_reels_by_metrics()` — same.
- `get_intelligence_activity()` — the growth response doesn't use this but the nested `week_breakouts` reels go through `_top_reels_by_growth()`.

**Frontend — reels table and cards:**
- Replace or demote "Likes" column with "C/V Ratio" showing `comment_to_view_ratio` as a percentage (e.g., "2.3%") or "X per 1K views".
- Breakout cards: show this ratio alongside the × multiplier.

**Effort:** ~1-2 hours. One backend line, one model field, one UI column swap.

---

## P1.2 — "Recreate this reel" button (Intelligence → Generate)

### What Silas said
> "I put the link here and it creates the text, the caption, everything finalized." (line 334)
> "How does it work? When I see in the intelligence part, I see, okay, I want to recreate this reel. How is the process then?" (lines 386-387)
> — Dani: "We don't have it yet." (line 390)

75% of Silas's work is: find an English reel → adapt it to German for Connie (line 118). The system already does both halves — intelligence surfaces reels, `url_adapt` generates from a URL. They just aren't connected.

### What already exists end-to-end

```
Intelligence page:
  scraped_reels → reel cards with post_url, views, comments, thumbnail
  ✅ Reel data visible

Generate page (url_adapt path):
  user pastes URL → GenerationStartBody{source_type: "url_adapt", source_url: url}
  → generation.py start_generation()
  → _execute_reel_analyze_url_core(url) → Apify scrape + Gemini analysis
  → run_adaptation_synthesis() → angles → content package
  ✅ Full pipeline works

Missing: the link between them.
```

The generate page already reads `SourceMode` from state:

```typescript
// generate/page.tsx line 35
type SourceMode = "format_pick" | "idea_match" | "url_adapt";
```

When `url_adapt` is selected, there's a manual URL text input. The user pastes a URL, clicks generate, and the pipeline runs. We need to pre-fill this from a URL param.

### Implementation — exact changes

**Frontend only. Zero backend changes.**

**1. Add "Recreate" button to reel cards.**

Wherever a reel with a `post_url` is displayed, add a button/link. The files:
- `intelligence/components/reel-card-with-analysis.tsx` — individual reel cards in the analysis grid.
- `intelligence/components/breakouts-reels-grid.tsx` — breakout reel cards.
- `intelligence/reels/intelligence-reels-table.tsx` — the reels table rows.
- `intelligence/components/reel-analysis-detail-modal.tsx` — full analysis modal.

Each button renders as:
```tsx
<Link href={`/generate?source=url_adapt&url=${encodeURIComponent(post_url)}`}>
  Recreate
</Link>
```

**2. `generate/page.tsx` — read search params on mount.**

```tsx
import { useSearchParams } from "next/navigation";

// Inside the component:
const searchParams = useSearchParams();

useEffect(() => {
  const sourceParam = searchParams.get("source");
  const urlParam = searchParams.get("url");
  if (sourceParam === "url_adapt" && urlParam) {
    setSourceMode("url_adapt");
    setUrlInput(urlParam);
    // Optionally auto-trigger generation start
  }
}, [searchParams]);
```

The `setUrlInput` sets the existing URL text field. If auto-trigger is desired, call the same function that the "Generate" button calls after a small delay (to let the user see what's happening).

**3. Optional: "Recreate" in keyword discovery results (P1.4 Phase 1).**

Same pattern: `topic-search-section.tsx` shows reel URLs from keyword search. Add "Recreate" link per reel URL → same `/generate?source=url_adapt&url=...` route.

**Effort:** ~2-3 hours. Pure frontend wiring.

---

## P1.3 — Two-lane ranking: Proven Performers + Trending Now

### What the conversation actually established (lines 160-325)

Three phases of the discussion:

**Phase A — Toni's existing algorithm (lines 160-199):**
Toni ranks reels by **growth**, not raw views. His approach:
1. Ignore reels less than 14 days old (let them settle).
2. After 14 days, measure growth over a 7-day window (days 14-21).
3. Rank by growth in that window.

The point: find reels with **sustained momentum**, not flash-in-the-pan spikes.

**Phase B — Silas identifies the blind spot (lines 244-250):**
> "All the other reels on his profile got this amount of views in 24 hours, and this new one got exponentially more in the first 24 hours, although it's not over the other."

Translation: a fresh reel has low absolute numbers. The `outlier_ratio` (views / account_avg_views) shows "0.1x" for a reel posted yesterday. But if that reel got 50K views in 24h when the account's reels normally get 5K in their first 24h, it's at **10x velocity**. That's the signal.

**Phase C — Two lanes agreed (lines 266-325):**
1. **"Proven / Recommendations"** — settled reels (>14 days) ranked by sustained growth. For weekly planning.
2. **"Trending / New"** — fresh reels (<48h) growing faster than normal. For same-day replication.

Silas: "Maybe two types — all time, and then new and trending" (line 266).
Toni: "The video that yesterday been uploaded and has a performance above the average ... pick up these videos and give you the opportunity to click a button and replicate it" (lines 274-276).

### Exact data available in the system

**`scraped_reels` table — one row per reel:**
| Field | Type | Notes |
|-------|------|-------|
| `views` | bigint | Current total (updated each sync) |
| `likes` | bigint | Current total |
| `comments` | bigint | Current total |
| `posted_at` | timestamptz | When the reel was published (from Apify) |
| `account_avg_views` | int | Competitor's average views at time of last scrape |
| `account_avg_likes` | int | Same for likes |
| `account_avg_comments` | int | Same for comments |
| `outlier_ratio` | text | `max(views/avg, likes/avg, comments/avg)` |
| `competitor_id` | text | FK to competitors table |

**`reel_snapshots` table — append-only, one row per reel per sync:**
| Field | Type | Notes |
|-------|------|-------|
| `reel_id` | text | FK to scraped_reels |
| `views` | bigint | Views at time of snapshot |
| `likes` | bigint | Likes at time of snapshot |
| `comments` | bigint | Comments at time of snapshot |
| `scraped_at` | timestamptz | When this snapshot was taken |

**Snapshot timing:**
```
Competitor posts reel at time T
  ↓
Daily sync runs at time T + X  (X = 0..24h depending on when sync fires)
  → profile_scrape.py upserts reel into scraped_reels (current metrics)
  → insert_snapshots_for_scrape_job() creates snapshot #1
  ↓
Next daily sync at time T + X + ~24h
  → profile_scrape.py updates scraped_reels (new metrics)
  → creates snapshot #2
  ↓
Now we have 2 snapshots, ~24h apart
  → Delta = snapshot_2.views - snapshot_1.views = "first-day gain" (approximately)
```

**Key constraint:** We only get ~1 snapshot per day per reel. We can't observe "first 24h views" precisely — we observe "views gained between two consecutive daily syncs." This is close enough for velocity tracking but not millisecond-precise.

**Another constraint:** If a competitor was just added and we scraped their last 30 reels, many of those reels are weeks/months old. Their "first snapshot" is at age 30+ days. The delta between snapshot 1 and snapshot 2 represents ~1 day of growth at age 30 days — NOT first-day velocity. We need to filter to only use reels we "caught fresh."

### Implementation — Lane A: Proven Top Performers

**Goal:** Reels that have proven themselves over time. For weekly planning.

**Algorithm:**
```
1. Filter scraped_reels where:
   - competitor_id IS NOT NULL (competitor reels, not own)
   - posted_at IS NOT NULL
   - posted_at < now() - 14 days (settled)

2. For each reel, find growth over days 14-21:
   - baseline = snapshot closest to posted_at + 14 days
   - measure  = snapshot closest to posted_at + 21 days
   - growth_views = measure.views - baseline.views
   - growth_comments = measure.views - baseline.comments

3. Rank by growth_views DESC, growth_comments DESC.
   Return top N.
```

**Changes to existing code:**

Currently `_top_reels_by_growth()` does growth over a rolling 7-day window (comparing `now` to `now - 7d`). This works but doesn't implement the 14-day settle. Options:

**Option A (recommended):** Create a new function `_proven_performers()` separate from the existing `_top_reels_by_growth()`:
```python
def _proven_performers(
    supabase: Client,
    client_id: str,
    *,
    settle_days: int = 14,
    growth_window_days: int = 7,
    top_n: int = 5,
) -> List[Dict[str, Any]]:
```

This function:
1. Fetches `scraped_reels` where `posted_at < now - settle_days` and `competitor_id IS NOT NULL`.
2. Gets snapshots for those reels.
3. For each reel, finds the snapshot closest to `posted_at + settle_days` and the one closest to `posted_at + settle_days + growth_window_days`.
4. Computes growth.
5. Sorts and returns top N.

**Fallback when snapshots are sparse:** If a reel has < 2 snapshots in the measurement window, fall back to raw metric ranking (highest absolute views). This handles the cold-start case where we haven't had enough syncs yet.

**Option B (simpler, faster to ship):** Keep using `_top_reels_by_growth()` as-is but add a `posted_before` filter:
```python
def _top_reels_by_growth(
    supabase, client_id, top_n=3, growth_days=7, posted_before_days=14
):
    # ... existing code ...
    # Add filter: skip reels posted within posted_before_days
    cutoff_posted = now - timedelta(days=posted_before_days)
    rows = [r for r in rows if _reel_reference_date(r) and _reel_reference_date(r) < cutoff_posted]
```

This is less precise (doesn't align growth window to reel age) but ships faster and is a meaningful improvement over current behavior.

**Recommendation:** Start with Option B (minimal change), upgrade to Option A when we have more snapshot data to work with.

### Implementation — Lane B: Trending Now

**Goal:** Catch reels that are blowing up in their first 24-48h. For same-day replication.

**The core problem:** A reel posted yesterday has low absolute views compared to the competitor's all-time average. The `outlier_ratio` (reel.views / competitor.avg_views) shows maybe 0.1x. But that 0.1x in 24h might be extraordinary early velocity.

**MVP — Threshold filter on existing fields (no snapshots needed):**

This is what Toni suggested (line 274-276): "Pick up videos that yesterday performed better than the average."

```python
def _trending_now_mvp(
    supabase: Client,
    client_id: str,
    *,
    max_age_hours: int = 48,
    threshold_ratio: float = 0.3,
    top_n: int = 10,
) -> List[Dict[str, Any]]:
    """
    Reels posted in the last max_age_hours that already have
    views >= threshold_ratio * account_avg_views.

    If you're at 30% of the account's LIFETIME average in under 2 days,
    you're clearly outperforming. This is a rough but effective first signal.
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=max_age_hours)

    res = (
        supabase.table("scraped_reels")
        .select("*")
        .eq("client_id", client_id)
        .not_.is_("competitor_id", "null")
        .gte("posted_at", cutoff.isoformat())
        .execute()
    )
    rows = [dict(r) for r in (res.data or [])]
    candidates = []
    for r in rows:
        avg = int(r.get("account_avg_views") or 0)
        views = int(r.get("views") or 0)
        if avg <= 0:
            continue
        ratio = views / avg
        if ratio >= threshold_ratio:
            r = enrich_engagement_metrics(dict(r))
            r["trending_ratio"] = round(ratio, 3)
            candidates.append(r)

    candidates.sort(key=lambda x: x.get("trending_ratio", 0), reverse=True)
    return candidates[:top_n]
```

**Why 0.3x works:** The `account_avg_views` is the all-time average across ~30 reels spanning months/years of performance. A reel reaching 30% of that in under 48 hours is on pace to significantly exceed the average — possibly 3-5x by the time it settles. The threshold is tunable (configurable per client via `clients.trending_threshold` later).

**What this requires:** Only existing `scraped_reels` fields. No snapshot queries. Available in DB right now.

**V2 — Full velocity tracking with snapshots:**

For when we have enough snapshot data (after ~2 weeks of daily syncs):

```python
def _compute_competitor_first_day_velocity(
    supabase: Client,
    competitor_id: str,
) -> Optional[float]:
    """
    For reels of this competitor that we caught early (first snapshot
    within 48h of posted_at), compute the median first-day views gain.

    Returns None if fewer than 3 qualifying reels.
    """
    reels = (
        supabase.table("scraped_reels")
        .select("id, posted_at")
        .eq("competitor_id", competitor_id)
        .not_.is_("posted_at", "null")
        .execute()
    ).data or []

    gains = []
    for reel in reels:
        posted = parse_datetime(reel["posted_at"])
        if posted is None:
            continue
        snaps = (
            supabase.table("reel_snapshots")
            .select("views, scraped_at")
            .eq("reel_id", reel["id"])
            .order("scraped_at", desc=False)
            .limit(3)
            .execute()
        ).data or []
        if len(snaps) < 2:
            continue
        first_snap_time = parse_datetime(snaps[0]["scraped_at"])
        if first_snap_time is None:
            continue
        # Only use reels we observed within 48h of posting
        if (first_snap_time - posted).total_seconds() > 48 * 3600:
            continue
        gain = int(snaps[1].get("views") or 0) - int(snaps[0].get("views") or 0)
        if gain > 0:
            gains.append(gain)

    if len(gains) < 3:
        return None
    gains.sort()
    return float(gains[len(gains) // 2])  # median


def _trending_now_velocity(
    supabase: Client,
    client_id: str,
    *,
    max_age_hours: int = 48,
    min_velocity_multiplier: float = 1.5,
    top_n: int = 10,
) -> List[Dict[str, Any]]:
    """
    Reels from the last max_age_hours whose early velocity exceeds
    the competitor's typical first-day velocity by min_velocity_multiplier.
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=max_age_hours)

    # Fetch recent competitor reels
    res = (
        supabase.table("scraped_reels")
        .select("*, competitor_id")
        .eq("client_id", client_id)
        .not_.is_("competitor_id", "null")
        .gte("posted_at", cutoff.isoformat())
        .execute()
    )
    recent = [dict(r) for r in (res.data or [])]
    if not recent:
        return []

    # Get per-competitor velocity baselines (cache per request)
    comp_ids = list({r["competitor_id"] for r in recent if r.get("competitor_id")})
    velocity_baselines: Dict[str, Optional[float]] = {}
    for cid in comp_ids:
        velocity_baselines[cid] = _compute_competitor_first_day_velocity(supabase, cid)

    # Score each recent reel
    reel_ids = [r["id"] for r in recent]
    snapshots_by_reel = _snapshots_grouped_by_reel(supabase, reel_ids)

    candidates = []
    for r in recent:
        cid = r.get("competitor_id")
        baseline_vel = velocity_baselines.get(cid)
        if baseline_vel is None or baseline_vel <= 0:
            continue  # Can't compute velocity for this competitor yet
        snaps = snapshots_by_reel.get(r["id"], [])
        if len(snaps) < 2:
            continue
        # snaps are sorted DESC — newest first
        newest = snaps[0]
        oldest = snaps[-1]
        gain = int(newest.get("views") or 0) - int(oldest.get("views") or 0)
        if gain <= 0:
            continue
        velocity_multiplier = gain / baseline_vel
        if velocity_multiplier >= min_velocity_multiplier:
            r = enrich_engagement_metrics(dict(r))
            r["velocity_multiplier"] = round(velocity_multiplier, 2)
            r["first_day_views_gain"] = gain
            r["competitor_avg_first_day_gain"] = round(baseline_vel)
            candidates.append(r)

    candidates.sort(key=lambda x: x.get("velocity_multiplier", 0), reverse=True)
    return candidates[:top_n]
```

**When to upgrade to v2:** After ~2 weeks of running daily syncs with the snapshot system active. Before that, most competitors won't have enough "caught-fresh" reels with 2+ snapshots to compute a meaningful velocity baseline. The MVP threshold approach works from day 1.

**Performance concern for v2:** `_compute_competitor_first_day_velocity()` runs per-competitor and fetches snapshots per-reel. For a client with 20 competitors and 600 reels total, this means ~600 small snapshot queries. Solutions:
1. Cache velocity baselines on the `competitors` table (`avg_first_day_velocity` column), recompute once per sync.
2. Or batch-fetch all snapshots for all competitor reels in one query and compute in memory.

Recommended: compute and cache on sync (add to `profile_scrape.py` after updating competitor averages).

### API response structure

Extend `GET /clients/{slug}/activity` to include both lanes:

```json
{
  "trending_now": {
    "description": "Reels from the last 48h growing faster than normal",
    "max_age_hours": 48,
    "reels": [
      {
        "...standard scraped_reel fields + engagement metrics...",
        "trending_ratio": 0.45,
        "comment_to_view_ratio": 0.023,
        "post_url": "https://www.instagram.com/reel/...",
        "account_username": "competitor_xyz",
        "posted_at": "2026-04-05T14:30:00Z"
      }
    ]
  },
  "proven_performers": {
    "description": "Settled reels (>14d) ranked by sustained growth",
    "settle_days": 14,
    "growth_window_days": 7,
    "reels": [
      {
        "...standard scraped_reel fields + engagement metrics...",
        "growth_views": 85000,
        "growth_comments": 420,
        "comment_to_view_ratio": 0.031
      }
    ]
  },
  "week_breakouts": { "...existing..." },
  "own_reel_growth": [ "...existing..." ]
}
```

### Frontend

Two distinct sections on the intelligence page:

**"Trending Now" section:**
- Shows only if there are qualifying reels.
- Each reel card: thumbnail, hook text, views, comments, C/V ratio, posted time ("18h ago"), trending badge ("0.45x of avg in 18h").
- "Recreate" button per reel → `/generate?source=url_adapt&url=...`
- Refreshes daily. Meaningful because it's about fresh reels.

**"Proven Performers" section:**
- Below trending or in a separate tab.
- Each reel card: thumbnail, hook text, views, comments, C/V ratio, growth badge ("+85K views in 7d").
- "Recreate" button.
- Stable week-to-week. For content planning.

**Effort:**
- MVP (threshold filter): ~3-4 hours backend + ~3-4 hours frontend.
- V2 (velocity tracking): ~1 day backend + cache, frontend already done from MVP.

---

## P1.4 — Keyword-based reel discovery

### What was discussed (lines 5-12)

> Dani: "Scraping the reels by the keywords, not just only by the competitors of the client."
> Toni: "Like what he has there, really replicate the algorithm that you have. Like, I do this when I want to search these videos, I just go on the reels and..."
> Silas: "Yeah, exactly."

This replicates **how Silas manually discovers content.** He opens Instagram → searches a topic keyword in the Reels tab → browses what the algorithm surfaces → picks the best ones → adapts them for Connie. The system needs to do the same.

### Why the fixed competitor list isn't enough

The competitor list misses:
1. **New creators** who haven't been tracked yet.
2. **Adjacent-niche accounts** who occasionally produce a relevant banger.
3. **One-off viral reels** from non-niche accounts that hit the topic.

Keyword reel search catches all three because it taps Instagram's `clips/search` endpoint, which matches **reel content** (captions, audio, topic tags), not account bios.

### The Apify landscape — tested, verified

From `docs/VIRAL-DISCOVERY-SPEC.md`, 8 actors were tested. **One works:**

| Actor | ID | Result |
|-------|-----|--------|
| **Sasky Keyword Reels URLs** | **`4QFjEpnGE1PNEnQF2`** | **335 reels, 186 accounts, niche-relevant** |
| Others (7 actors) | various | Broken, empty, random, or images-only |

**What the Sasky actor does:** Searches Instagram's private `clips/search` endpoint — the same endpoint the Instagram app uses when you search in the Reels tab. This is the actual Instagram algorithm for reels.

**Exact input:**
```json
{"keyword": "toxic workplace", "maxItems": 100}
```

**Exact output per item:**
```json
{
    "user_name": "ccjenniferbrick",
    "user_link": "https://www.instagram.com/ccjenniferbrick/",
    "keyword": "toxic workplace",
    "reel_url": "https://www.instagram.com/reel/DWPjB9FCj7u/"
}
```

**Critical fact: NO engagement data.** No views, no likes, no comments, no thumbnail. Just the reel URL and who posted it.

### What currently exists in code

**Backend — `services/apify.py`:**
```python
KEYWORD_REEL_ACTOR = "4QFjEpnGE1PNEnQF2"

def run_keyword_reel_search(token: str, keyword: str, max_items: int = 50) -> list:
    return run_actor(token, KEYWORD_REEL_ACTOR, {"keyword": keyword.strip(), "maxItems": max_items})
```

**Backend — `POST /clients/{slug}/search/topics` in `routers/intelligence.py`:**
```python
items = run_keyword_reel_search(token, keyword, max_items=body.max_items)
accounts = _group_keyword_reel_items(items)
return {"keyword": ..., "total_items": len(items), "accounts": accounts}
```

**`_group_keyword_reel_items()` — the aggregation function:**
Groups by username. Keeps 8 sample_urls per account. Returns `[{username, reel_count, sample_urls}]`.

**Problem:** Individual reel URLs are thrown away (except 8 samples per account). The data that matters most — the actual reel links — is discarded.

**Frontend — `topic-search-section.tsx`:**
Shows: keyword input → results as `@username — X reels on this topic`. No individual reels. No engagement data. User has to manually decide to add an account as a competitor.

**`niche_config` schema — where topic keywords live:**

The `clients` table has a `niche_config` JSON column. From `COMPETITOR-DISCOVERY-LOGIC.md`:
```json
{
    "topic_keywords": ["toxic workplace", "boundaries at work", "difficult boss"],
    "topic_keywords_de": ["toxischer Arbeitsplatz", "schwieriger Chef", "Mobbing"],
    "keywords": ["leadership coach", "career strategist"],
    "hashtags": ["toxicworkplace", "boundariesatwork"]
}
```

| Field | Used by | Searches against |
|-------|---------|-----------------|
| `keywords` / `keywords_de` | User search (bio actor) | Instagram bios |
| `topic_keywords` / `topic_keywords_de` | **Keyword reel search (Sasky)** | Reel content/captions |
| `hashtags` / `hashtags_de` | Hashtag pages | Post hashtags |

The auto-profiler generates all three types during onboarding. `topic_keywords` are the input for this feature.

### The relevance problem — raw keywords ≠ relevant reels

**This is the most important thing to get right before building anything.**

The Sasky actor searches Instagram's `clips/search` — the same endpoint the Instagram app uses. When you search "toxic workplace," Instagram returns reels that mention the keyword in their caption, audio, or topic tags. But "mentions the keyword" ≠ "content Connie should replicate."

A search for "toxic workplace" will return:
- Educational content creators talking about workplace dynamics (RELEVANT)
- Comedians doing office skits with "toxic workplace" in the caption (WRONG FORMAT)
- Employment lawyers advertising their services (WRONG STYLE)
- Therapists discussing the topic for a completely different audience (MAYBE)
- News clips about workplace scandals (WRONG)
- Brand accounts posting about company culture (WRONG)
- One-off posts from random accounts that happened to use the phrase (NOISE)

**If we show all 335 raw URLs to Silas, maybe 40-60% are actually the kind of reels he'd want to replicate.** That's a bad experience and wastes his time. This is exactly the problem the competitor discovery pipeline solves at the account level — it feeds captions to Gemini with the client's niche profile and filters below a 60/100 relevance threshold.

### What the existing relevance pipeline does (already built)

The competitor discovery scripts + Python port (`jobs/competitor_discovery.py`) already solve this:

```
Account found → scrape 8 recent captions → build relevance prompt:
  "Is @username a GENUINE COMPETITOR?
   Client's niche: [workplace communication, leadership coaching...]
   Client's ICP: [mid-career professionals, 30-50, pain: toxic boss...]
   
   RECENT POST CAPTIONS:
   POST 1: "3 things to say when your boss gaslights you..."
   POST 2: "How to set boundaries at work without..."
   
   Watch for FALSE POSITIVES:
   - Motivational quote accounts (tangential)
   - Corporate brands (not individual creators)
   - Fitness/wellness coaches (different audience)
   - Generic life coaches (too broad)"

→ Gemini returns: relevance_score (0-100), content_style, primary_topics, reasoning
→ Filter: only keep accounts scoring >= 60
```

This catches false positives effectively. The same logic needs to apply to keyword reel discovery — but the question is: **at what level do we filter, and when?**

### The filtering problem for keyword reels specifically

The Sasky actor returns `{reel_url, user_name, keyword}`. No captions, no metrics, no thumbnails. To apply ANY filtering, we need a second Apify call to get reel metadata.

**Options:**

**Option A — Account-level filtering (reuse existing pipeline):**
- Group keyword results by username (already done by `_group_keyword_reel_items`).
- Accounts with 2+ reels for the keyword are likely dedicated to the topic.
- Check if they're already a tracked competitor → if yes, their reels are pre-vetted.
- For new accounts: run the existing `_build_relevance_prompt()` + `analyze_relevance()` on their recent captions.
- Only show reels from accounts that pass the relevance check.
- **Pro:** Reuses 100% of existing code. Cheap (one LLM call per account, not per reel).
- **Con:** Misses one-off viral reels from non-niche accounts. Slower (requires profile scrape per new account).

**Option B — Reel-level filtering (new):**
- Scrape individual reel URLs to get their captions + metrics.
- For each reel's caption, ask Gemini: "Is this reel the kind of content our client would replicate?"
- Score each reel individually.
- **Pro:** Most granular. Catches individual good reels from bad accounts.
- **Con:** Expensive (scrape + LLM per reel). 30 reels × ~$0.05 each = $1.50 per search. Slow.

**Option C — Hybrid (recommended, but needs testing first):**
- Phase 1: Account-level quick signals → already-tracked competitors get auto-approved.
- Phase 2: For accounts with 2+ keyword hits, do one batch caption scrape + one LLM call per account.
- Phase 3: For the remaining single-hit accounts, skip unless the reel's caption (once scraped) passes a lightweight text check.
- **This is what `competitor-discovery.js` does**, just applied to keyword results instead of bio search results.

### What we DON'T know yet — needs testing before building

Before committing to any implementation approach, we need to answer these questions empirically:

**1. What's the actual relevance rate of raw Sasky results for Connie's keywords?**

Run the Sasky actor for 3-5 of Connie's actual `topic_keywords` (from `niche_config`). Manually check 50 reel URLs from each search. What percentage are actually reels Silas would consider replicating?

If the answer is >70%: light filtering is enough — maybe just remove obviously irrelevant accounts.
If the answer is 40-70%: account-level filtering (Option A) is needed.
If the answer is <40%: we need reel-level analysis (Option B), or the keywords themselves need refinement.

**2. Does account frequency (2+ reels in results) correlate with relevance?**

From the VIRAL-DISCOVERY-SPEC testing: "toxic workplace" returned 186 accounts, 11 with 4+ reels, 62 with 2-3 reels, 111 with 1 reel. The top-frequency accounts (`@yourbipoctherapist`, `@thechildressfirm`, `@corporate_warriors`) DO look genuinely relevant.

Check: Are the single-hit accounts (111 of them) mostly noise? If so, filtering to `reel_count >= 2` alone could cut 60% of the noise for free — no LLM needed.

**3. Can the reel scraper (`apify~instagram-reel-scraper`) accept `directUrls`?**

The `reel_analyze_url.py` pipeline uses this actor with URL input for single reels. But does it work with a batch of 20-30 URLs? This determines whether metric enrichment is one Apify call or 20-30 separate calls.

Test: run the actor with `{"directUrls": [url1, url2, ..., url10]}` and check if it returns metadata for all of them.

**4. How much do the `topic_keywords` in Connie's `niche_config` actually match Silas's manual search behavior?**

Silas says he "goes on the reels and searches" — what does he actually search for? Are the auto-generated `topic_keywords` the right terms, or does he use more specific/creative queries? If the keywords are wrong, the whole pipeline returns irrelevant results regardless of filtering.

This might need a quick chat with Silas: "What 5-10 terms do you actually search when looking for reels to replicate?"

### Proposed testing approach (before any code)

**Step 1 — Manual Sasky test (30 minutes):**
Run the Sasky actor directly on Apify for 3 of Connie's topic keywords. Download the results. Manually open 20-30 reel URLs per keyword. Score each: "Would Silas replicate this? Yes/Maybe/No."

This tells us the raw relevance rate and whether we need heavy or light filtering.

**Step 2 — Account frequency analysis (15 minutes):**
From the same results, check: do accounts with 2+ hits have a higher relevance rate than single-hit accounts? This validates the "frequency = signal" assumption.

**Step 3 — Reel scraper batch test (15 minutes):**
Take 10 reel URLs from the Sasky results. Run `apify~instagram-reel-scraper` with `directUrls`. Check: do we get metadata (views, caption, thumbnail) for all of them? This validates the enrichment approach.

**Step 4 — Existing competitor cross-reference:**
From the keyword results, how many usernames are already in Connie's `competitors` table? For those, we already have vetted relevance + scraped reels. The keyword search is only adding new information for UNKNOWN accounts.

### Implementation — phased based on test results

#### Phase 1: Account-filtered keyword discovery

Regardless of test results, this is the safe first step:

1. Run Sasky keyword search → get reel URLs + usernames.
2. Group by username. Filter to accounts with `reel_count >= 2`.
3. Cross-reference against existing `competitors` table:
   - Known competitors: auto-approve their reels (already vetted).
   - Unknown accounts: run existing relevance analysis (`_build_relevance_prompt` + `analyze_relevance`) using their recent captions.
4. Return only reels from approved accounts + their individual reel URLs.
5. Each reel gets a "Recreate" button → existing `url_adapt` pipeline.

This is basically: **run the competitor_discovery pipeline on keyword results instead of bio search results**. The existing code in `jobs/competitor_discovery.py` does ~90% of this already — the accounts just come from a different source.

**Backend approach:**
```python
# Pseudocode — the real implementation depends on test results

def run_keyword_reel_discovery(settings, job):
    client = load_client(job["client_id"])
    keywords = client.niche_config.topic_keywords

    all_reel_items = []
    for kw in keywords:
        items = run_keyword_reel_search(token, kw, max_items=80)
        all_reel_items.extend(items)

    # Group by account
    by_account = group_by_username(all_reel_items)

    # Cross-reference with known competitors
    known_competitors = fetch_competitors(client_id)
    known_usernames = {c.username for c in known_competitors}

    approved_reels = []
    for username, account_reels in by_account.items():
        if username in known_usernames:
            # Already vetted → approve all their keyword reels
            approved_reels.extend(account_reels)
            continue

        if len(account_reels) < 2:
            # Single-hit → skip (likely noise, per hypothesis — validate in testing)
            continue

        # New account with 2+ hits → run relevance analysis
        posts = scrape_account_posts(username, count=8)
        relevance = analyze_relevance(niche_profile, account_data, posts)
        if relevance["relevance_score"] >= 60:
            approved_reels.extend(account_reels)
            # Optionally: also add as a competitor (source='keyword_reels')

    return approved_reels
```

**Frontend:** Show approved reels with "Recreate" buttons. Group by account with relevance info.

**What this does NOT include yet:**
- Metrics for individual reels (no views/comments until user clicks "Recreate" which triggers the full `url_adapt` scrape).
- The "algorithmic browsing" feel — it's still a list, not a visual feed.

#### Phase 2: Metric enrichment for approved reels

After Phase 1 proves the relevance filtering works:

1. For approved reels, batch-scrape their URLs to get views, likes, comments, thumbnail, caption.
2. Compute `comment_to_view_ratio` per reel.
3. Rank by C/V ratio.
4. Display with thumbnail, metrics, and "Recreate" button.

**The key question (from test Step 3):** Can we batch-scrape URLs? If yes, this is one Apify call for 20-30 reels. If no, it's 20-30 sequential calls — expensive and slow.

**Lightweight scrape function (if batch works):**
```python
def scrape_reel_urls_for_metadata(token, reel_urls, reel_actor):
    items = run_actor(token, reel_actor, {
        "directUrls": reel_urls,
        "resultsLimit": len(reel_urls),
    })
    return [{
        "post_url": item_url(item),
        "username": item.get("ownerUsername"),
        "views": int(item.get("videoViewCount") or 0),
        "likes": int(item.get("likesCount") or 0),
        "comments": int(item.get("commentsCount") or 0),
        "thumbnail_url": thumbnail(item),
        "caption": caption_text(item)[:500],
        "posted_at": posted_at(item),
    } for item in items if int(item.get("videoViewCount") or 0) > 0]
```

#### Phase 3: Recurring scheduled discovery

Once the pipeline is validated:
- New job type: `keyword_reel_discovery` (weekly).
- Pull `topic_keywords` from `niche_config`.
- Run keyword search + account filtering + metric enrichment.
- Store results in a discovery table:
  ```sql
  CREATE TABLE keyword_discovery_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL REFERENCES clients(id),
    keyword text NOT NULL,
    reel_url text NOT NULL,
    username text,
    views bigint,
    comments bigint,
    comment_to_view_ratio real,
    relevance_source text, -- 'known_competitor', 'new_approved', etc.
    discovered_at timestamptz DEFAULT now(),
    UNIQUE(client_id, reel_url)
  );
  ```
- Surface on intelligence page as "New in your niche this week."

### What this means for effort and sequencing

**This changes the effort estimate significantly.** The previous spec assumed raw URLs could be shown directly (Phase 1 = 3-4 hours). That's wrong. The actual sequence:

```
Step 0: Testing (before any code)           → ~1 hour with Apify console
Step 1: Account-filtered discovery           → ~1 day (leverages existing competitor_discovery.py heavily)
Step 2: Metric enrichment                    → ~half day (depends on batch scrape test)
Step 3: Recurring scheduled discovery        → ~half day
```

**Step 0 should happen FIRST** because it determines whether the whole approach is viable and how heavy the filtering needs to be. If raw Sasky results for Connie's keywords are 80%+ relevant, light filtering is enough. If they're 30% relevant, we need the full account-level analysis pipeline.

---

## P2.1 — Show top competitor reels per format in Generate page

### What Toni proposed (lines 382-385)
> "If you choose a format, instead of giving you [AI inspiration], we can give you the four top performance videos from your competitors with that format. And you choose which one you want to replicate."

### What exists

**`format_digests` table:**
Computed by `services/format_digest.py`. Each row has:
- `format_key`: e.g., "text_overlay", "talking_head"
- `top_reel_ids`: JSON array of `{analysis_id, reel_id}` objects — the best analyzed reels for this format.
- `pattern_summary`: AI-generated summary of what works in this format.

**`generation_start()` for `format_pick`:**
When user picks a format, `generation.py` reads `top_reel_ids` from the digest and stores them as `source_reel_ids` on the `generation_sessions` row. But the UI **never shows these reels to the user** — it immediately generates AI angles.

### What's missing

The user never sees the actual top reels for the format they picked. They go straight to AI-generated angles without seeing the source material.

### Implementation

**Backend — enrich format digest response:**

The existing `GET /generate/format-digests` returns summaries. Add enriched reel data:

```python
@router.get("/clients/{slug}/generate/format-digests/{format_key}/top-reels")
def get_format_digest_top_reels(
    slug: str,
    format_key: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Dict[str, Any]:
    digest = get_digest_for_format(supabase, client_id, format_key)
    if not digest:
        return {"reels": []}
    top_ids = digest.get("top_reel_ids") or []
    reel_ids = [t["reel_id"] for t in top_ids if t.get("reel_id")]
    if not reel_ids:
        return {"reels": []}
    res = (
        supabase.table("scraped_reels")
        .select("id, post_url, thumbnail_url, hook_text, views, likes, comments, account_username, video_duration")
        .in_("id", reel_ids)
        .execute()
    )
    reels = [enrich_engagement_metrics(dict(r)) for r in (res.data or [])]
    return {"format_key": format_key, "reels": reels}
```

**Frontend — show reels after format selection:**

In `generate/page.tsx`, after user selects a format:
1. Fetch top reels for that format.
2. Show a "Top reels in this format" section with cards: thumbnail, hook, views, C/V ratio.
3. Each card has "Replicate this" → switches to `url_adapt` mode with that URL.
4. Or user can proceed with "Generate from patterns" (existing AI flow).

**Effort:** Medium. ~4-5 hours (1 endpoint + frontend section).

---

## P2.2 — Brand-fit scoring

### What Silas said (lines 124-129)
> "Compare everything to Connie's brand. Hook match 1-10. Caption, analyze the whole caption, compare it to Connie's values."
> But also (lines 89-112): "For now, this part doesn't have to be super specific."

### Implementation

Add a `brand_fit_score` (1-10) to `reel_analyses`. During the existing Gemini analysis pass in `reel_analyze_url.py`, include one additional question in the prompt:

```
"brand_fit": {
    "score": <1-10>,
    "rationale": "<why this reel does/doesn't match the client's brand>"
}
```

The client DNA is already available during analysis via `_niche_context_for_reel_analysis()`. Just extend the prompt to ask for brand fit assessment.

Display as a badge/column in reels table and breakouts grid.

**Effort:** Low-Medium. One LLM sub-prompt addition + model field + UI badge.

---

## P2.3 — Client DNA update via chat interface

### What was proposed (lines 140-153)

Silas wants to constantly update Connie's profile with new context — via chat, not manual field editing.

### Implementation

New endpoint: `POST /clients/{slug}/dna/chat-update`

```python
@router.post("/clients/{slug}/dna/chat-update")
def chat_update_dna(slug: str, body: DnaChatBody, ...):
    current_dna = load_client_dna(supabase, client_id)
    updated = llm_apply_instruction(current_dna, body.message)
    supabase.table("clients").update({"client_dna": updated}).eq("id", client_id).execute()
    return {"updated_fields": [...], "dna": updated}
```

Frontend: chat-like input on client settings page.

**Effort:** Medium. Needs careful prompt to avoid overwriting unrelated DNA sections.

---

## P3.1 — Inject Silas's custom prompts

### Status: BLOCKED on Silas's deliverable

Silas will deliver prompts for: captions, talking head scripts, hooks, reel covers/thumbnails.

### When received

Inject as per-output-type sections in `run_content_package()`, `run_angle_generation()`, and `run_regenerate()` in `services/content_generation.py`. Or store as new `client_context` fields for per-client customization.

**Effort:** Low once received.

---

## Execution Order

```
1. P1.1 — Comments/views ratio
   → ~1-2 hours
   → Changes how every reel is displayed and ranked

2. P1.2 — Recreate button
   → ~2-3 hours
   → Connects intelligence to generate (the core workflow gap)

3. P1.3 — Two-lane ranking
   → MVP (threshold filter): ~6-8 hours (backend + frontend)
   → v2 (velocity tracking): additional ~1 day when snapshot data matures
   → Most impactful intelligence upgrade

4. P1.4 — Keyword reel discovery
   → Step 0: Apify testing (~1 hour, blocks everything else in this item)
   → Step 1: Account-filtered discovery (~1 day, leverages existing competitor_discovery.py)
   → Step 2: Metric enrichment (~half day, depends on batch scrape test)
   → Step 3: Recurring scheduled (~half day)
   → Enables algorithm-style browsing, but needs validation first

5. P2.1 — Top reels per format in Generate
   → ~4-5 hours
   → Enriches format_pick flow with real examples

6. P2.2 — Brand-fit scoring
   → ~3-4 hours
   → Polish — improves signal quality

7. P2.3 — Chat DNA update
   → ~1 day
   → UX improvement, not blocking

8. P3.1 — Silas prompts
   → Blocked on delivery
```

Items 1 + 2 together are < half a day and unlock the core workflow immediately.
Item 3 MVP is the biggest intelligence upgrade.
Item 4 MUST start with testing (Step 0) — don't build the pipeline blind.

### Critical dependency for P1.4

The keyword discovery pipeline cannot be built properly without first verifying:
1. What % of raw Sasky results are actually relevant for Connie's specific keywords.
2. Whether `reel_count >= 2` is an effective noise filter.
3. Whether the reel scraper supports batch URL input for metric enrichment.
4. Whether Connie's `topic_keywords` in `niche_config` match what Silas actually searches for.

Run these tests (30 minutes in Apify console + 30 minutes manual review) before writing any code for P1.4. The results determine whether we need heavy filtering (full Gemini relevance analysis per account, like competitor_discovery) or light filtering (just frequency threshold + known-competitor cross-reference).
