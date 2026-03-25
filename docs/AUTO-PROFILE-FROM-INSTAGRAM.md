# Auto-profile from Instagram (spec)

**Status:** specification — not implemented  
**Last updated:** 2026-03-24

## Problem

Manual setup for a client like Conny (`config/clients/conny-gfrerer.json`) includes **3 niches**, **English + German keywords**, **content angles**, **ICP**, and optional **seed competitors**. Discovery then runs against rich `niche_config` + `icp`.

Today, **onboarding** (`content-machine/src/app/api/onboarding/complete/route.ts`) creates a **single minimal** niche:

- `id: "onboarding-primary"`, `keywords` from CSV, `keywords_de: []`, `content_angles: []`
- `icp: { summary, source: "onboarding" }` only

So the **evaluation pipeline** (`backend/jobs/competitor_discovery.py`) is fine; the **input quality** is poor. The missing piece is an **auto-profiling** step that turns the creator’s Instagram into **structured** `niche_config` + `icp` before (or as part of) first discovery.

## Goal

After a user completes onboarding with an **Instagram handle**, the system should automatically:

1. Scrape the **client’s own** reels (reuse existing Apify reel actor).
2. Run **one structured AI call** to infer niches, keywords (EN + DE where relevant), ICP, and content style.
3. **Persist** the result on `clients` (replace or merge onboarding placeholders).
4. Optionally run **competitor discovery** (same job as today) using the enriched config.

Target richness: comparable to `config/clients/conny-gfrerer.json` (1–3 niches, angles, bilingual keywords, structured ICP).

## Reuse existing building blocks

| Piece | Where |
|--------|--------|
| Reel scrape actor | `REEL_ACTOR` in `backend/services/apify.py` (`xMc5Ga1oCONPmWJIa`) — same input shape as baseline: `{ "username": ["handle"], "resultsLimit": 30 }` |
| Baseline scrape logic | `run_baseline_scrape` in `backend/jobs/baseline_scrape.py` — already writes `client_baselines`; auto-profile may **share** the scrape step or call `run_actor` once and branch (profile vs baseline row) |
| LLM JSON | `analyze_relevance` pattern in `backend/services/openrouter.py` — add a **new** function e.g. `analyze_creator_niche_profile(...)` with a dedicated prompt and strict JSON schema |
| Discovery | `run_competitor_discovery` unchanged — consumes `clients.niche_config` + `icp` from DB |

## Proposed pipeline

### Step 1 — Scrape client reels

- Input: normalized `instagram_handle` from `clients`.
- Apify: `run_actor(token, REEL_ACTOR, { "username": [handle], "resultsLimit": 30 })`.
- Extract per item: caption text (for AI), and optionally views for consistency with baseline.

### Step 2 — Single AI call (niche extraction)

**Inputs:** bio (if available from search or a lightweight profile fetch), **up to 30 captions** (truncate per caption like discovery does, e.g. 300–500 chars).

**Prompt goals (aligned with your outline):**

- 1–3 **niches**: `id`, `name`, `description`, `content_angles` (5 recurring themes per niche or split across niches — schema must be fixed in the spec).
- `keywords` (5–8 EN), `keywords_de` (5–8 DE, or `[]` if content is clearly English-only).
- `icp`: `target`, `age_range`, `pain_points[]`, `desires[]` (match shape expected downstream; see `conny-gfrerer.json`).
- `content_style`, `primary_language` (metadata; may map to `clients.language` if confident).

**Output:** strict JSON validated in code before DB write (same discipline as `analyze_relevance`).

### Step 3 — Persist

- `UPDATE clients SET niche_config = ..., icp = ..., language = ... WHERE id = ...`
- Optional: set a flag `profile_enriched_at` or `niche_source = 'auto_profile'` if the schema adds a column later (otherwise store in `icp` or `products` JSON).

### Step 4 — Discovery (optional but recommended for “one flow”)

- Enqueue or inline `competitor_discovery` **after** successful profile write.
- **Order matters:** baseline row may already exist from Step 1; if auto-profile runs **before** baseline insert, ensure discovery still gets `client_baselines` for tiering (today’s behavior: `evaluate_competitor` only when baseline exists — see `docs/COMPETITOR-DISCOVERY-LOGIC.md`).

**Recommended order for parity with Conny:**

1. Scrape 30 reels → **insert `client_baselines`** (same as baseline refresh) so `p90/median/p10` exist.
2. Run AI niche extraction → update `niche_config` + `icp`.
3. Run `competitor_discovery`.

That way Stage 4 tiering works on first discovery.

## Job type / API shape (proposal)

- **`background_jobs.job_type`:** `client_auto_profile` (or `niche_profile`) so ops can audit duration, failures, and cost.
- **Trigger options:**
  - **A)** `POST /api/v1/clients/{slug}/auto-profile` (manual or called from onboarding completion server-side).
  - **B)** Chained from onboarding: after `clients` insert, Next server calls FastAPI with service role (or internal queue) — **watch HTTP timeouts** (Apify + LLM can exceed 60s).

- **Concurrency:** reuse `has_active_job` pattern for `client_auto_profile` + `competitor_discovery` per client to avoid double spend.

## Onboarding UX

- **Synchronous:** user waits on a “Setting up your niche profile…” screen (may be 2–5+ minutes).
- **Asynchronous (recommended):** onboarding returns immediately; dashboard shows **“Profiling…”** until `profiles` / job completes; then **“Run discovery”** or auto-start discovery when profile job completes.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Private / tiny IG | Fail fast with clear error; don’t overwrite niche with garbage |
| LLM returns invalid JSON | Retry once; schema validation; fallback: keep onboarding minimal niche |
| Cost | One Apify run + one LLM call per client; discovery still separate |
| Timeout | Async job + polling; avoid blocking `POST /onboarding/complete` |

## Implementation phases (suggested)

1. **Backend only:** `client_auto_profile` job: scrape → LLM → `UPDATE clients`; manual trigger via curl/Postman.
2. **Wire baseline:** ensure Step 1 also writes `client_baselines` (or call `run_baseline_scrape` first, then profile, then discovery).
3. **Frontend / onboarding:** async trigger + UI state.
4. **Seeds:** optional later — `competitor_seeds` from onboarding form or post-profile UI (still not in Python discovery until ported).

## References

- Onboarding placeholder niche: `content-machine/src/app/api/onboarding/complete/route.ts` (`buildNicheConfig`).
- Rich reference: `config/clients/conny-gfrerer.json`.
- Discovery + tiers: `docs/COMPETITOR-DISCOVERY-LOGIC.md`, `backend/jobs/competitor_discovery.py`, `backend/services/competitor_scoring.py`.

---

## Answer: spec vs build

**Do both in order:** keep this doc as the contract, then implement in **phases** (backend job + persistence first, then onboarding wiring). Building “directly” without a short spec tends to duplicate baseline logic and mishandle ordering vs baseline/tiering.
