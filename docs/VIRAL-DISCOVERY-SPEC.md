# Viral Discovery — Finding Outlier Reels by Topic

How to find viral reels in a client's niche **regardless of whether the creator is a known competitor**. This is a supplementary discovery mechanism alongside the existing competitor-based pipeline.

**Last updated:** 2026-03-25

---

## The question

> "Can we find viral reels about a topic (e.g., toxic workplace, boundaries at work) directly — without first discovering competitors?"

**Short answer:** Yes — using keyword reel search (`4QFjEpnGE1PNEnQF2`) which returns actual reel URLs + usernames for topic keywords. This gives us two things at once: **direct reel discovery** AND **content-based account discovery**.

---

## What we tested (2026-03-25) — 8 actors

| # | Actor ID | Name | Input | Result | Verdict |
|---|---|---|---|---|---|
| 1 | `TxU0ZBQIHdR20dr9C` | Keyword Reel Search (patient_discovery) | "toxic workplace" | 12 random explore reels, zero relevance | ❌ Garbage |
| 2 | `reGe1ST3OBgYZSsZJ` | Official Hashtag Scraper | 5 niche hashtags | 135 items, 99% images, no reels | ⚠️ Account discovery only |
| 3 | `cHedUknx10dsaavpI` | Hashtag Analytics (official) | 3 hashtags | Metadata only (post counts, related tags) | ❌ No content |
| 4 | `OQkrGAtl0AfRFKnJr` | Keyword Search (crawlerbros) | "toxic workplace reels" | 0 results (needs cookies) | ❌ Empty |
| 5 | `culc72xb7MP3EbaeX` | apidojo PPR | tag URLs | 10 empty `noResults` items | ❌ Broken |
| 6 | `RB9HEZitC8hIUXAha` | Official API Scraper | hashtag search | 1 error item | ❌ Broken |
| 7 | `n1AtybM4tQM9yvHde` | api-ninja All-in-One | tag URLs | 60 items, images only, no engagement | ⚠️ Images only |
| **8** | **`4QFjEpnGE1PNEnQF2`** | **Sasky Keyword Reels URLs** | **"toxic workplace"** | **335 REELS, 186 accounts, niche-relevant** | **✅ WORKS** |

---

## The winner: Sasky Keyword Reels URLs Scraper

**Actor:** `4QFjEpnGE1PNEnQF2`
**Author:** sasky (15 monthly users, 85 total)
**What it does:** Searches Instagram's reel/clip search and returns reel URLs + usernames

### Test results for "toxic workplace"

```
Total reels found:    335
Unique accounts:      186
Accounts with 4+ reels: 11  (dedicated niche creators)
Accounts with 2-3 reels: 62  (active in niche)
Accounts with 1 reel:   111 (occasional)
```

### Top accounts discovered (sorted by reel count)

| Account | Reels found | Likely niche |
|---|---|---|
| `@yourbipoctherapist` | 14 | Workplace trauma therapist |
| `@thechildressfirm` | 10 | Employment law |
| `@corporate_warriors` | 7 | Corporate culture humor/education |
| `@byebossofficial` | 6 | Quitting toxic jobs content |
| `@civilitypartners` | 5 | Workplace civility consulting |
| `@hrmanifesto` | 5 | HR/workplace culture |
| `@nisarlaw` | 4 | Employment law |
| `@tigersisterspodcast` | 4 | Workplace empowerment |
| `@ccjenniferbrick` | 3 | Toxic job recovery coaching |
| `@bossbabesofsouthafrica` | 3 | Women's workplace empowerment |
| `@lynda.leads` | 3 | Workplace leadership |

**These are real niche creators** that bio keyword search would NEVER find. `@byebossofficial`, `@hrmanifesto`, `@corporate_warriors` — none of these would show up by searching for "leadership coach" in bios.

### What the actor returns

```json
{
    "user_name": "ccjenniferbrick",
    "user_link": "https://www.instagram.com/ccjenniferbrick/",
    "keyword": "toxic workplace",
    "reel_url": "https://www.instagram.com/reel/DWPjB9FCj7u/"
}
```

**Lightweight data** — no views, likes, or engagement metrics. Just the reel URL and who posted it. This means we need a second step to get engagement data.

### What it uses under the hood

This actor taps into Instagram's private `clips/search` endpoint which actually searches REEL CONTENT (captions, audio, topic tags) — not bios. This is why topic keywords work here but fail in user search.

---

## The pipeline: Keyword → Reels + Accounts → Enrichment

### Two complementary pipelines from the same data

```
┌──────────────────────────────────────────────────────────┐
│  KEYWORD REEL SEARCH                                      │
│  Actor: 4QFjEpnGE1PNEnQF2 (sasky)                       │
│  Input: topic keywords from niche_config                  │
│  Output: reel URLs + usernames (335 results/keyword)      │
└──────────────────┬───────────────────────────────────────┘
                   │
         ┌─────────┴──────────┐
         ▼                    ▼
┌─────────────────┐  ┌──────────────────────────┐
│ PIPELINE A:     │  │ PIPELINE B:              │
│ ACCOUNT         │  │ DIRECT REEL              │
│ DISCOVERY       │  │ ENRICHMENT               │
│                 │  │                          │
│ Aggregate by    │  │ Take top reel URLs       │
│ username        │  │ Scrape individually      │
│ (frequency =    │  │ to get views/likes       │
│ niche signal)   │  │ Rank by engagement       │
│ Feed into       │  │ = viral niche reels      │
│ competitor      │  │ (regardless of who       │
│ pipeline        │  │ posted them)             │
└────────┬────────┘  └────────────┬─────────────┘
         │                       │
         ▼                       ▼
  Competitor table         scraped_reels table
  (new competitors         (viral reels from
  with source =            non-competitor
  'keyword_reels')         accounts too)
```

### Pipeline A: Account Discovery (primary use)

Same goal as hashtag discovery but much better data: we know these accounts post **reels** about the topic (not just images).

```python
async def run_keyword_reel_discovery(supabase, job):
    config = job["payload"]
    client = fetch_client(supabase, config["client_id"])
    baseline = fetch_latest_baseline(supabase, config["client_id"])

    # Step 1: Collect topic keywords from niche config
    keywords = config.get("keywords") or collect_topic_keywords(client)
    # Use the topic keywords (content-based), NOT identity keywords (bio-based)
    # "toxic workplace", "boundaries at work" — these WORK for reel search

    all_reels = []
    for keyword in keywords:
        result = await run_apify_actor(
            actor_id="4QFjEpnGE1PNEnQF2",
            input={"keyword": keyword, "maxItems": 100}
        )
        all_reels.extend(result)

    # Step 2: Aggregate by account
    accounts = {}
    for reel in all_reels:
        username = reel.get("user_name", "").strip()
        if not username or username == client["instagram_handle"]:
            continue
        if username not in accounts:
            accounts[username] = {"reels": [], "keywords": set()}
        accounts[username]["reels"].append(reel.get("reel_url", ""))
        accounts[username]["keywords"].add(reel.get("keyword", ""))

    # Step 3: Rank by frequency (more reels about the topic = higher confidence)
    candidates = [
        (username, info) for username, info in accounts.items()
        if len(info["reels"]) >= 2  # at least 2 reels about the topic
    ]
    candidates.sort(key=lambda x: (len(x[1]["keywords"]), len(x[1]["reels"])), reverse=True)

    # Step 4: Top candidates → competitor pipeline
    max_to_evaluate = config.get("max_accounts_to_evaluate", 30)
    evaluated = 0

    for username, info in candidates[:max_to_evaluate]:
        # Skip if already a competitor
        existing = supabase.table("competitors") \
            .select("id").eq("client_id", client["id"]) \
            .eq("username", username).execute()
        if existing.data:
            continue

        # Scrape their profile + recent reels for AI evaluation
        profile_data = await scrape_account_profile(username)
        # profile_data includes bio, followers, and latestPosts with captions

        # AI relevance evaluation (reuse existing)
        relevance = await analyze_relevance(
            account=profile_data,
            niche_profile=build_niche_profile(client),
        )
        if relevance["relevance_score"] < 60:
            continue

        # Score and tier
        scored = evaluate_competitor(
            discovery={"avgViews": profile_data.get("avgViews", 0), "relevance": relevance},
            baseline=baseline,
            client_lang=client.get("language", "en"),
        )

        upsert_competitor(supabase, client["id"], {
            "username": username,
            "source": "keyword_reels",
            **relevance, **scored,
        })
        evaluated += 1

    return {
        "total_reels": len(all_reels),
        "unique_accounts": len(accounts),
        "candidates_2plus": len(candidates),
        "evaluated": evaluated,
    }
```

### Pipeline B: Direct Viral Reel Discovery (future enhancement)

For finding individual viral reels regardless of whether the account is a known competitor:

1. Take reel URLs from the keyword search
2. Batch scrape them to get views, likes, shares (using the existing reel scraper by feeding individual URLs)
3. Rank by engagement metrics
4. Store top-performing reels in `scraped_reels` with `source = 'keyword_search'`
5. Surface on dashboard as "Trending in your niche" section

**Status:** Not yet implemented. Requires a way to batch-scrape individual reel URLs for engagement data. The existing reel scraper (`xMc5Ga1oCONPmWJIa`) works per-account, not per-URL. May need a different actor for this.

---

## Topic keywords vs. identity keywords — the complete map

```
                        ┌──────────────────────────┐
                        │    KEYWORD TYPES          │
                        └──────────┬───────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
     IDENTITY KEYWORDS      TOPIC KEYWORDS       TOPIC HASHTAGS
     (bio search)           (reel search)        (hashtag pages)
     ──────────────         ─────────────        ──────────────
     "leadership coach"     "toxic workplace"    #toxicworkplace
     "career strategist"    "boundaries at work" #boundariesatwork
     "Führungskräfte Coach" "difficult boss"     #workplacebullying

     Actor:                 Actor:               Actor:
     DrF9mzPPEuVizVF4l      4QFjEpnGE1PNEnQF2   reGe1ST3OBgYZSsZJ

     Matches: BIOS          Matches: REEL        Matches: POST
                            CONTENT              TAGS

     Returns: Account       Returns: Reel URLs   Returns: Recent
     profiles with bio      + usernames          posts (mostly
     + latestPosts          (no metrics)         images)

     Best for:              Best for:            Best for:
     Obvious competitors    Hidden competitors   Supplementary
     with pro bios          who make reels       account discovery
                            about the topic

     Quality: ★★★           Quality: ★★★★        Quality: ★★
     (sparse results        (335 reels,          (mostly images,
     for niche topics)      niche-relevant)      no reels)
```

**The discovery system should use all three:**
1. Identity keywords (Strategy A) — finds the "obvious" competitors
2. Keyword reel search (Strategy D — this doc) — finds accounts by their reel content
3. Hashtag scraping (Strategy C) — supplementary, catches accounts using niche hashtags
4. Seed competitors (Strategy B) — manual/AI-suggested known accounts

---

## Recommended discovery flow (updated)

```
Onboarding: Baseline + Auto-Profile (parallel)
    │
    ▼
Discovery round 1: Strategy A (identity keywords) + Strategy B (seeds)
    │   Fast, cheap. Gets the obvious competitors.
    ▼
Discovery round 2: Strategy D (keyword reel search) ← NEW, BEST SIGNAL
    │   Uses topic keywords. Finds hidden competitors by reel content.
    │   335 reels → 186 accounts → top 30 evaluated → ~10-15 new competitors
    ▼
Optional round 3: Strategy C (hashtag pages)
    │   Supplementary. Catches any remaining accounts using niche hashtags.
    ▼
Merge + deduplicate → Reel scrape tiers 1-3 → Outlier detection
```

---

## niche_config schema (updated)

Each niche now needs THREE keyword types:

```json
{
    "id": "workplace-communication",
    "name": "Workplace Communication",
    "description": "...",
    "keywords": ["leadership coach", "workplace coach", "career strategist"],
    "keywords_de": ["Führungskräfte Coach", "Kommunikationstrainerin"],
    "topic_keywords": ["toxic workplace", "boundaries at work", "difficult boss", "workplace bullying"],
    "topic_keywords_de": ["toxischer Arbeitsplatz", "schwieriger Chef", "Mobbing am Arbeitsplatz"],
    "hashtags": ["toxicworkplace", "boundariesatwork", "toxicboss", "workplacebullying"],
    "hashtags_de": ["mobbing", "toxischerarbeitsplatz"],
    "content_angles": ["..."]
}
```

| Field | Used by | Searches against |
|---|---|---|
| `keywords` / `keywords_de` | Strategy A (user search) | Instagram bios |
| `topic_keywords` / `topic_keywords_de` | Strategy D (keyword reel search) | Reel content/captions |
| `hashtags` / `hashtags_de` | Strategy C (hashtag pages) | Post hashtags |

The AI auto-profiler must generate all three types.

---

## Cost estimate

| Component | Unit cost | Per client |
|---|---|---|
| Keyword reel search (5 keywords × ~335 results) | Compute-based (~$0.10/run) | ~$0.50 |
| Profile enrichment (top 30 candidates) | ~$0.05 per account | ~$1.50 |
| AI evaluation (30 candidates) | ~$0.001 per call | ~$0.03 |
| **Total per client** | | **~$2.03** |

Cheaper than the hashtag approach and produces MUCH better data (actual reels, not images).

---

## Schema changes needed

### `niche_config` — new fields
```json
{
    "topic_keywords": ["toxic workplace", "boundaries at work"],
    "topic_keywords_de": ["toxischer Arbeitsplatz", "Mobbing"],
    "hashtags": ["toxicworkplace", "boundariesatwork"],
    "hashtags_de": ["mobbing", "toxischerarbeitsplatz"]
}
```

### `competitors` table — source tracking
```sql
ALTER TABLE competitors ADD COLUMN IF NOT EXISTS
    source text DEFAULT 'keyword_search';
-- Values: 'keyword_search', 'seed', 'keyword_reels', 'hashtag_discovery'
```

### New job types
```python
JOB_HANDLERS = {
    ...
    "keyword_reel_discovery": run_keyword_reel_discovery,  # NEW — Strategy D
    "hashtag_discovery": run_hashtag_discovery,             # NEW — Strategy C
}
```

---

## What does NOT work (tested, avoid)

| Actor ID | Name | Why it fails |
|---|---|---|
| `TxU0ZBQIHdR20dr9C` | Keyword Reel Search (patient_discovery) | Returns random explore feed. Same 12 reels regardless of keyword. |
| `cHedUknx10dsaavpI` | Hashtag Analytics (official) | Returns metadata only (post counts). No actual content. |
| `OQkrGAtl0AfRFKnJr` | Keyword Search (crawlerbros) | Returns 0 results without cookies/auth. |
| `culc72xb7MP3EbaeX` | apidojo PPR | Returns empty `noResults` for hashtag URLs. |
| `RB9HEZitC8hIUXAha` | Official API Scraper | Returns error for hashtag search input. |
| `VLKR1emKm1YGLmiuZ` | apidojo Fast | Returns `demo` placeholder data only. |
| `reGe1ST3OBgYZSsZJ` | Official Hashtag Scraper | Works but returns 99% images, <1% reels. Only useful for account aggregation. |
| `n1AtybM4tQM9yvHde` | api-ninja All-in-One | Returns 60 items but images only, no engagement data, no usernames. |

---

## Implementation reference

| What | Where |
|---|---|
| This spec | `docs/VIRAL-DISCOVERY-SPEC.md` |
| Keyword reel search actor | `4QFjEpnGE1PNEnQF2` on Apify (sasky) |
| Existing competitor discovery | `backend/jobs/competitor_discovery.py` |
| AI evaluation logic | `backend/services/openrouter.py` |
| Competitor scoring | `backend/services/competitor_scoring.py` |
| Auto-profiler spec | [docs/AUTO-PROFILE-SPEC.md](./AUTO-PROFILE-SPEC.md) |
| Discovery strategy overview | [docs/COMPETITOR-DISCOVERY-LOGIC.md](./COMPETITOR-DISCOVERY-LOGIC.md) |
| Apify actor details | [docs/SCRAPING-REFERENCE.md](./SCRAPING-REFERENCE.md) |
