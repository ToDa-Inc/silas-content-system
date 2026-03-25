# Reel video analysis — storage, pipeline, and DB (spec)

**Status:** specification (implementation follows)  
**Related:** `docs/CRITERIA.md`, `docs/BACKEND-ARCHITECTURE.md` (`scraped_reels`, `reel_analyses`), `docs/ANALYSIS_PIPELINE.md`

This document defines how we **save or obtain video**, run **Silas-aligned multimodal analysis** (e.g. Gemini on full video), and **persist results** for reuse—without re-analyzing reels that already have a completed analysis when scrapes refresh metrics only.

---

## 1. Goals

| Goal | Requirement |
|------|----------------|
| **Quality** | One canonical **prompt** (Silas criteria + narrative sections), tuned for workplace / creator niche; model sees **full video** (not regex-on-frames as the source of truth). |
| **Reference** | Analysis is **queryable** next to the reel: scores, structured JSON, and optional full model text for product + generation. |
| **Efficiency** | **Analyze only new reels** (no duplicate LLM spend for the same logical post). |
| **Refresh** | Baseline / profile scrapes **update numbers** (views, likes, …) only; they **do not** wipe or re-run analysis for posts that were already analyzed. |
| **Scope** | **Client’s own reels:** eligible for analysis on **all** scraped rows (subject to “new only”). **Competitor reels:** analysis only for **outliers** (`is_outlier = true`), still **new only**. |

---

## 2. Definitions

- **Logical reel:** One Instagram post, identified stably by **`post_url`** or **`short_code`** (derived from URL). Not the `scraped_reels.id` UUID if baseline refresh recreates rows.
- **New reel (for analysis):** A logical reel that **does not yet** have a row in the analysis store (see §5) for this client—or explicitly marked for re-analysis after a manual “invalidate”.
- **Refresh:** Any job that upserts `scraped_reels` / baselines to refresh **engagement metrics** without requiring re-downloading video for analysis.

---

## 3. What gets analyzed (selection rules)

### 3.1 Client’s own reels (`competitor_id IS NULL`, `source` e.g. `client_baseline`)

- After a successful scrape, consider **every** such row **eligible**.
- **Enqueue analysis** only for logical reels that pass the **“new only”** rule (§6).
- **Rationale:** Own-account inventory is the client’s **baseline creative DNA**; we want full coverage, not only viral outliers.

### 3.2 Competitor / tracked accounts (`competitor_id IS NOT NULL`)

- Eligible only if **`is_outlier = true`** (per existing outlier policy, e.g. ratio vs account average).
- **Enqueue analysis** only if **new** (§6).
- **Rationale:** Cost control; competitor feeds are large; qualitative deep-dive matches “study what worked unusually well.”

### 3.3 Summary

| Reel type | Scrape scope (existing product rules) | Video analysis scope |
|-----------|----------------------------------------|-------------------------|
| Own | Typically up to N recent (e.g. 30) | **All** eligible rows, **new only** |
| Competitor | Per competitor policy | **Outliers only**, **new only** |

---

## 4. Video: obtain, optional save, then analyze

### 4.1 Obtain MP4 for the model

- At analysis time, the worker needs **bytes** (or a **provider-accepted URL**—note: many Gemini routes need **base64** or YouTube, not IG CDN—so **download in backend** is the reliable default).
- **Inputs:** `post_url` / short code; optional **`video_url`** if persisted at scrape time (recommended long-term to avoid a second Apify hit).

### 4.2 Persisting the file (optional but useful)

| Option | Use case |
|--------|----------|
| **No durable storage** | Download stream → base64 → Gemini → discard. Lowest storage cost; cannot re-run identical bytes later. |
| **Supabase Storage** (or S3) | Save `videos/{client_id}/{short_code}.mp4` (or content-hash) for audit, re-prompt, debugging. **Recommended** once volume is clear. |
| **Store URL only** | Column e.g. `scraped_reels.video_url` or last-known CDN URL; **may expire**—treat as hint, re-fetch if 403. |

The spec does **not** mandate storage v1; it mandates a **clear decision** per environment (dev may skip storage).

### 4.3 Analysis step

- **Model:** e.g. `google/gemini-3-flash-preview` (or successor) via OpenRouter, **full video** as `data:video/mp4;base64,...` when URL upload is not supported.
- **Prompt:** Single **Silas master prompt** (aligned with `docs/CRITERIA.md`): sections such as CONCEPT, HOOK, RETENTION, REWARD, SCRIPT STRUCTURE, **scores 1–10 × 5 criteria**, `TOTAL_SILAS_SCORE` (max 50), replicability notes, optional **EVIDENCE_LIMITATIONS** if ever using text-only fallback.
- **Output:** Parse structured fields + store raw assistant text in JSONB for traceability.

**Do not** use `video-criteria-evaluator.js` regex output as the canonical business score; optional diagnostics only.

---

## 5. Where to store data (reference on / next to `scraped_reels`)

### 5.1 Primary: `reel_analyses` (see `BACKEND-ARCHITECTURE.md`)

- **Scores:** `instant_hook_score` … `comment_trigger_score`, derived `total_score` / `replicability_rating`.
- **Qualitative:** `why_it_worked`, `replicable_elements` (JSONB), `suggested_adaptations`, optional taxonomy columns (`hook_type`, etc.).
- **Add (recommended):** `full_analysis_json jsonb` — full structured + raw model output for UI and prompts.
- **Add:** `model_used`, `prompt_version text` (e.g. `silas_v2_2026_03`), `analyzed_at`.

### 5.2 Stable link to `scraped_reels` (critical)

Because **baseline refresh** may **delete and re-insert** own-reel rows with **new UUIDs**, **`reel_analyses.reel_id` alone** is fragile if it only points at the old row.

**Required pattern (choose one):**

1. **Stable analysis key (recommended):** Add to `reel_analyses` (or a thin `reel_analysis_index` table):  
   `client_id` + `post_url` **UNIQUE** (or `instagram_short_code` UNIQUE per client).  
   On scrape, **upsert** `scraped_reels` by `post_url`; **upsert** analysis by the same key; then **attach** `reel_id` to the current `scraped_reels.id` for convenience (nullable update when row appears).

2. **Alternative:** Never delete own-reel rows; only upsert metrics in place (larger schema change).

### 5.3 Denormalized pointers on `scraped_reels` (optional, UX)

- `analysis_status`: `pending | completed | skipped | failed`
- `last_analyzed_at`
- `storage_path` if video kept

Keeps list endpoints fast; **source of truth** remains `reel_analyses` + stable post key.

---

## 6. “New only” — no re-analysis on refresh

### 6.1 Rule

- Before calling Gemini, check: **does a completed analysis already exist** for `(client_id, post_url)` [or short_code]?
- **Yes** → **skip** LLM; optionally refresh **only** denormalized flags on `scraped_reels` if you store them.
- **No** → run pipeline (download → analyze → insert).

### 6.2 What “refresh” does

- **Scrape jobs** update views/likes/comments and baseline aggregates.
- They **must not** delete analysis rows keyed by stable post identity.
- If a post **disappears** from Instagram, optional cleanup job can archive analysis—product decision.

### 6.3 Forced re-analysis (out of scope for automatic runs)

- Manual admin action: “Re-analyze reel” → deletes or invalidates analysis for that key, then enqueues one job.

---

## 7. Job flow (recommended)

```
Scrape completes (baseline or profile)
       ↓
Derive list of scraped_reels rows + post_url
       ↓
Filter: own → all rows; competitor → is_outlier only
       ↓
Filter: keep only keys with NO completed reel_analyses
       ↓
Enqueue background_jobs (batch or per-reel, product choice)
       ↓
Worker: for each key → download video → Gemini → upsert reel_analyses (+ optional Storage)
       ↓
Update scraped_reels.analysis_status / reel_id link
```

- **Do not** run long video analysis in the **synchronous** baseline HTTP handler; use **worker** + queue.

---

## 8. Prompt quality (make it “as good as possible”)

- **Single source of truth:** One markdown or constant `SILAS_REEL_ANALYSIS_PROMPT` versioned (`prompt_version`).
- **Inject context:** `clients.language`, `niche_config` / ICP summary in the system or user preamble so scores are niche-aware.
- **Output contract:** Require **machine-parseable** sections or JSON schema in addition to prose, to avoid brittle string splits.
- **Regression:** When changing the prompt, bump `prompt_version`; old rows keep their version for analytics.

---

## 9. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| IG CDN URL expiry | Persist `video_url` at scrape + download immediately in analysis job; or second Apify fetch. |
| Cost spikes on many new own reels | Batch scheduling, rate limits, cap N per day with backlog. |
| Duplicate analysis after bad deploy | Unique constraint on `(client_id, post_url)` for completed analysis. |
| Competitor “outlier” threshold wrong | Outlier flag is product-owned; analysis only reads `is_outlier`. |

---

## 10. Implementation checklist (for devs)

- [ ] Stable key `(client_id, post_url)` for `reel_analyses` (or index table).
- [ ] Scrape pipeline: optional `video_url` column on `scraped_reels` if available from Apify.
- [ ] New job type: e.g. `reel_video_analysis` + worker handler.
- [ ] Selection: own = all new; competitor = outliers + new only.
- [ ] Baseline refresh: metrics-only path; **no** analysis wipe; reconcile `reel_id` on upsert by `post_url`.
- [ ] API: optional trigger + list reels with joined analysis.
- [ ] Prompt file + `prompt_version` on each analysis row.

---

## 11. Summary one-liner

**Save or fetch video → run one Silas Gemini pass → store in `reel_analyses` keyed by client + post identity; analyze only new posts; refresh updates metrics only; analyze all own reels and only competitor outliers.**
