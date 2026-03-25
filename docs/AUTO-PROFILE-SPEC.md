# Auto-Profile Spec — From Instagram Handle to Full Client Profile

When a new client is onboarded with just a name + Instagram handle, the system must automatically build the rich `niche_config`, `icp`, and keyword set needed for competitor discovery — without manual input.

**Last updated:** 2026-03-24

---

## The problem

Competitor discovery requires:
- `niche_config` with identity keywords (what similar creators call themselves in their bios)
- `icp` (target audience, pain points, desires)
- Optionally: `competitor_seeds` (known competitor accounts)

But at onboarding, the user provides only:
- Creator name
- Instagram handle
- Language
- Optionally: a vague niche summary + comma-separated keywords

The gap between "vague onboarding input" and "rich discovery context" is what auto-profiling fills.

---

## Required execution order

```
User creates client with Instagram handle
         │
         ├──→ [PARALLEL A] Scrape client's 30 reels → compute baseline stats
         │                  (saves to client_baselines)
         │                  ALSO: store individual reels in scraped_reels
         │                  with competitor_id = NULL (client's own reels)
         │
         └──→ [PARALLEL B] AI auto-profile from scraped captions + bio
                           (generates niche_config, icp, keywords, seeds)
                           (saves to clients via UPDATE)
         │
         ▼
    WAIT for both A and B to complete
         │
         ▼
    [AUTO] Run competitor discovery
           (baseline exists → full scoring + tiering)
           (rich keywords exist → good search results)
         │
         ▼
    Dashboard shows: baseline stats, own reels, competitors with tiers
```

**Critical:** Baseline (A) MUST complete before discovery runs, otherwise competitors get no tier and are never scraped for reels. Auto-profile (B) MUST complete before discovery runs, otherwise keywords are empty/garbage.

---

## Job type: `client_auto_profile`

New background job that runs the AI profiling step.

**Input:** `client_id` (Instagram handle comes from the client row)

**Steps:**

### Step 1 — Scrape client's reels (reuse existing actor call)

Same as baseline scrape — may already be running in parallel. If baseline job already completed, read captions from `scraped_reels` where `client_id = X AND competitor_id IS NULL`. If not, scrape independently:

```json
{
  "username": ["connygfrerer"],
  "resultsLimit": 30
}
```

Extract: captions, bio (from profile data in Apify response).

### Step 2 — AI analysis (one call)

**Model:** Same as relevance scoring — Gemini 2.0 Flash via OpenRouter (or Claude for higher quality, configurable).

**Temperature:** 0.2 (slightly creative for keyword generation, but grounded)

**Prompt:**

```
You are analyzing an Instagram creator's content to build their complete niche profile. This profile will be used to find competitor accounts via Instagram's USER SEARCH, which matches against BIOS and DISPLAY NAMES — not post content.

CREATOR INFO:
Name: {client.name}
Instagram: @{client.instagram_handle}
Language: {client.language}
Bio: "{bio from Apify}"
{If onboarding niche_summary exists: "User-provided niche hint: {niche_summary}"}

RECENT CAPTIONS ({n} reels):
1. "{caption_1[:500]}"
2. "{caption_2[:500]}"
...

---

ANALYSIS INSTRUCTIONS:

1. **Identify 1-3 content niches** this creator operates in. Each niche needs:
   - `id`: lowercase-kebab-case identifier (e.g., "workplace-communication")
   - `name`: human-readable name (e.g., "Workplace Communication")
   - `description`: 1-2 sentences explaining the niche focus
   - `content_angles`: 5 specific recurring themes/topics from the captions

2. **Generate IDENTITY KEYWORDS** — terms that SIMILAR CREATORS would put in their Instagram BIO to describe themselves.

   ✅ GOOD identity keywords (what people write in bios):
   - Job titles: "leadership coach", "career strategist", "HR consultant"
   - Role descriptions: "workplace communication trainer", "executive coach"
   - German equivalents: "Führungskräfte Coach", "Karriere Beraterin", "Kommunikationstrainerin"
   - Specialization labels: "conflict resolution expert", "team dynamics specialist"

   ❌ BAD topic keywords (what people post ABOUT — these return 0 results in user search):
   - "toxic workplace", "boundaries at work", "difficult boss"
   - "Kommunikation Arbeitsplatz", "schwierige Gespräche"
   - "narcissistic boss", "red flags at work"

   For each niche, generate:
   - `keywords`: 4-6 English identity keywords
   - `keywords_de`: 3-5 German/localized identity keywords (if client language is German)

3. **Build the ICP** (Ideal Customer Profile):
   - `target`: one sentence describing the audience
   - `age_range`: estimated (e.g., "28-45")
   - `pain_points`: 3-5 specific problems the audience has (from caption themes)
   - `desires`: 3-5 things the audience wants (from caption themes)

4. **Suggest competitor seeds** — 5-10 specific Instagram usernames of accounts that likely create similar content for a similar audience. Think of well-known educators, coaches, or creators in this exact niche. Only suggest accounts you're reasonably confident exist.

5. **Detect content style**: "educator" / "storyteller" / "motivational" / "mixed" / "entertainer"

6. **Generate topic hashtags** — hashtags that creators in this niche commonly
   use on their posts. These are the OPPOSITE of identity keywords: topic hashtags
   describe what people POST ABOUT, not what they call themselves. They will be
   used to search Instagram hashtag pages for account discovery.

   Generate:
   - `hashtags`: 8-12 English hashtags (without the # symbol)
   - `hashtags_de`: 4-6 German hashtags (if client language is German)

   ✅ GOOD topic hashtags: "toxicworkplace", "boundariesatwork", "workplacebullying",
      "difficultboss", "officepolitics", "workplaceculture", "leadershipcoach"
   ❌ BAD (too generic): "motivation", "mindset", "success", "growth"

RESPOND IN THIS EXACT JSON FORMAT (no markdown, no backticks):
{
  "niches": [
    {
      "id": "workplace-communication",
      "name": "Workplace Communication",
      "description": "How professionals handle difficult conversations and toxic dynamics at work",
      "keywords": ["leadership coach", "workplace coach", "career strategist", "executive communication trainer", "conflict resolution coach"],
      "keywords_de": ["Führungskräfte Coach", "Kommunikationstrainerin", "Karriere Coach", "Leadership Expertin"],
      "hashtags": ["toxicworkplace", "boundariesatwork", "workplacebullying", "difficultboss", "officepolitics", "workplacecommunication", "toxicboss", "workplaceculture", "careercoach"],
      "hashtags_de": ["toxischerarbeitsplatz", "mobbing", "arbeitsplatz", "führungskraft"],
      "content_angles": ["responding to difficult bosses", "setting workplace boundaries", "professional conflict resolution", "navigating office politics", "leadership communication"]
    }
  ],
  "icp": {
    "target": "Professionals dealing with difficult workplace dynamics",
    "age_range": "28-45",
    "pain_points": ["Toxic or insecure boss", "Being overlooked despite strong work", "Unable to set boundaries without conflict"],
    "desires": ["Be heard and respected at work", "Communicate with authority and calm", "Understand workplace dynamics"]
  },
  "competitor_seeds": ["thebigapplered", "corporateclarity.career", "heyworkfriend"],
  "content_style": "educator",
  "primary_language": "German",
  "confidence": "high"
}
```

### Step 3 — Update client record

Parse the AI response and update the client row:

```python
update_data = {
    "niche_config": ai_response["niches"],
    "icp": ai_response["icp"],
}

# Merge competitor_seeds into existing config or a new field
if ai_response.get("competitor_seeds"):
    update_data["competitor_seeds"] = ai_response["competitor_seeds"]

supabase.table("clients").update(update_data).eq("id", client_id).execute()
```

### Step 4 — Trigger competitor discovery

After both auto-profile and baseline are complete, queue discovery jobs automatically:

**Round 1** — `competitor_discovery` (identity keywords + seeds):
1. Process `competitor_seeds` first (direct scrape + evaluate)
2. Run identity keyword search across all niches
3. Full scoring + tiering (because baseline now exists)

**Round 2** — `hashtag_discovery` (topic hashtags):
1. Search niche hashtags from `niche_config[].hashtags`
2. Aggregate accounts by frequency across hashtags
3. Feed top candidates into AI evaluation → scoring → tiering
4. Dedup against competitors already found in Round 1

See [VIRAL-DISCOVERY-SPEC.md](./VIRAL-DISCOVERY-SPEC.md) for the full hashtag discovery pipeline.

---

## Storing client's own reels

The baseline scrape currently computes stats and discards individual reels. It must also store them:

```python
# In run_baseline_scrape, after computing stats:
for reel in filtered_reels:
    reel_row = {
        "id": generate_scraped_reel_id(),
        "client_id": client_id,
        "competitor_id": None,          # NULL = client's own reel
        "post_url": reel["url"],
        "thumbnail_url": reel.get("thumbnailUrl"),
        "views": reel["views"],
        "likes": reel["likes"],
        "comments": reel["comments"],
        "caption": reel["caption"],
        "hook_text": (reel["caption"] or "").split("\n")[0][:200],
        "posted_at": reel["timestamp"],
        "format": "reel",
        "outlier_ratio": None,          # not applicable for own reels
        "is_outlier": False,            # not applicable for own reels
    }
    # upsert on (client_id, post_url)
```

Dashboard query for the "Your Reels" section:
```sql
SELECT * FROM scraped_reels
WHERE client_id = ? AND competitor_id IS NULL
ORDER BY views DESC
```

---

## Backfilling tiers for existing competitors

If competitors already exist without tiers (from a discovery run that happened before baseline), add a backfill mechanism:

**New job type or inline function:** `backfill_competitor_tiers`

```python
def backfill_competitor_tiers(supabase, client_id: str, baseline: dict, client_lang: str):
    """Re-evaluate competitors that have relevance_score but no tier."""
    untiered = (
        supabase.table("competitors")
        .select("*")
        .eq("client_id", client_id)
        .is_("tier", "null")
        .not_.is_("relevance_score", "null")
        .execute()
    )
    for comp in untiered.data or []:
        disc = {
            "avgViews": comp["avg_views"],
            "relevance": {"relevance_score": comp["relevance_score"]},
        }
        baseline_for_eval = {
            "p90_views": baseline.get("p90_views") or 0,
            "median_views": baseline.get("median_views") or 0,
            "p10_views": baseline.get("p10_views") or 0,
        }
        scored = evaluate_competitor(disc, baseline_for_eval, client_lang)
        supabase.table("competitors").update({
            "performance_score": scored["performance_score"],
            "language_bonus": scored["language_bonus"],
            "composite_score": scored["composite_score"],
            "tier": scored["tier"],
            "tier_label": scored["tier_label"],
        }).eq("id", comp["id"]).execute()
```

**When to run:** Automatically after baseline scrape completes, if untiered competitors exist.

---

## Outlier detection checklist

For `is_outlier` to work correctly, all of these must be true:

| Requirement | How to verify |
|---|---|
| `competitors.avg_views` is populated and > 0 | `SELECT id, username, avg_views FROM competitors WHERE client_id = ? AND (avg_views IS NULL OR avg_views = 0)` — should return 0 rows |
| `clients.outlier_ratio_threshold` has a value | `SELECT outlier_ratio_threshold FROM clients WHERE id = ?` — should be 10.0 (or custom) |
| `upsert_scraped_reels_batch` computes `views / competitor.avg_views` | Check the RPC function body in SQL |
| `upsert_scraped_reels_batch` compares ratio against threshold | Check the RPC function applies `>= threshold` to set `is_outlier = true` |
| Threshold isn't too aggressive for the data | `SELECT outlier_ratio, views FROM scraped_reels WHERE client_id = ? ORDER BY outlier_ratio DESC LIMIT 20` — if max ratio < 10, consider lowering threshold to 5.0 |

**Diagnostic query:**
```sql
SELECT
    sr.post_url,
    sr.views,
    sr.outlier_ratio,
    sr.is_outlier,
    c.username AS competitor,
    c.avg_views AS competitor_avg_views,
    cl.outlier_ratio_threshold
FROM scraped_reels sr
JOIN competitors c ON c.id = sr.competitor_id
JOIN clients cl ON cl.id = sr.client_id
WHERE sr.client_id = '<CLIENT_ID>'
ORDER BY sr.outlier_ratio DESC NULLS LAST
LIMIT 20;
```

If `outlier_ratio` is NULL → the RPC isn't computing it.
If all ratios < threshold → lower the threshold or the data has no outliers yet.

---

## Full onboarding flow summary

```
┌─────────────────────────────────────────────────────┐
│  User creates client: name + @instagram + language  │
└─────────────────┬───────────────────────────────────┘
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
  ┌───────────┐      ┌──────────────┐
  │ Baseline  │      │ Auto-Profile │
  │ Scrape    │      │ (AI)         │
  │           │      │              │
  │ • 30 reels│      │ • Captions   │
  │ • Stats   │      │   → niches   │
  │ • Store   │      │   → keywords │
  │   own     │      │   → icp      │
  │   reels   │      │   → seeds    │
  └─────┬─────┘      └──────┬───────┘
        │                   │
        └─────────┬─────────┘
                  ▼
        ┌─────────────────┐
        │   Discovery     │
        │                 │
        │ 1. Process      │
        │    seeds first  │
        │ 2. Identity     │
        │    keyword      │
        │    search       │
        │ 3. AI evaluate  │
        │ 4. Score + tier │
        │    (baseline    │
        │     exists!)    │
        └────────┬────────┘
                 ▼
        ┌─────────────────┐
        │  Backfill tiers │
        │  (if needed)    │
        └────────┬────────┘
                 ▼
        ┌─────────────────┐
        │  Scrape reels   │
        │  for tier 1-3   │
        │  competitors    │
        └────────┬────────┘
                 ▼
     Dashboard shows everything:
     • Client's own reels
     • Baseline stats
     • Competitors with tiers
     • Outlier reels flagged
```

---

## Schema changes needed

### `clients` table — new column
```sql
ALTER TABLE clients ADD COLUMN IF NOT EXISTS
    competitor_seeds text[] DEFAULT '{}';
```

### `scraped_reels` table — allow NULL competitor_id
```sql
-- competitor_id should already be nullable, but verify:
-- NULL competitor_id = client's own reel
-- Non-NULL = competitor's reel
```

### New job types to register in worker
```python
JOB_HANDLERS = {
    "competitor_discovery": run_competitor_discovery,
    "baseline_scrape": run_baseline_scrape,
    "profile_scrape": run_profile_scrape,
    "client_auto_profile": run_auto_profile,        # NEW
    "client_onboard": run_full_onboard,              # NEW — orchestrates all steps
}
```

---

## Implementation reference

| What | Where |
|---|---|
| This spec | `docs/AUTO-PROFILE-SPEC.md` |
| Discovery logic + keyword rules | [docs/COMPETITOR-DISCOVERY-LOGIC.md](./COMPETITOR-DISCOVERY-LOGIC.md) |
| Apify actor details | [docs/SCRAPING-REFERENCE.md](./SCRAPING-REFERENCE.md) |
| Scoring + tiering | `backend/services/competitor_scoring.py` |
| Existing baseline scrape | `backend/jobs/baseline_scrape.py` |
| Existing discovery | `backend/jobs/competitor_discovery.py` |
