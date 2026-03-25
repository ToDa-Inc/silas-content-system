# Competitor Discovery — Strategic Logic

How the system finds, evaluates, and classifies competitors for any client. This is the **thinking process**, not the API parametrization (see [SCRAPING-REFERENCE.md](./SCRAPING-REFERENCE.md) for exact actor IDs, inputs, and field mappings).

**Last updated:** 2026-03-24

---

## The core question

> "For a given content creator in a specific niche, who else on Instagram is creating similar content for a similar audience — and how good are they?"

The system answers this through a 4-stage funnel: **Search → Filter → Evaluate → Classify**.

---

## ⚠️ Critical lesson: Identity keywords vs. topic keywords

Instagram's user search (`searchType: "user"`) matches against **bios and display names** — NOT post content. This means keywords must describe **what creators call themselves**, not what they post about.

| Keyword type | Example | Where it matches | Works for IG user search? |
|---|---|---|---|
| **Identity keywords** | "leadership coach", "career mentor", "Führungskräfte Coach" | Instagram **bios** — people describe WHAT THEY ARE | ✅ Yes |
| **Topic keywords** | "toxic workplace", "boundaries at work", "difficult boss" | Instagram **post captions** — what they talk about | ❌ No — nobody puts these in their bio |

**Failure mode:** If the auto-profiler generates topic keywords (e.g., "toxic workplace dynamics", "setting boundaries at work"), the search returns near-zero results. The system MUST generate identity keywords: job titles, role descriptions, specializations — terms creators actually put in their bios.

**Examples of good identity keywords:**
```
English: "leadership coach", "workplace coach", "career strategist",
         "HR consultant", "executive coach", "communication trainer"

German:  "Führungskräfte Coach", "Karriere Coach", "Kommunikationstrainerin",
         "Leadership Expertin", "Business Coach"
```

**Examples of bad topic keywords (DO NOT USE for user search):**
```
"toxic workplace", "boundaries at work", "difficult boss",
"Kommunikation Arbeitsplatz", "schwierige Gespräche", "toxischer Arbeitsplatz"
```

The AI auto-profiler (see [AUTO-PROFILE-SPEC.md](./AUTO-PROFILE-SPEC.md)) MUST be prompted to generate identity keywords, not topic keywords. This is the single most important factor in discovery quality.

---

## Stage 1: Search — Where do candidate accounts come from?

Three complementary strategies, used together for best coverage:

### Strategy A: Identity keyword search (primary, automated)

Instagram's user search matches keywords against **bios and display names**. The system searches using **identity keywords** — terms that describe what creators call themselves.

**How keywords are structured:**

Each client has 1-N niches. Each niche has:
- `keywords` — English identity terms (e.g., "leadership coach", "workplace communication trainer")
- `keywords_de` — German/localized identity terms (e.g., "Führungskräfte Coach", "Kommunikationstrainerin")

The system collects ALL keywords across ALL niches and searches each one separately.

**Example for Conny Gfrerer (3 niches):**
```
leadership coach        → finds English-speaking leadership educators
workplace coach         → finds workplace dynamics creators
career strategist       → finds career-focused content creators
executive coach         → finds leadership/management coaches
Führungskräfte Coach    → finds German leadership coaches
Kommunikationstrainerin → finds German communication trainers
...
```

Each keyword search returns ~5-30 accounts. After deduplication across keywords, a typical 3-niche client yields 20-60 unique candidate accounts.

**Keyword mode options:**
- `"all"` (default) — search both `keywords` and `keywords_de` from all niches
- `"en"` — English keywords only
- `"de"` — German/localized keywords only
- Custom `keywords` array — override niche config with specific terms

### Strategy B: Seed competitors (AI-suggested + manual)

The client config includes `competitor_seeds` — Instagram usernames to evaluate directly (skip search). Seeds come from two sources:

1. **AI-suggested** — During auto-profiling, the AI analyzes the client's content and suggests 5-10 Instagram accounts that are likely competitors. Even if only 3/10 are real competitors, this outperforms keyword search for niche creators.

2. **Manual** — The operator or client adds specific accounts they already know are competitors (e.g., accounts they follow, accounts their audience follows).

Seeds bypass the keyword search step entirely → go straight to caption scrape → AI evaluation → scoring. This is the most reliable source of high-quality competitors.

**Implementation:** Discovery pipeline should process seeds FIRST, then keyword search results. Seeds that fail AI evaluation are simply not saved (no harm in trying).

### Strategy C: Hashtag-based discovery (supplementary)

For niches where identity keywords don't work well, hashtag search provides an alternative:

1. Search hashtags like `#toxicworkplace`, `#boundariesatwork` using actor `reGe1ST3OBgYZSsZJ`
2. Collect posts → extract account usernames
3. Aggregate: which accounts appear most frequently under these hashtags?
4. Top accounts go to evaluation (Stage 3)

**Limitation:** Returns mostly images/carousels, <1% reels. No engagement metrics for videos. Best used for supplementary account discovery only.

### Strategy D: Keyword reel search (best content-based signal) ← NEW

**Actor:** `4QFjEpnGE1PNEnQF2` (Sasky Instagram Keyword Reels URLs Scraper)

Searches Instagram's reel/clip search using **topic keywords** (the same keywords that FAIL for bio search). Returns reel URLs + usernames.

**Tested result:** "toxic workplace" → 335 reels, 186 unique accounts. Top accounts:
- `@yourbipoctherapist` (14 reels), `@thechildressfirm` (10), `@corporate_warriors` (7), `@byebossofficial` (6), `@hrmanifesto` (5)

**Why this works:** Instagram's clip search matches reel CONTENT (captions, audio, topic tags), not bios. Topic keywords like "toxic workplace" that return 0 results in user search return 335 reels here.

**Data returned:** Lightweight (reel URL + username only, no engagement). Top accounts get enriched via profile scrape before AI evaluation.

See [VIRAL-DISCOVERY-SPEC.md](./VIRAL-DISCOVERY-SPEC.md) for the full pipeline, test results, and implementation code.

### Why multiple strategies?

No single approach covers the full competitor landscape:

| Strategy | Actor | Finds | Misses |
|---|---|---|---|
| A: Identity keywords | `DrF9mzPPEuVizVF4l` | Creators with clear professional bios | Niche creators with vague bios |
| B: Seed competitors | Direct scrape | Known competitors with high confidence | Unknown competitors |
| C: Hashtag pages | `reGe1ST3OBgYZSsZJ` | Accounts using niche hashtags | Accounts that don't use hashtags |
| **D: Keyword reels** | **`4QFjEpnGE1PNEnQF2`** | **Accounts making reels about the topic** | **Accounts that don't make reels** |

**Recommended order:** A+B first (fast, cheap), then D (best signal), then optionally C.

---

## Stage 2: Filter — Which accounts are worth evaluating?

Before spending money on AI evaluation, the system applies hard filters (zero cost):

| Filter | Rule | Why |
|---|---|---|
| Private accounts | `private == true` → skip | Can't see their content |
| Too small | `followers < 500` → skip | Not established enough to learn from |
| Too large | `followers > 5,000,000` → skip | Celebrity/brand, not a niche creator |
| Self | username matches client's handle → skip | Don't compete with yourself |

**Why 500 minimum?** Below ~500 followers, accounts are typically inactive, personal, or too early-stage to have meaningful content patterns worth studying.

**Why 5M maximum?** Above ~5M, accounts are usually brands, celebrities, or mega-influencers. Their content strategy is driven by different factors (PR teams, paid content, brand deals) and isn't useful for studying what works in a specific niche.

**What ISN'T filtered here:** Language, relevance, content quality. Those are handled by AI in Stage 3. Hard filters only remove accounts that are physically impossible or pointless to evaluate.

---

## Stage 3: Evaluate — Is this account actually a competitor?

This is the most important stage. Each surviving account gets one Gemini API call that determines: _is this person creating content about the same topics, for the same audience?_

### What the AI receives

Three pieces of context:

**1. Client niche profile** — built from the client's config:
- Name, Instagram handle, language
- All niches with descriptions and content angles
- ICP (target audience, age range, pain points, desires)

This tells the AI: "This is who our client is and what they create content about."

**2. Account data** — from the search result:
- Username, bio, follower count

**3. Recent post captions** — up to 8 captions, truncated to 300 chars each:
- Usually from the embedded `latestPosts` in the search result (free)
- Sometimes from a separate scrape if the search result had < 3 posts (costs Apify credits)

Captions are the key signal. The AI reads them to determine if this account CONSISTENTLY creates content about the same topics, not just occasionally mentions a keyword.

### What the AI decides

The prompt asks for a structured JSON response:

```json
{
  "relevance_score": 85,        // 0-100: how relevant is this account?
  "is_competitor": true,         // boolean: yes/no competitor
  "confidence": "high",          // high/medium/low
  "primary_topics": ["toxic boss", "workplace boundaries"],
  "content_style": "educator",   // educator/motivational/brand/mixed/other
  "overlap_niches": ["workplace-communication"],
  "language": "English",         // detected content language
  "reasoning": "..."             // 2-3 sentences explaining the decision
}
```

### False positive detection (critical for quality)

The biggest risk in competitor discovery is false positives — accounts that SEEM related but aren't actually competitors. The prompt explicitly instructs the AI to watch for:

| False positive type | Example | Why it's wrong |
|---|---|---|
| Motivational quote accounts | Posts "believe in yourself 💪" and occasionally mentions "workplace" | Not a creator, just reposts quotes. No educational content. |
| Corporate brand accounts | Company page posting job listings that mention "workplace culture" | Not an individual creator. Different audience, different content model. |
| Fitness/wellness coaches | Posts about "setting boundaries" in personal relationships | Same word "boundaries" but completely different context (personal vs. workplace) |
| Generic life coaches | Broad advice like "be your authentic self" that tangentially overlaps | Too vague to be a real competitor. No niche focus. |
| Same language, different niche | German account about cooking that happens to mention "Chef" (which means boss in German) | Keyword overlap is linguistic, not topical |

**Why this matters at scale:** Without false positive detection, a client with keywords like "boundaries at work" would end up with a competitor list full of therapists, life coaches, and relationship coaches — accounts that occasionally use the same words but serve a completely different audience. The quality of the competitor list directly affects the quality of outlier reels found later.

### The relevance threshold

Accounts scoring below the threshold (default: 60) are discarded. This means:
- **80-100:** Strong competitor — clearly creates content for the same audience on the same topics
- **60-79:** Moderate overlap — worth tracking, may cover adjacent topics
- **40-59:** Weak overlap — mentions similar topics but different primary focus → discarded
- **0-39:** Not a competitor — different niche entirely → discarded

The threshold is configurable per discovery run (`POST /clients/{slug}/competitors/discover` accepts `threshold` in the body).

---

## Stage 4: Classify — How good is this competitor?

Accounts that pass the relevance threshold get scored on two additional axes: **performance** and **language match**.

### Performance scoring (requires client baseline)

This compares the competitor's content performance against the CLIENT's own metrics. The baseline comes from scraping the client's latest 30 reels.

**Baseline stats used:**
- `p90_views` — client's top 10% (the "blueprint" threshold)
- `median_views` — client's typical performance
- `p10_views` — client's bottom 10% (the "peer" threshold)

**Scoring logic:**
```
competitor.avg_views >= p90_views     → performance_score = 100 (outperforms client)
competitor.avg_views >= median_views  → performance_score = 75  (above client average)
competitor.avg_views >= p10_views     → performance_score = 40  (similar to client)
competitor.avg_views >= 1000          → performance_score = 20  (small but active)
else                                 → performance_score = 5   (very small)
```

**Why relative to the client?** A competitor with 500K avg views is amazing for a client averaging 10K views — but unremarkable for a client averaging 1M. The tiering system adapts to each client's level.

### Language bonus

```
same language as client → +10 to composite score
different language      → +0
```

Language-matched competitors are more valuable because:
- Their audience overlaps more directly
- Their content style and topics can be more directly replicated
- Hook text and captions are in the same language

### Composite score

```
composite = round(relevance * 0.50 + performance * 0.40 + language_bonus * 1.0)
```

**Weight rationale:**
- **50% relevance** — the most important factor. An irrelevant high-performer teaches you nothing.
- **40% performance** — strong performers validate that a content angle WORKS.
- **10% language bonus** — a tiebreaker that prioritizes same-language competitors.

### Tier assignment

Tiers determine how the system treats this competitor going forward:

| Tier | Label | Criteria | System behavior |
|---|---|---|---|
| 1 | BLUEPRINT | composite ≥ 80 AND avg_views ≥ client median | Stale after **7 days** → eligible for scrape. Highest priority for outlier detection. |
| 2 | STRONG | composite ≥ 60 AND avg_views ≥ client p10 | Stale after **7 days** → eligible for scrape. |
| 3 | PEER | relevance ≥ 60 AND avg_views ≥ 1000 | Stale after **30 days** → eligible for scrape (implementation: `scrape_cycle._is_stale`). |
| 4 | SKIP | everything else | **Never scraped** (`tier >= 4` is excluded from stale detection). |

**Key insight:** Only tiers **1–3** can be scraped; tier **4** is stored but never picked for reel scrape. **Tier cadence:** tiers **1–2** refresh on a **7-day** staleness window; tier **3** uses a **30-day** window (see `backend/services/scrape_cycle.py`).

### Baseline required for tiering

`evaluate_competitor()` (composite + tier) runs only when the client has a **valid `client_baselines` row** (`run_competitor_discovery` sets `baseline_for_eval` from `_latest_valid_baseline`). If discovery runs **before** any baseline scrape, accounts that pass relevance can still be **upserted**, but **without** `performance_score`, `composite_score`, or `tier` until a baseline exists — run **Refresh baseline** first for full Stage 4 behavior.

---

## How it all connects to outlier detection

The entire competitor discovery pipeline exists to answer one downstream question:

> "Which specific reels from accounts like mine went viral — and what can I learn from them?"

The flow:
1. **Discovery** → finds 10-30 relevant competitors per client
2. **Cron / dashboard scrape** → tiers **1–2** when last scrape older than **7 days**, tier **3** when older than **30 days** (each run uses the reel actor’s `resultsLimit`, typically **30** reels — see `profile_scrape` / Apify config)
3. **Outlier detection** → for each reel, computes `views / account_avg_views`. Reels where this ratio exceeds the client's `outlier_ratio_threshold` (default 10x) are flagged as outliers.
4. **Phase 2 (future)** → Claude analyzes WHY each outlier went viral (5-criteria scoring: hook, topic, format, emotion, timing)

The quality of discovery directly determines the quality of outliers found. Bad competitors = irrelevant outlier reels = useless content suggestions.

---

## Scaling considerations

### Per-client costs

| Component | Cost driver | Typical | At scale (100 clients) |
|---|---|---|---|
| Keyword search | Apify credits per search | ~18 searches × $0.01 = ~$0.18 | $18/discovery cycle |
| Caption scrape | Only when latestPosts < 3 | ~20% of accounts need this | Minimal |
| AI evaluation | OpenRouter (Gemini Flash) | ~$0.001/account × 50 = ~$0.05 | $5/discovery cycle |
| Total discovery | One-time per client | ~$0.25 | $25 for 100 new clients |
| Ongoing scrape | Apify per competitor per week | ~15 competitors × $0.05 = $0.75/week | $75/week for 100 clients |

### Optimization opportunities

1. **Shared competitor pool** — if two clients are in the same niche, they'll discover many of the same competitors. A future optimization could share competitor data across clients in the same org (or even across orgs).

2. **Incremental discovery** — re-running discovery with the same keywords mostly finds the same accounts. The `UPSERT ON CONFLICT (client_id, username)` handles this at the DB level, but we still pay for the Apify search and AI evaluation. A future optimization could skip accounts already in the DB with a recent `last_evaluated_at`.

3. **Keyword quality feedback loop** — track which keywords produce the most tier 1-2 competitors. Over time, suggest better keywords or auto-prune low-yield ones.

---

## Implementation reference

| What | Where |
|---|---|
| Keyword collection logic | `_collect_keywords()` in `backend/jobs/competitor_discovery.py` |
| Search + filter | `_discover_by_keyword()` in same file |
| AI prompt construction | `_build_relevance_prompt()` + `_build_niche_profile()` in same file |
| AI call | `analyze_relevance()` in `backend/services/openrouter.py` |
| Performance scoring + tiering | `evaluate_competitor()` in `backend/services/competitor_scoring.py` |
| Who gets reel scrapes (tier + staleness) | `find_stale_competitors()` / `_is_stale()` in `backend/services/scrape_cycle.py` |
| Client niche config schema | `config/clients/conny-gfrerer.json` (reference implementation) |
| Exact Apify inputs/outputs | [docs/SCRAPING-REFERENCE.md](./SCRAPING-REFERENCE.md) |
