# Scraping Reference — Apify Pipelines

How we parametrize and call Apify, what we send to Gemini, and how the results flow into Supabase.

**Last updated:** 2026-03-24

---

## Apify actors used

| Actor ID | Name | Purpose |
|---|---|---|
| `DrF9mzPPEuVizVF4l` | Instagram User Search | Find accounts by keyword (bio/name match) |
| `xMc5Ga1oCONPmWJIa` | Instagram Reel Scraper | Pull reels from a known account |

Both are called via:
```
POST https://api.apify.com/v2/acts/{actor_id}/runs
Authorization: Bearer {APIFY_API_TOKEN}
Content-Type: application/json
```

The worker polls run status every 5 seconds until `SUCCEEDED` or `FAILED`, then fetches results:
```
GET https://api.apify.com/v2/datasets/{dataset_id}/items
```

Source: `backend/services/apify.py`

---

## Pipeline 1: Competitor Discovery

**Job type:** `competitor_discovery`
**Source:** `backend/jobs/competitor_discovery.py` (Python port of `scripts/competitor-discovery.js`)
**Triggered by:** `POST /api/v1/clients/{slug}/competitors/discover`

### Step 1 — Search for accounts

**Actor:** `DrF9mzPPEuVizVF4l` (Instagram User Search)

**Input:**
```json
{
  "search": "leadership coach",
  "searchType": "user",
  "resultsLimit": 30
}
```

| Field | Value | Source |
|---|---|---|
| `search` | The keyword | From API request body (`keyword` field), or auto-picked from `niche_config[0].keywords_de[0]` / `niche_config[0].keywords[0]`. Batch mode iterates ALL keywords from all niches. |
| `searchType` | Always `"user"` | We search for accounts, not posts or hashtags. Instagram's API matches against bio and display name. |
| `resultsLimit` | `limit * 2` (default: 30) | Over-fetch because we filter out many accounts in the next step. |

> **⚠️ Keywords MUST be identity keywords** (what creators put in their bio: "leadership coach", "career strategist", "Führungskräfte Coach"), NOT topic keywords (what they post about: "toxic workplace", "boundaries at work"). Topic keywords return near-zero results because nobody writes them in their bio. See [COMPETITOR-DISCOVERY-LOGIC.md](./COMPETITOR-DISCOVERY-LOGIC.md) and [AUTO-PROFILE-SPEC.md](./AUTO-PROFILE-SPEC.md) for the full keyword strategy.

**What Apify returns:** Array of user objects:
```json
{
  "username": "thebigapplered",
  "fullName": "...",
  "biography": "...",
  "followersCount": 245000,
  "verified": false,
  "private": false,
  "latestPosts": [
    {
      "caption": "...",
      "videoViewCount": 523000,
      "likesCount": 12000,
      "commentsCount": 340,
      "videoDuration": 15,
      "shortCode": "ABC123",
      "timestamp": "2026-03-20T..."
    }
  ]
}
```

The `latestPosts` array is key — it often contains 3-8 recent posts embedded in the search result, saving a separate Apify call.

### Step 2 — Filter accounts (no AI, no Apify cost)

Accounts are discarded if:
- `private == true`
- `followersCount < 500` (too small to learn from)
- `followersCount > 5,000,000` (celebrity/brand, not a niche creator)
- `username` matches the client's own Instagram handle

Source: `_discover_by_keyword()` in `competitor_discovery.py`

### Step 3 — Get post captions per account

**Path A — Use cached `latestPosts`:**
If the search result already includes 3+ posts with captions, use those. No extra Apify call. This is the common case.

**Path B — Scrape the account (costs Apify credits):**

Only happens when `latestPosts` has fewer than 3 entries.

**Actor:** `xMc5Ga1oCONPmWJIa` (Instagram Reel Scraper)

**Input:**
```json
{
  "username": ["thebigapplered"],
  "resultsLimit": 8
}
```

**Caption extraction quirk:** The `caption` field can be either a plain string or `{"text": "..."}` depending on the Apify actor version. The code handles both:
```python
cap = r.get("caption")
if isinstance(cap, dict):
    cap = cap.get("text") or ""
```

From each post we extract: `caption`, `views` (from `videoViewCount` or `videoPlayCount`), `likes`, `comments`, `duration`, `url`, `timestamp`.

### Step 4 — AI relevance scoring (Gemini via OpenRouter)

For each filtered account, one API call to Gemini:

**Endpoint:** `https://openrouter.ai/api/v1/chat/completions`
**Model:** `google/gemini-2.0-flash-001` (configurable via `OPENROUTER_MODEL`)
**Temperature:** 0.1 (near-deterministic)
**Max tokens:** 512

**Prompt structure:**

The prompt contains three blocks:

1. **Client niche profile** — built from `clients.name`, `instagram_handle`, `language`, `niche_config` (all niches with names, descriptions, content angles), and `icp` (target, age range, pain points, desires).

2. **Discovered account data** — username, bio, follower count.

3. **Recent post captions** — up to 8 captions, truncated to 300 chars each.

4. **Analysis instructions** — including explicit false-positive detection rules:
   - Motivational quote accounts that occasionally mention "workplace"
   - Corporate brand accounts (not individual creators)
   - Fitness/wellness coaches who sometimes mention "boundaries"
   - Generic life coaches with broad advice
   - Accounts in the same language but different niche

**Expected JSON response:**
```json
{
  "relevance_score": 85,
  "is_competitor": true,
  "confidence": "high",
  "primary_topics": ["toxic boss", "workplace boundaries", "leadership language"],
  "content_style": "educator",
  "overlap_niches": ["workplace-communication"],
  "language": "English",
  "reasoning": "This account consistently creates educator content about toxic workplace dynamics..."
}
```

Accounts with `relevance_score < threshold` (default 60) are discarded.

Source: `_build_relevance_prompt()` and `_build_niche_profile()` in `competitor_discovery.py`, `analyze_relevance()` in `services/openrouter.py`

### Step 5 — Performance scoring (application code, no AI)

Only runs if a valid client baseline exists (not expired — 7-day TTL).

**Inputs:**
| Value | Source |
|---|---|
| `competitor.avg_views` | Mean of views from scraped posts |
| `baseline.p90_views` | Client's top 10% — blueprint threshold |
| `baseline.median_views` | Client's typical — useful threshold |
| `baseline.p10_views` | Client's bottom 10% — peer threshold |
| `client.language` | From `clients.language` |
| `competitor.language` | From Gemini's response |

**Scoring formula:**
```
performance_score:
  avg_views >= p90_views     → 100
  avg_views >= median_views  → 75
  avg_views >= p10_views     → 40
  avg_views >= 1000          → 20
  else                       → 5

language_bonus:
  same language as client    → 10
  different language         → 0

composite_score = round(relevance_score * 0.50 + performance_score * 0.40 + language_bonus * 1.0)
```

**Tiering:**
```
composite >= 80 AND avg_views >= median_views  → Tier 1 BLUEPRINT
composite >= 60 AND avg_views >= p10_views     → Tier 2 STRONG
relevance >= 60 AND avg_views >= 1000          → Tier 3 PEER
else                                           → Tier 4 SKIP
```

Source: `backend/services/competitor_scoring.py`

### Step 6 — Save to Supabase

Upserted into `competitors` table on `UNIQUE (client_id, username)`. If the account already exists, it gets updated with fresh scores.

**Job result stored in `background_jobs.result`:**
```json
{
  "pipeline": "competitor_discovery",
  "phase": "completed",
  "apify": {
    "search_actor": "DrF9mzPPEuVizVF4l",
    "reel_actor": "xMc5Ga1oCONPmWJIa",
    "reference": "services/apify.py"
  },
  "openrouter_model": "google/gemini-2.0-flash-001",
  "keywords_planned": ["leadership coach", "toxic workplace"],
  "keyword_runs": [
    {
      "keyword": "leadership coach",
      "apify_search_input": {"search": "leadership coach", "searchType": "user", "resultsLimit": 30},
      "accounts_returned_this_keyword": 10,
      "unique_accounts_merged_so_far": 10
    }
  ],
  "accounts_discovered": 10,
  "evaluated": 8,
  "competitors_saved": 4,
  "cost_usd_approx": 0.008
}
```

---

## Pipeline 2: Client Baseline Scrape

**Job type:** `baseline_scrape`
**Source:** `backend/jobs/baseline_scrape.py` (Python port of baseline logic in `scripts/competitor-eval.js`)
**Triggered by:** `POST /api/v1/clients/{slug}/baseline/refresh`

### Step 1 — Scrape client's own reels

**Actor:** `xMc5Ga1oCONPmWJIa` (Instagram Reel Scraper)

**Input:**
```json
{
  "username": ["connygfrerer"],
  "resultsLimit": 30
}
```

The username comes from `clients.instagram_handle` with `@` stripped.

### Step 2 — Filter to videos with views

Only keeps items where:
- `type` is `"Video"` or `"GraphVideo"`
- `videoViewCount > 0`

Images, carousels, and posts without view data are discarded.

### Step 3 — Compute statistics

From the filtered views array:
```
avg_views      = mean(views)
median_views   = sorted[len/2]
max_views      = max(views)
p90_views      = sorted[len * 0.9]   ← blueprint threshold
p10_views      = sorted[len * 0.1]   ← peer threshold
avg_likes      = mean(likes)
reels_analyzed = count
```

### Step 4 — Save with expiry

Inserted into `client_baselines` with:
- `scraped_at = now()`
- `expires_at = scraped_at + 7 days`

The API and worker always check expiry before using a baseline. Stale baselines are treated as missing.

**Job result:**
```json
{
  "pipeline": "baseline_scrape",
  "apify": {
    "reel_actor": "xMc5Ga1oCONPmWJIa",
    "input": {
      "username": ["connygfrerer"],
      "resultsLimit": 30
    }
  },
  "reels_analyzed": 28,
  "median_views": 9254,
  "avg_views": 138966
}
```

---

## Pipeline 3: Profile Scrape (competitor reels + outlier detection)

**Job type:** `profile_scrape`
**Source:** `backend/jobs/profile_scrape.py`
**Triggered by:** `POST /api/v1/clients/{slug}/reels/scrape` or `POST /api/v1/cron/scrape-cycle`

### Step 1 — Select competitors to scrape

The scrape endpoint / cron queries:
```sql
SELECT * FROM competitors
WHERE client_id = ?
  AND tier IN (1, 2, 3)
  AND (last_scraped_at IS NULL OR last_scraped_at < now() - interval '7 days')
```

One `profile_scrape` job is queued per stale competitor. Fresh competitors are skipped entirely.

### Step 2 — Scrape competitor's reels

**Actor:** `xMc5Ga1oCONPmWJIa` (Instagram Reel Scraper)

**Input:**
```json
{
  "username": ["thebigapplered"],
  "resultsLimit": 30
}
```

### Step 3 — Compute outlier ratio per reel

For each reel:
```
outlier_ratio = reel.views / competitor.avg_views
is_outlier    = outlier_ratio >= client.outlier_ratio_threshold
```

The threshold comes from `clients.outlier_ratio_threshold` (default 10.0), making it configurable per client.

**Outlier scale:**
| Ratio | Meaning |
|---|---|
| 1.0 | Typical post for that account |
| 5.0 | Strong post |
| 10.0+ | Outlier — study this |
| 50.0+ | Viral breakout — highest priority |

### Step 4 — Batch upsert with deduplication

Uses the `upsert_scraped_reels_batch()` Postgres RPC function.

For each reel:
- **New reel** (post_url not in DB): full INSERT with generated `srl_` prefixed ID
- **Existing reel** (post_url already in DB): UPDATE only if metrics changed:
  ```sql
  ON CONFLICT (client_id, post_url) DO UPDATE SET
    views = EXCLUDED.views,
    likes = EXCLUDED.likes,
    ...
    last_updated_at = now()
  WHERE scraped_reels.views IS DISTINCT FROM EXCLUDED.views
     OR scraped_reels.likes IS DISTINCT FROM EXCLUDED.likes
     OR ...
  ```
  If nothing changed, no write happens.

After all reels for a competitor are saved, `competitors.last_scraped_at` is set to `now()`. Next cron cycle skips this competitor for 7 days.

---

## Cron deduplication summary

When running on a schedule, three layers prevent wasted work:

| Layer | What it skips | Savings |
|---|---|---|
| **Competitor staleness** | Skip competitors scraped within 7 days | ~0% Apify cost for fresh accounts |
| **Tier filtering** | Never scrape tier 4 (SKIP) | Eliminates irrelevant accounts entirely |
| **Reel-level dedup** | Skip DB writes for unchanged metrics | ~80-90% fewer writes after first scrape |

At 100 clients with 10 competitors each:
- Without dedup: 1,000 scrapes, 30,000 reel inserts per cycle
- With dedup: ~600 scrapes (fresh ones skipped), ~3,000 new reel inserts + ~8,000 metric updates + ~7,000 no-ops

---

## Data field mapping: Apify → Supabase

### From Instagram User Search → `competitors`

| Apify field | DB column |
|---|---|
| `username` | `username` |
| `biography` | sent to Gemini (not stored directly) |
| `followersCount` | `followers` |
| computed from posts | `avg_views`, `avg_likes` |
| from Gemini response | `relevance_score`, `content_style`, `topics`, `language`, `reasoning` |
| from scoring formula | `performance_score`, `language_bonus`, `composite_score`, `tier`, `tier_label` |

### From Instagram Reel Scraper → `scraped_reels`

| Apify field | DB column |
|---|---|
| `url` | `post_url` |
| `displayUrl` or `thumbnailUrl` | `thumbnail_url` |
| `videoViewCount` or `playsCount` | `views` |
| `likesCount` | `likes` |
| `commentsCount` | `comments` |
| `caption` (string or `{text}`) | `caption` |
| first line of caption | `hook_text` |
| `timestamp` | `posted_at` |
| `type` ("Video"/"GraphVideo") | `format` → "reel" |
| computed: `views / competitor.avg_views` | `outlier_ratio` |
| computed: `ratio >= threshold` | `is_outlier` |

### From Instagram Reel Scraper → `client_baselines`

| Apify field | DB column |
|---|---|
| all `videoViewCount` values | `avg_views`, `median_views`, `max_views`, `p90_views`, `p10_views` |
| all `likesCount` values | `avg_likes` |
| count of video posts | `reels_analyzed` |
