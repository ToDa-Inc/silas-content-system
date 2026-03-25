# Intelligence Feature — Development Guide

How the intelligence page should be built, maintained, and extended. This is the single source of truth for anyone working on this feature. If code contradicts this guide, the code is wrong.

**Last updated:** 2026-03-25

---

## Core Principles

### 1. Build for content creators, not data scientists
Users are creators who want to see reels and spot patterns. They don't care about composite scores, tier classifications, or discovery funnels. Every UI element should answer a simple question a creator would ask.

### 2. Simplicity over completeness
If a feature requires more than one new table, pause and ask if there's a simpler version that delivers 80% of the value. Ship that first.

### 3. No premature optimization
Don't build tiering systems, scraping frequency algorithms, or cost optimization until there's an actual cost problem. Optimize when data proves it's needed, not when imagination says it might be.

### 4. One way to do each thing
One execution model for jobs (not both inline AND background). One analysis approach (not Node AND Python). One path from data to UI.

### 5. Planning ≠ progress
A 400-line spec with no implementation is worse than a 40-line spec with working code. Write specs only when there's genuine ambiguity. If you can explain it in a Slack message, don't write a doc.

### 6. Invest proportionally to usage frequency
Features used daily get the most polish. Features used once at setup get the simplest possible implementation. Never over-engineer a one-time workflow.

---

## Language Rules

The intelligence page is for humans, not engineers. Use plain language everywhere — in the UI, in API responses, in code comments, in docs.

| Do NOT use | Use instead |
|---|---|
| Baseline | Your stats / Your performance |
| Median | Average |
| Outlier | Breakout reel / Top performer |
| Outlier ratio | "12x their average" or "Growth vs average" |
| Discovery | Find competitors / Search |
| Tier 1-4 | Remove. No user-facing tiers. |
| Composite score | Remove. No user-facing scores. |
| Scrape / Crawl | Sync |
| Pipeline | Remove. Don't expose implementation language. |

When displaying metrics, always include the context window: "Average views (last 30 reels)" not just "Average views."

---

## How Content Strategists Actually Work

This is the real-world usage pattern that drives every design decision. Build for this, not for imagined workflows.

### Daily (the core habit — THIS is where 90% of the value lives)
- "How did my reel from yesterday do? Is it still growing?"
- "Did any competitor post something that's blowing up?"
- Quick glance at numbers: am I trending up or down?

### Weekly (content planning session)
- "What were the best-performing competitor reels this week?"
- "What hooks/topics are working right now?"
- "What should I create next?"
- "How did my content do this week vs last week?"

### Monthly (maintenance)
- "Should I add new competitors? Remove inactive ones?"
- "Is there a new trend in my niche I'm missing?"

### Once at onboarding (setup)
- "Who are my competitors?"
- "What does this niche look like?"
- "What kind of content works here?"

### Priority matrix

| Priority | Feature | Usage | Engineering investment |
|---|---|---|---|
| **#1** | Your reel performance + growth tracking | Daily | High — make this excellent |
| **#2** | Competitor breakout alerts | Daily | High — this is what makes people come back |
| **#3** | Reel analysis (why did this work?) | 2-5x/week | Medium — already mostly built |
| **#4** | Week-over-week comparison | Weekly | Medium — enabled by snapshots |
| **#5** | Competitor management (add/remove) | Monthly | Low — paste a handle, done |
| **#6** | Topic search (find creators in niche) | Onboarding + rarely | Low — simple search, don't overthink |

**The rule:** Never spend more engineering effort on feature #6 than on feature #1. The topic search got a 385-line spec. The daily monitoring dashboard deserves 10x that attention.

---

## The Four Reel Sources

Every reel in the system comes from exactly one of these sources. If something doesn't fit, it probably doesn't belong.

### 1. Your Reels (daily value)
Reels scraped from the client's own Instagram profile. Shows their own content performance.

- **Sync action:** Pulls latest reels from the client's Instagram handle
- **Metrics:** Views, likes, comments + average views (last 30 reels)
- **Growth tracking:** Snapshots on each sync show metric changes over time
- **Analysis:** Optional — user can trigger AI analysis on any of their own reels

### 2. Competitor Reels (daily value)
Reels scraped from accounts the user has added as competitors.

- **Adding competitors:** Paste an Instagram handle. That's the primary flow. Keyword search is a convenience, not the main path.
- **Sync action:** Pulls latest reels from all competitor profiles
- **Breakout detection:** Flag reels performing significantly above that account's average (e.g., 10x+ their typical views)
- **Growth tracking:** Same snapshot system as own reels
- **Analysis:** Optional — user can trigger AI analysis on any competitor reel, especially breakout reels

### 3. Topic Search (onboarding + occasional)
Search Instagram for reels about a topic. Used to find creators in a niche, not as a daily tool.

- **Action:** User types a topic (e.g., "toxic workplace") → system searches for reels about that topic
- **Data returned:** Reel URLs + account names grouped by account, sorted by frequency (how many reels each account posted about the topic)
- **No engagement metrics** from the search itself — this is a limitation of the actor
- **Primary value:** Discovering accounts to add as competitors, not browsing individual reels
- **User flow:** Search → see accounts → add interesting ones as competitors → those accounts get synced with full metrics going forward
- **Nothing is lost:** Raw search results stored for reference, but don't over-invest in enriching them
- **Build it simple:** One search input, results grouped by account, "Add as competitor" button per account. That's it.

### 4. Manual Analysis (as needed)
User pastes any Instagram reel URL → system fetches data + runs AI analysis.

- **Action:** Paste URL → get reel data + Silas analysis
- **Storage:** Saved to scraped_reels + reel_analyses for future reference
- **Use case:** "I saw this reel, tell me why it worked"

---

## Sync Logic

### How sync works
"Sync" replaces the scattered "Refresh baseline" + per-competitor "Scrape reels" buttons. One concept, one action.

**User-facing:** A single "Sync" button that updates everything (own reels + all competitor reels). The default should be "sync all." Syncing individual sources (just your reels, just competitors) can exist as a secondary option but shouldn't be the primary flow.

**Backend logic:**
1. Scrape the client's own Instagram profile → upsert own reels
2. For each competitor, scrape their profile → upsert their reels
3. Detect breakout reels (views significantly above account average)
4. Save metric snapshots for historical tracking

**Automated sync:** Cron job runs daily. Same logic as manual sync. No user action required. The manual "Sync" button is for when users want fresh data right now.

### Upsert rules
- Same reel (matched by `post_url` or Instagram shortcode) → **update metrics only** (views, likes, comments)
- Do NOT re-run AI analysis on existing reels. Analysis is triggered manually or for new reels only.
- Before updating metrics, insert a snapshot row for historical tracking.

---

## Historical Tracking (Growth Data)

### The table
One append-only table that stores a metric snapshot every time a reel is synced.

```sql
CREATE TABLE reel_snapshots (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    reel_id uuid REFERENCES scraped_reels(id) ON DELETE CASCADE,
    views bigint,
    likes bigint,
    comments bigint,
    scraped_at timestamptz DEFAULT now()
);

CREATE INDEX idx_reel_snapshots_reel_date ON reel_snapshots (reel_id, scraped_at DESC);
```

### How it works
Every sync cycle, for each reel being updated:
1. INSERT a row into `reel_snapshots` with current metrics
2. Then UPDATE `scraped_reels` with new metrics

### What it enables
- "This reel gained 8,200 views since yesterday"
- "Your average views this week vs last week"
- "This competitor's last 5 reels are trending up"
- Sparkline charts showing metric growth over time

### Data volume
500 reels × daily sync = 15K rows/month per client. Postgres handles millions of rows fine. No external service needed. Add a retention policy (e.g., keep daily snapshots for 90 days, then aggregate to weekly) only if storage becomes a concern — which it won't for a long time.

---

## Frontend Structure

The page is organized by **what the user needs when they open it**, not by data source. Top = most frequent need, bottom = occasional tools.

### 1. What Happened (top of page — the daily hook)
This is what makes users come back. Show changes since their last visit.
- New breakout reels from competitors (e.g., "3 new breakout reels since yesterday")
- Your reel growth highlights (e.g., "Your reel from March 20 gained 5.2K views")
- Notable changes (e.g., "competitor X posted 4 new reels")

If there's nothing new, show a clean "Everything's up to date" state. Don't fill it with noise.

### 2. Your Performance (summary bar)
- Average views (last 30 reels)
- Average likes (last 30 reels)
- Total reels synced
- Growth indicator vs previous period (e.g., "↑ 12% vs last week")

### 3. Your Reels
- Grid/list of your latest reels
- Each reel shows: thumbnail, views, likes, comments, date posted
- Growth badge if snapshot data shows significant change since last sync (e.g., "+2.3K views")
- Click → view reel detail + optional AI analysis

### 4. Competitor Reels
- Filter/tab by competitor (or show all mixed, sorted by recent)
- Each reel shows: thumbnail, account name, views, likes, breakout badge
- Breakout reels visually highlighted (e.g., "15x their average")
- Click → view reel detail + optional AI analysis

### 5. Tools (bottom — occasional use)
- **Add competitor:** Paste handle input
- **Search topics:** Keyword search for niche exploration (results grouped by account, "Add as competitor" per account)
- **Analyze a reel:** Paste URL input

### Header actions
- **Sync button** (primary) — syncs everything
- **Add competitor** (secondary) — quick add

---

## Backend Endpoint Map (Target State)

Keep endpoints minimal and intuitive.

| Method | Path | What it does |
|---|---|---|
| POST | `/clients/{slug}/sync` | Sync all (own reels + competitor reels). Returns job ID. |
| POST | `/clients/{slug}/sync/own` | Sync own reels only. Returns job ID. |
| POST | `/clients/{slug}/sync/competitors` | Sync all competitor reels. Returns job ID. |
| GET | `/clients/{slug}/reels` | List reels. Filters: `source` (own/competitor/manual), `competitor_id`, `breakout_only` |
| GET | `/clients/{slug}/reels/{id}` | Single reel with full metrics + snapshot history |
| GET | `/clients/{slug}/reels/{id}/analysis` | AI analysis for a reel |
| POST | `/clients/{slug}/reels/analyze` | Analyze a reel (by ID or by URL). Returns job ID. |
| GET | `/clients/{slug}/competitors` | List competitors |
| POST | `/clients/{slug}/competitors` | Add a competitor (by handle) |
| DELETE | `/clients/{slug}/competitors/{id}` | Remove a competitor |
| POST | `/clients/{slug}/search/topics` | Search reels by topic keyword. Returns accounts grouped by frequency. |
| GET | `/clients/{slug}/stats` | Summary stats (avg views, growth, reel count) with period comparison |
| GET | `/clients/{slug}/activity` | "What happened since last visit" — new breakouts, growth highlights, new reels |
| GET | `/jobs/{id}` | Poll job status |

14 endpoints total.

---

## What NOT to Build (Until Proven Needed)

| Feature | Why not now |
|---|---|
| Tier classification (1-4) | No cost problem yet. Scrape everyone. Add tiers only when Apify costs justify it. |
| Composite scoring formula | Users don't see or care about `relevance * 0.50 + performance * 0.40`. Show reels, not scores. |
| Multi-strategy discovery (A/B/C/D) | One keyword search + manual add covers 95% of needs. Add strategies when users complain about competitor quality. |
| Dual execution (inline + worker) | Pick one model per operation. Sync = background job. Analysis = background job. Don't mix. |
| Keyword taxonomy (identity/topic/hashtag) | Users type keywords. The system searches. Don't force users to categorize their keywords. |
| Bulk auto-analysis on sync | Only analyze when user requests it. AI analysis should be intentional, not automatic. Saves cost, reduces noise. |
| niche_patterns / trend aggregation | Build the basics first. Pattern detection is a Phase 3 feature at earliest. |
| Trending reel enrichment pipeline | Don't batch-scrape 335 reel URLs for metrics. Let users add accounts as competitors instead — that's where metrics come from. |
| Elaborate topic search UI | Topic search is used at onboarding + monthly. A search input + account list + "Add as competitor" button is enough. No filters, no sorting, no pagination needed in v1. |

---

## Adding New Features — Checklist

Before building anything new for the intelligence page, answer these:

1. **How often will users use this?** Daily → invest heavily. Monthly → build it simple. Once → make it functional, nothing more.
2. **Can it be described in one sentence?** If you need a paragraph, it's too complex.
3. **Does it fit into one of the four reel sources?** If not, question whether it belongs on the intelligence page.
4. **Can it be done with existing tables?** If it needs more than one new table, simplify.
5. **Is there a simpler version that delivers 80% of the value?** Build that version.
6. **Will the user understand the UI without explanation?** If it needs a tooltip or onboarding, simplify the concept.
7. **Am I writing more docs than code?** If yes, stop writing and start building.

---

## Decisions Log

Track key decisions here so future developers know WHY, not just WHAT.

| Date | Decision | Why |
|---|---|---|
| 2026-03-25 | No tier system for competitors | Not enough clients to justify cost optimization. Scrape all. |
| 2026-03-25 | Average instead of median for user-facing stats | Users understand "average." Median is technically better but jargon. |
| 2026-03-25 | Manual competitor add as primary flow | Users know their competitors. Automated search is secondary. |
| 2026-03-25 | Snapshots for historical tracking | One table, no external services. Enables growth metrics daily. |
| 2026-03-25 | Analysis only on user request | No auto-analysis on sync. Saves cost, keeps analysis intentional. |
| 2026-03-25 | Single sync action | Replaces scattered "refresh baseline" + per-competitor scrape buttons. |
| 2026-03-25 | Topic search is a tool, not the main feature | Used at onboarding + monthly. Don't over-invest. Simple search → account list → add as competitor. |
| 2026-03-25 | No trending reel enrichment | Don't batch-scrape topic search results for metrics. Let users add accounts as competitors for full data. |
| 2026-03-25 | Page organized by frequency, not data source | Top = daily monitoring (what happened, your reels, competitor breakouts). Bottom = occasional tools (search, analyze). |
| 2026-03-25 | "What happened" section at the top | The daily hook. New breakout reels, growth highlights, new activity. This is what makes users come back. |
