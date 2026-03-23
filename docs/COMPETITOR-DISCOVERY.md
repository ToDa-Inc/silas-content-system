# Competitor Discovery & Evaluation System

## Overview

Two-step pipeline that finds, validates, and ranks Instagram competitors for any client.

```
DISCOVER                         EVALUATE
─────────                        ────────
Keyword/URL/Username              Client baseline scrape
       ↓                                ↓
Apify scrapes account             Compare performance
       ↓                                ↓
Gemini 3 Flash scores             Composite score:
content relevance (0-100)         50% relevance + 40% performance + 10% language
       ↓                                ↓
Save to data/niches/              Tier classification:
                                  Blueprint / Strong / Peer / Skip
```

---

## How It Works

### Step 1: Discovery (`competitor-discovery.js`)

**Three input modes:**

| Mode | Flag | What it does |
|------|------|-------------|
| **Keyword** | `--keyword "toxic boss"` | Searches Instagram for accounts matching keyword, scrapes their recent posts, scores relevance |
| **URL** | `--url "https://instagram.com/account/"` | Extracts username from URL, scrapes + analyzes |
| **Username** | `--username account` | Direct analysis of a known account |

**The relevance scoring process:**

1. **Load client config** — reads `config/clients/{client}.json` dynamically. The niche profile, ICP, content angles, and language are built into the Gemini prompt automatically. Nothing is hardcoded for any specific client.

2. **Scrape the account** — pulls 6-8 recent post captions via Apify. If the search actor already returned posts inline (cached), those are used directly (saves an API call + ~$0.02 per account).

3. **Send to Gemini 3 Flash** — the prompt includes:
   - The client's full niche profile (all niches, content angles, ICP pain points)
   - The discovered account's bio + recent captions
   - Explicit false-positive detection rules:
     - Motivational quote accounts → reject
     - Corporate brand accounts → reject
     - Fitness/wellness coaches who mention "boundaries" → reject
     - Life coaches with broad advice → reject
     - Wrong niche entirely → reject
   - Classification: educator / motivational / brand / mixed / other
   - Language detection
   - Scoring with reasoning

4. **Filter by threshold** — default: keep accounts scoring ≥ 60/100.

**Output:** `data/niches/{client}/competitors/discovery-{label}-{timestamp}.json`

### Step 2: Evaluation (`competitor-eval.js`)

Discovery tells you IF an account is relevant. Evaluation tells you if it's WORTH STUDYING.

1. **Baseline scrape** — scrapes the client's own reels (last 30) to establish performance metrics. Cached for 7 days.

2. **Performance thresholds derived from client data:**
   - `blueprintViews` = client's P90 views (top 10% of their reels)
   - `minUsefulViews` = client's median views
   - `peerViews` = client's P10 views (bottom 10%)

3. **Composite scoring:**
   ```
   composite = (relevance × 0.50) + (performance × 0.40) + languageBonus
   ```
   - **Relevance (0-100):** from Gemini — content match
   - **Performance (0-100):** based on avg views vs client thresholds
   - **Language bonus (+10):** same language as client = direct market competitor

4. **Tier classification:**

| Tier | Label | Criteria | Action |
|------|-------|----------|--------|
| 1 | **BLUEPRINT** | Composite ≥ 80 AND avg views ≥ client median | Study viral patterns, replicate hooks and formats |
| 2 | **STRONG** | Composite ≥ 60 AND avg views ≥ client P10 | Track and adapt content angles |
| 3 | **PEER** | Relevance ≥ 60 AND avg views ≥ 1K | Watch for breakout content |
| 4 | **SKIP** | Everything else | Not useful for pattern extraction |

**Output:** `data/niches/{client}/evaluations/eval-{timestamp}.json` + `data/niches/{client}/current-competitors.json` (always the latest).

---

## Usage

```bash
# Discover competitors
node scripts/competitor-discovery.js --client conny-gfrerer --keyword "leadership coach" --limit 10
node scripts/competitor-discovery.js --client conny-gfrerer --url "https://instagram.com/someaccount/"
node scripts/competitor-discovery.js --client conny-gfrerer --username someaccount

# Evaluate all discovered competitors against client baseline
node scripts/competitor-eval.js --client conny-gfrerer

# Force refresh client baseline metrics
node scripts/competitor-eval.js --client conny-gfrerer --refresh-baseline
```

---

## Adding a New Client

Create `config/clients/{client-id}.json`:

```json
{
  "client_id": "new-client",
  "name": "Client Name",
  "instagram": "their_handle",
  "language": "en",
  "niches": [
    {
      "id": "niche-slug",
      "name": "Niche Name",
      "description": "What this niche is about",
      "keywords": ["keyword1", "keyword2"],
      "content_angles": ["Angle 1", "Angle 2"]
    }
  ],
  "competitor_seeds": ["known_competitor1", "known_competitor2"],
  "icp": {
    "target": "Who they serve",
    "age_range": "25-45",
    "pain_points": ["Pain 1", "Pain 2"],
    "desires": ["Desire 1", "Desire 2"]
  }
}
```

All scripts automatically adapt to the new client's niche profile.

---

## Cost Breakdown

| Operation | Cost | Notes |
|-----------|------|-------|
| Apify keyword search | ~$0.03 | Returns up to ~15 accounts |
| Apify profile scrape (per account) | ~$0.02 | Only if posts not cached from search |
| Gemini 3 Flash analysis (per account) | ~$0.002 | Via OpenRouter |
| Client baseline scrape | ~$0.03 | Cached for 7 days |

**Typical cost per keyword discovery run (10 accounts):** ~$0.05-0.10
**Full evaluation cycle (baseline + eval):** ~$0.03

---

## Improving Discovery

### Problem: Limited keyword search results

Instagram's user search API is shallow — niche keywords often return <5 accounts. Broad keywords work better ("leadership coach" > "workplace psychology").

### Strategies for better coverage:

1. **Start with seed competitors** — validate known accounts via `--username`, then discover more via keywords
2. **Use broad keywords** — "leadership coach", "career coach", "communication trainer" work better than "toxic boss workplace psychology"
3. **Try the client's language** — German keywords may surface German competitors
4. **Multiple keyword runs** — each keyword surfaces different accounts. Run 5-10 keywords to build coverage
5. **URL mode for manual finds** — when Silas or the client spots a competitor, paste the URL for instant analysis

### Improving relevance scoring:

The Gemini prompt handles edge cases well but can be improved by:
- Adding more false-positive patterns as they're encountered
- Adjusting the scoring weights based on evaluation outcomes
- Adding video content analysis (transcription) for deeper content matching

---

## Data Flow

```
config/clients/{client}.json          ← Client niche profile (input)
         ↓
scripts/competitor-discovery.js       ← Find + score relevance
         ↓
data/niches/{client}/competitors/     ← Raw discovery results
         ↓
scripts/competitor-eval.js            ← Add performance scoring + tiers
         ↓
data/niches/{client}/baseline.json    ← Client's own metrics (cached)
data/niches/{client}/evaluations/     ← Full evaluation reports
data/niches/{client}/current-competitors.json ← Latest ranked list
```
