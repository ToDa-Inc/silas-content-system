# Analyze Reel by URL — Endpoint Spec

**Status:** Spec (not yet implemented in backend)
**Reference script:** `scripts/analyze-reel-by-url.js` (proven working)
**Related docs:** `docs/CRITERIA.md`, `docs/REEL-VIDEO-ANALYSIS-SPEC.md`

---

## What this is

A single endpoint that takes any Instagram reel URL, scrapes it, downloads the video, runs Gemini 3 analysis against the 5 Silas criteria, and returns a scored analysis.

This is the "Analyze a Reel" feature in the UI — paste any URL, get results in ~60 seconds.

**Use cases:**
- Analyze a competitor reel Silas found while browsing
- Analyze your own reel on demand
- Analyze a viral reel from the niche before tracking the account
- One-off analysis without adding the account to competitors

---

## Flow

```
POST /api/v1/clients/{slug}/reels/analyze-url
          ↓
Apify xMc5Ga1oCONPmWJIa (URL input) — ~15s
          ↓
Download videoUrl → temp .mp4 — ~5s
          ↓
Gemini 3 Flash Preview via OpenRouter (base64 video) — ~30s
          ↓
Parse scores + structured output
          ↓
Return JSON + optionally persist to reel_analyses
```

Total time: ~60 seconds. Run as a background job, poll for result.

---

## API

### Request

```
POST /api/v1/clients/{slug}/reels/analyze-url
```

```json
{
  "url": "https://www.instagram.com/p/ABC123/",
  "save": true
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | Instagram reel URL |
| `save` | boolean | no | Persist result to `reel_analyses` (default: false) |

### Response (success)

```json
{
  "status": "completed",
  "reel": {
    "url": "https://www.instagram.com/p/ABC123/",
    "owner": "grimetimeready",
    "views": 6941759,
    "likes": 464298,
    "comments": 4004,
    "duration": 35,
    "timestamp": "2026-02-03T00:00:00Z"
  },
  "analysis": {
    "total_score": 47,
    "rating": "Highly Replicable",
    "scores": {
      "instant_hook": 9,
      "high_relatability": 10,
      "cognitive_tension": 9,
      "clear_value": 10,
      "comment_trigger": 9
    },
    "full_text": "...",
    "prompt_version": "silas_v1_2026_03",
    "model": "google/gemini-3-flash-preview",
    "analyzed_at": "2026-03-25T14:00:00Z"
  }
}
```

### Response (error cases)

```json
{ "status": "error", "error": "reel_not_found" }
{ "status": "error", "error": "private_account" }
{ "status": "error", "error": "video_too_large" }
```

---

## Backend implementation notes

### Job type
Run as a background job (same pattern as `reel_video_analysis` in REEL-VIDEO-ANALYSIS-SPEC.md).
Do not run synchronously in the HTTP handler — Apify alone takes 15s+.

Suggested flow:
1. HTTP handler receives request → enqueues job → returns `{ job_id, status: "queued" }`
2. Frontend polls `GET /api/v1/jobs/{job_id}` until `status: "completed"`
3. Completed job returns full analysis in response

### Apify call
```python
actor_id = "xMc5Ga1oCONPmWJIa"
input = {
    "username": [reel_url],
    "resultsLimit": 1
}
```

(Apify’s Instagram Reel Scraper expects **`username`** as an array of handles, profile URLs, or direct reel URLs — not a separate `urls` field.)

Returns `videoUrl` in the result item. If `videoUrl` is missing → reel is private or deleted.

### Video download
Download `videoUrl` to a temp file (never stored on disk long-term).
If file > 15MB → fall back to caption-only analysis (flag `video_analyzed: false` in response).

### Gemini call
Model: `google/gemini-3-flash-preview` via OpenRouter
Input: base64 video as `data:video/mp4;base64,...` in `image_url` content block
Prompt: use `SILAS_REEL_ANALYSIS_PROMPT` constant (defined in `scripts/analyze-reel-by-url.js`)
Max tokens: 2000

### Score parsing
Parse `TOTAL SCORE: X/50` from response text.
Parse individual scores `X/10` per criterion.
Store `full_text` as JSONB for traceability.

### Persistence
On success:

1. **Upsert `scraped_reels`** with `source = 'url_paste'`, `competitor_id = NULL`, keyed by `(client_id, post_url)` (same pattern as other scrapes).
2. **Upsert `reel_analyses`** (see `backend/sql/phase2_reel_analyses.sql`) on `(client_id, post_url)` with structured score columns + `full_analysis_json` (full model text + `video_analyzed` flag), `reel_id` pointing at the scraped row, `analysis_job_id` = background job id.

List via `GET /api/v1/clients/{slug}/reel-analyses`.

### Cleanup
Delete temp video file after Gemini call regardless of success/failure.

---

## Cost

| Step | Cost |
|---|---|
| Apify scrape (1 reel) | ~$0.002 |
| Gemini 3 Flash video | ~$0.01–0.02 |
| **Total per analysis** | **~$0.01–0.02** |

---

## Model + prompt versioning

The analysis prompt is versioned via `prompt_version` (e.g. `silas_v1_2026_03`).
When changing the prompt, bump the version. Existing `reel_analyses` rows keep their version.
This allows comparing analysis quality across prompt versions.

Current prompt: see `scripts/analyze-reel-by-url.js` → `ANALYSIS_PROMPT` constant and `PROMPT_VERSION`.

---

## What's already proven

The reference script `scripts/analyze-reel-by-url.js` has been tested end-to-end:
- Scraped 6 accounts (connygfrerer, jefferson_fisher, fearlessworkplace, advicewitherin, howtoconvince, grimetimeready)
- Downloaded videos (162KB to 20MB range)
- Analyzed with `google/gemini-3-flash-preview` via OpenRouter
- Got scored output including total score, per-criterion scores, format analysis, replicable elements

Run it to verify locally:
```bash
node scripts/analyze-reel-by-url.js --url https://www.instagram.com/p/DWSEtdwj5ce/
```
