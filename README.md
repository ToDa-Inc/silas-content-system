# Silas content system

Instagram Reels intelligence and content production for one creator per workspace (current client: Conny Gfrerer, `@connygfrerer`, German market). It watches the creator's own reels and a list of tracked competitors, finds what is outperforming, learns from the creator's own results, and turns that into angles, hooks, scripts, captions, covers, carousels and rendered videos.

This repository is a monorepo with three deployable parts and one render tool:

| Part | Path | Runs on | What it is |
|---|---|---|---|
| Dashboard | `content-machine/` | Vercel | Next.js 16 (App Router, webpack build), Tailwind v4 |
| API | `backend/` (`main.py`) | Railway | FastAPI, talks to Supabase with the service-role key |
| Worker | `backend/` (`worker.py`) | Railway | Claims rows from `background_jobs` and runs them |
| Video renderer | `video-production/broll-caption-editor/` | Inside the API image | Remotion project the API shells out to |

Everything else (Node scripts in `scripts/`, `reference/`, `data/`, `dashboard/`) is the original prototype. It is kept for reference and is not used in production (see [Legacy](#legacy-and-reference)).

---

## 1. The pipeline end to end

```
 Onboarding ──► Context / AI profile ─────────────────────────────┐
     │                                                             │ (injected into every prompt)
     ▼                                                             ▼
 Discover competitors ──► Scrape reels ──► Score & analyse ──► Generate (angles → content) ──► Create (cover / carousel / video) ──► Post manually
     ▲                         │                 │                       ▲
     │                         ▼                 ▼                       │
     └──────────── Daily refresh + snapshots ► Breakouts, format digests ┘
                               │
                               ▼
                 Learning loop (own reels vs own norm, votes) ───────────┘
```

| # | Stage | What happens | Code | Where you use it |
|---|---|---|---|---|
| 1 | **Onboard** | Creates the organisation, the client row and a first niche config. | `content-machine/src/app/api/onboarding/complete/route.ts` | `/onboarding` |
| 2 | **Context** | Strategy documents (ICP, brand map, story board, communication guideline, offer) are compiled into three briefs: analysis, generation, voice. | `backend/services/client_dna_compile.py`, `client_context_generate.py`, `dna_chat_update.py` | `/context` |
| 3 | **Discover** | Finds competitor accounts from niche keywords and similarity. | `jobs/competitor_discovery.py`, `services/keyword_similarity_discovery.py` | Intelligence → Competitors |
| 4 | **Scrape** | Pulls reels for the creator and each competitor from Instagram through Apify. | `jobs/baseline_scrape.py`, `jobs/profile_scrape.py`, `jobs/niche_reel_scrape.py`, `jobs/keyword_reel_similarity.py` | Refresh button, daily jobs |
| 5 | **Track** | Re-fetches views, likes and comments of recent reels and appends a row to `reel_snapshots`. | `jobs/scraped_reels_refresh.py` | Daily job |
| 6 | **Score and analyse** | Flags breakouts (reel vs the account's usual reach), classifies format, and runs a Gemini analysis of the post media. | `services/breakout_recompute.py`, `services/format_classifier.py`, `jobs/reel_analyze_url.py`, `jobs/auto_analyze_scraped.py`, `jobs/format_digest_recompute.py` | Intelligence tabs, "Analyze a reel" |
| 7 | **Learn** | Diagnoses each of the creator's own reels against her own median and stores hook and angle votes. The result is added to generation prompts. | `services/reel_diagnostics.py`, `services/learning_context.py`, `routers/learning.py` | Dashboard → learning panel |
| 8 | **Generate** | Pattern synthesis, five angles, then hooks, script, caption and story texts. | `services/content_generation.py`, `routers/generation.py` | `/generate` |
| 9 | **Create** | Covers, carousels, background images and the rendered video. | `routers/creation.py`, `services/image_generation.py`, `services/video_render.py`, `video-production/broll-caption-editor` | `/generate/<session>`, `/media` |
| 10 | **Publish** | Not built. Download the MP4 and copy the caption, then post by hand. `/scheduling` is a placeholder. | — | — |

---

## 2. Components and who is responsible for what

### 2.1 Dashboard (`content-machine/`)

| Route | Responsible for |
|---|---|
| `/dashboard` | Headline numbers for the creator's own reels, a views/likes/comments trend chart, niche finds, competitor breakouts, learning panel. |
| `/intelligence` | Tabs: Adapt today, Your reels, Niche finds, Hot now, Still winning, Saved. Refresh button opens the sync dialog. |
| `/intelligence/reels` | Full reels catalog with filters (source, media type, creator, views, dates, favourites) and bulk analyse/delete. |
| `/intelligence/competitors`, `/intelligence/breakouts` | Tracked creators, and the breakout list. |
| `/generate`, `/generate/<id>` | Start from an idea or recreate a reel, pick an angle, edit hooks, script and caption, then the cover, carousel and video steps. `/create` redirects here. |
| `/media` | Renders, covers, B-roll clips and images produced or uploaded. |
| `/context` | Edit the strategy documents and rebuild the AI profile. |
| `/settings` | Next steps (calls to action), carousel and cover styles, niche keywords, your API key. |
| `/scheduling` | "Coming soon" placeholder. |

The browser never calls the API directly. It calls the same-origin proxy `content-machine/src/app/api/backend/[...path]/route.ts`, which forwards to `CONTENT_API_URL`. Server components call the API with the absolute URL. Thumbnails go through `/api/thumbnail-proxy`, which only fetches `*.cdninstagram.com` and `*.fbcdn.net` because Instagram's signed image URLs expire and 403 when fetched from the browser.

### 2.2 API (`backend/main.py`, `backend/routers/`)

All routes are under `/api/v1`. Every route except `/health` requires credentials (a test in `backend/tests/test_auth_access.py` checks every route).

| Router | Responsible for |
|---|---|
| `clients.py` | Create and read clients, brand theme, DNA regenerate and chat edits. |
| `intelligence.py` | Competitors, baseline, sync (`/sync/own`, `/sync/competitors`, `/sync`), reels list and metrics, analyse by URL or in bulk, niche config, stats and activity. |
| `generation.py` | `generate/start`, format recommendation, sessions, thumbnails. |
| `creation.py` | Session editing, video spec edits, background generation, B-roll, render, carousel ZIP. |
| `context.py` | Upload and generate context documents. |
| `learning.py` | Own-reel diagnostics, link a post to a generated session, learning settings, hook and angle votes. |
| `client_images.py` | Reference image library per client. |
| `jobs.py` | Read the status of a background job. |
| `cron.py` | Endpoints called by schedulers. They enqueue jobs and return immediately. |

`POST /clients/{slug}/sync/own` is the only sync that runs inline: it waits for the scrape and returns the job result (`result.own_reels_stored`, or `result.skipped` when Instagram returned no recent reels). `sync/competitors` starts a thread and returns at once.

### 2.3 Worker and job queue (`backend/worker.py`, `backend/jobs/`)

The worker polls `claim_next_job` every 5 seconds and runs one job at a time. `GET /api/v1/jobs/{id}` shows the status and `result`.

| `job_type` | Does | Started by |
|---|---|---|
| `baseline_scrape` | Last 30 days of the creator's reels; writes a `client_baselines` row (the "Last refreshed" date), upserts own reels, writes snapshots. | Manual only: `POST /sync/own`, `/sync`, `/baseline/refresh` (the Refresh button) |
| `profile_scrape` | Reels for one competitor, or the creator when `scrape_own` is set. | Daily tick, `sync-all`, add competitor |
| `competitor_discovery` | Finds and scores candidate competitors. | `POST /competitors/discover` |
| `keyword_reel_similarity` | Niche discovery: keyword search, enrich, Gemini similarity gate, store. | Niche cron, daily tick |
| `niche_reel_scrape` | Older keyword discovery. Deprecated, still reachable. | Intelligence router |
| `scraped_reels_refresh` | Updates views/likes/comments and thumbnails of reels under 14 days old (max 500 per run, skips rows updated in the last 20 hours); appends snapshots; recomputes diagnostics. | Daily cron, daily tick |
| `reel_analyze_url` | Downloads the video or slides of one post and has Gemini score it. | Analyze a reel |
| `reel_analyze_bulk`, `auto_analyze_scraped` | Same, for many reels or for reels missing an analysis. | "Analyze selected" in the catalog; queued automatically after scrapes |
| `format_digest_recompute` | Rebuilds per-format statistics for the client. | After scrapes |
| `client_auto_profile` | Builds niche, ICP and competitor seeds from the creator's captions and bio. | `POST /auto-profile` |
| `batch_rescore_scraped_reels_similarity` | Re-scores existing reels in a date window. | Manual (`backend/enqueue_batch_rescore_scraped_reels_similarity.py`) |
| `milestone_scrape` | Deprecated by `scraped_reels_refresh`. | `cron/milestone-scrapes` |
| `daily_intelligence_tick` | Per-client fan-out: own profile scrape, every competitor, keyword similarity, reels refresh. | Worker scheduler |
| `video_render` | Remotion render and upload. | `POST /create/sessions/{id}/render` |
| `broll_normalize` | Transcodes an uploaded B-roll clip to a render master. | `POST /broll` (upload) |

Renders: the API starts the render in-process right after responding if the worker has not claimed the job yet (`creation.py::_dispatch_video_render_job`), so a render can run in either service.

### 2.4 Schedulers

There are three kinds of scheduler (GitHub Actions, Vercel cron, and the worker's own loop), and they overlap. Read this before changing any of them.

| Scheduler | Schedule | Calls | Notes |
|---|---|---|---|
| GitHub Actions `cron-sync-all.yml` | 05:00 UTC | `POST /cron/sync-all` | Enqueues own and competitor `profile_scrape` jobs (2-day lookback, 30 results). Does **not** start a baseline. |
| GitHub Actions `cron-niche-discovery.yml` | 06:00 UTC | `POST /cron/niche-discovery` | Enqueues `keyword_reel_similarity`. |
| GitHub Actions `cron-scraped-reels-refresh.yml` | 06:30 UTC | `POST /cron/scraped-reels-refresh` | Enqueues `scraped_reels_refresh`. |
| Vercel cron (`content-machine/vercel.json`) | 05:00 UTC | `/api/cron/daily-sync` → `sync-all` and `recompute-breakouts` | Overlaps with the GitHub sync-all. Duplicate starts are skipped while a job of the same kind is active. |
| Worker `schedule_loop` | Every 60 s checks `cron_schedules` | Enqueues `daily_intelligence_tick` | Only works if a row exists in `cron_schedules` for the client (see `backend/sql/phase17_cron_schedules.sql`). No code in this repo creates those rows. |

Important: a green GitHub run only means the endpoint returned 200, i.e. jobs were **enqueued**. Whether they worked is recorded in `background_jobs.status` and `result`, and in the worker logs. See [Troubleshooting](#8-operating-it).

`POST /cron/cleanup-renders` (deletes renders older than 30 days) exists, but I found no scheduler that calls it.

### 2.5 External services

See [section 3](#3-services-and-api-keys) for every outside service, the key it needs and why.

### 2.6 Prompts

Prompts live in code, not in a prompt database. To change what the model is told, edit:

| What | File |
|---|---|
| Angles, hooks, script, caption, stories, covers, carousel copy | `backend/services/content_generation.py` (`GENERATION_PROMPT_VERSION`) |
| Reel analysis and scoring | `backend/services/reel_analyze_prompt.py` |
| AI profile briefs (analysis, generation, voice) | `backend/services/client_dna_compile.py` |
| Context documents from onboarding | `backend/services/client_context_generate.py` |
| Chat edits of the profile | `backend/services/dna_chat_update.py` |
| Niche keywords | `backend/services/niche_keywords_compile.py` |
| Format digests | `backend/services/format_digest.py` |
| Learning block added to generation | `backend/services/learning_context.py` |
| Video spec edits by prompt | `backend/services/video_spec_edit.py` |

`docs/prompts_for_generation.md` and `docs/client_dna.md` describe the intent; the code is the source of truth.

### 2.7 Video spec and rendering

Every video is described by one JSON "video spec" (hooks, text blocks, background, layout, template and theme). It exists in three places that must agree:

| Copy | Path | Used for |
|---|---|---|
| Validation and defaults | `backend/models/video_spec.py`, `services/video_spec_*.py` | The API validates, patches, times and defaults the spec before saving or rendering |
| Dashboard player | `content-machine/src/remotion-spec/` | Live preview in the editor |
| Render project | `video-production/broll-caption-editor/src/remotion-spec/` | The final MP4 (composition id `video-spec` in `src/Root.tsx`) |

The two Remotion trees are hand-synced (the plan to merge them is in `docs/remotion-spec-shared.md`). `npm run check:remotion-drift` compares them, but it is not run by CI and it **currently fails** on `Renderer.tsx`, `schema.ts` and `textTreatment.ts`. The differences I looked at are the dashboard copy's extra imports and type-coercion helper, comments, and quote style; I did not verify that the two copies behave identically. Until they are merged, any change to the spec must be made in both trees and checked by rendering, otherwise the preview can differ from the MP4.

Render flow: `POST /create/sessions/{id}/render` → job `video_render` → `services/video_render.py` runs the Remotion CLI with the system Chromium → uploads the MP4 to the `renders` bucket. B-roll uploads are first transcoded to a render master by `broll_normalize`.

### 2.8 Data model

Core tables are `clients`, `competitors`, `scraped_reels`, `client_baselines`, `background_jobs`, plus the organisation tables (`organizations`, `organization_members`, `profiles`). Tables added by the SQL files in `backend/sql/`: `reel_snapshots`, `reel_analyses`, `format_digests`, `generation_sessions`, `broll_clips`, `client_images`, `cron_schedules`, `hook_votes`, `reel_diagnostics`, `apify_run_slots`, `openrouter_rate_limit`.

Known gap (see section 9): the SQL files are incremental (`phaseN_*.sql`). There is no base schema file for the core tables, so a brand-new Supabase project cannot be built from this repo alone. Dump the live schema into `backend/sql/` before handing over to someone who must create a new environment.

### 2.9 Scoring rules worth knowing

- **Breakout (outlier):** `recompute-breakouts` recomputes each competitor's average views, likes and comments from its stored reels and flags a reel whose views, likes or comments exceed that average by `clients.outlier_ratio_threshold` (5.0 for new clients). It uses stored data only and does not call Apify.
- **Competitor tiers:** `scrape-cycle` treats tier 1–2 competitors as stale after 7 days and tier 3 after 30 days; tier 4 and above are never scraped automatically.
- **Niche similarity gate:** Gemini scores niche reels against the creator's AI profile; the batch re-score job defaults to a threshold of 80.
- **Formats:** the classifier knows `talking_head`, `text_overlay`, `carousel`, `skit`, `voiceover`, `b_roll_reel`, `screen_recording`, `montage` and more (`services/format_classifier.py`). The Create screen currently offers Text overlay, Talking head and Carousel, and shows how many niche reels exist for each.

### 2.10 Auth and tenancy

1. The user signs in through Supabase Auth in the dashboard.
2. Each profile has an `api_key`. The dashboard sends it as `X-Api-Key` together with `X-Org-Slug`.
3. `backend/core/deps.py::require_org_access` checks the key and that the user is a member of that organisation. `resolve_client_id` finds the client by slug **inside that organisation only**.
4. The API uses the Supabase service-role key, so these two functions are the isolation boundary.

---

## 3. Services and API keys

Everything below is an account someone has to own and pay for. Apart from the keys, nothing else is needed to run the system.

### 3.1 At a glance

| Service | What it does for this system | Why it is needed | Key / variable | If it is missing or wrong |
|---|---|---|---|---|
| **GitHub** | Holds the code, runs CI and the three daily cron workflows, triggers deploys from `main` | Without it nothing runs daily and nothing deploys | Actions secrets `CRON_SECRET`, `SYNC_ALL_URL`, `NICHE_DISCOVERY_CRON_URL`, `SCRAPED_REELS_REFRESH_URL` | Daily scrapes stop. The `sync-all` workflow fails loudly with "Set Actions secrets" when they are missing |
| **Vercel** | Hosts the dashboard and runs one cron (`/api/cron/daily-sync`) | The UI the team and the client use | `SUPABASE_*`, `CONTENT_API_URL`, `CRON_SECRET` (see 4.2) | The site fails to load or cannot sign in (`/api/health/env` shows which variable is missing) |
| **Railway** | Runs the **API** and the **worker** as two services built from the same image | The API serves every dashboard request and the worker runs all scraping, analysis and rendering jobs | The variables in 4.1 | API down: the dashboard shows errors. Worker down: jobs stay `queued` and nothing refreshes |
| **Supabase** | Login, the Postgres database, and file storage (renders, B-roll, reference images, context uploads) | It is the only data store | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Everything fails |
| **Apify** | Scrapes Instagram: the creator's reels, competitors' reels, keyword and account search, and post media for analysis | Instagram has no usable public API; this is the only source of reel data | `APIFY_API_TOKEN` | All scraping fails with HTTP 401, and "Analyze a reel" fails too. Existing data stays but goes stale |
| **OpenRouter** | Routes every LLM call to Google Gemini | Analysis, similarity scoring, AI profile, angles, hooks, scripts, captions, covers and stories | `OPENROUTER_API_KEY` | Generation and analysis fail. `cron/niche-discovery` returns 503 without it |
| **Freepik** | Generates the background image used by covers and carousels | Covers and carousel images | `FREEPIK_API_KEY` (API service only) | Those routes return 503 "FREEPIK_API_KEY not configured". The rest of the app works |
| **Remotion + Chromium** | Renders the final MP4 from the video spec | Video output | none (`REMOTION_EDITOR_DIR` is a path, set by the Dockerfile) | Renders fail; everything else works |
| **Google Fonts** | Fonts for covers (downloaded at runtime from `github.com/google/fonts` via `raw.githubusercontent.com`), Remotion captions and the dashboard | Typography | none | Cover generation tries the other fonts and raises an error if none can be downloaded; the dashboard build fetches fonts at build time |

Secrets you generate yourself (not issued by a service):

| Secret | What it is | Why | Must match in |
|---|---|---|---|
| `CRON_SECRET` | A long random string | Proves a scheduler call is yours. Without it the cron routes return 503; with a wrong value, 401 | Railway API service, Vercel, GitHub Actions secret |
| Profile `api_key` | One key per user, stored in the Supabase `profiles` table (shown under Settings) | The dashboard sends it as `X-Api-Key` on every API call; it identifies the user to the API | Created at onboarding |

### 3.2 Per service: what to know

**GitHub.** Repository `ToDa-Inc/silas-content-system`. Pushing to `main` redeploys both Railway services (verified). The dashboard is hosted on Vercel and is expected to deploy from the same repository, but I could not check that setting. GitHub switches scheduled workflows off after 60 days without repository activity; if the daily runs stop, open **Actions** and re-enable them. A green run only means the endpoint answered; see [section 8](#8-operating-it).

**Vercel.** Production URL `https://silas-content-system.vercel.app`. The app lives in `content-machine/`, so the Vercel project's Root Directory must be `content-machine` (from the earlier setup notes; not re-checked). I could not find the project in the Vercel accounts I have access to (`boookedin`, `danilovichz's projects`), so it belongs to another account: record which one. After changing environment variables, redeploy. In Supabase, the Vercel URL must be listed under Authentication → URL configuration.

**Railway.** One project (`honest-intuition`) with two services in the `production` environment: `silas-content-system` (the API, public, health check `/health`) and `perfect-upliftment` (the worker, start command `python worker.py`). The API holds nine variables, the worker five (the worker does not need `CRON_SECRET`, `CORS_ORIGINS` or `FREEPIK_API_KEY`). Setting a variable redeploys that service. The project sits in a Railway workspace named "toni478's Projects"; check whose account that is before handing over.

**Supabase.** Three keys with different power:
- `SUPABASE_URL` is the project address.
- `SUPABASE_ANON_KEY` is public and is used by the browser for sign-in.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security. The API, worker and the dashboard's server routes use it, and tenant isolation is enforced in the API code (section 2.10). Never expose it to the browser.
Get them from the Supabase dashboard under Project Settings → API.

**Apify.** Pay-per-result. The actors in use are `apify/instagram-reel-scraper` (own and competitor profiles), `apify/instagram-scraper` (enrich by URL, media for analysis), `sasky/instagram-keyword-posts-urls-scraper` (niche keyword discovery) and `apify/instagram-search-scraper` (account search). The token comes from the Apify console (Settings → API & integrations). Usage limits apply to the whole Apify account, not per client: when the plan's monthly limit is reached, scrapes fail and the job result records `apify_usage_limit`. As of 2026-11-17 the token in Railway belongs to a free-plan account with a $5 monthly limit; confirm the plan before relying on the daily jobs. The code estimates about $0.0023 per enriched post.

**OpenRouter.** Default model `google/gemini-3.8-flash`, fallback `google/gemini-3.1-flash-lite-preview` (override with `OPENROUTER_MODEL`, `OPENROUTER_MODEL_FALLBACK`, `OPENROUTER_REEL_ANALYZE_MODEL`). The key comes from openrouter.ai/keys. The account needs credits; a 429 means rate limiting, and the code paces calls at 15 per minute by default. A new key can be tested by generating angles on the Create page.

**Freepik.** Used in `backend/services/image_generation.py` to generate a washed background image behind cover and thumbnail text. Only the API service calls it.

**Not used.** `OPENAI_API_KEY` is declared in `core/config.py` but nothing reads it; it can be deleted from Railway. No other third-party API keys are used by the backend or dashboard.

### 3.3 Rotating a key

| Key | Change it in | Then |
|---|---|---|
| `APIFY_API_TOKEN` | Railway: API **and** worker | Railway redeploys both. Run one workflow from GitHub Actions to confirm |
| `OPENROUTER_API_KEY` | Railway: API **and** worker | Generate angles once |
| `FREEPIK_API_KEY` | Railway: API | Generate a cover |
| `SUPABASE_SERVICE_ROLE_KEY` | Railway: API and worker; Vercel | Redeploy Vercel |
| `SUPABASE_ANON_KEY` / `SUPABASE_URL` | Vercel; Railway if present | Redeploy Vercel; sign in |
| `CRON_SECRET` | Railway API; Vercel; GitHub Actions secret | Redeploy; run a workflow manually |

### 3.4 Handover checklist

- [ ] Accounts and owners recorded for GitHub, Vercel, Railway, Supabase, Apify, OpenRouter, Freepik. Known so far: Railway workspace "toni478's Projects"; the Vercel project is not in the `boookedin` or `danilovichz's projects` Vercel accounts.
- [ ] Apify plan and monthly limit match the daily job volume.
- [ ] `CRON_SECRET` identical on Railway, Vercel and GitHub.
- [ ] `OPENAI_API_KEY` removed from Railway.
- [ ] The three GitHub workflows are enabled.
- [ ] A full schema dump of Supabase added to `backend/sql/` (section 9).

---

## 4. Environment variables reference

Exact variable names, defaults and which service reads them. The reasons are in [section 3](#3-services-and-api-keys).

### 4.1 API service and worker (Railway)

Both services use `backend.Dockerfile` and should hold the same values for anything they both use.

| Variable | Needed by | Purpose |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | API, worker | Database access |
| `SUPABASE_ANON_KEY` | API, worker | Present in production; not read by `core/config.py` |
| `APIFY_API_TOKEN` (alias `APIFY_API_KEY`) | API, worker | Scraping. A revoked token makes every scrape fail with HTTP 401 |
| `OPENROUTER_API_KEY` | API, worker | LLM calls |
| `CRON_SECRET` | API | Checked on every `/cron/*` call (`X-Cron-Secret`) |
| `CORS_ORIGINS` | API | Allowed browser origins |
| `FREEPIK_API_KEY` | API | Covers and carousel images. Missing key returns 503 on those routes |
| `REMOTION_EDITOR_DIR` | API | Path of the Remotion project (`broll-caption-editor`). Set to `/opt/broll-caption-editor` by `backend.Dockerfile`; only set it yourself when running outside Docker |
| `REMOTION_BROWSER_EXECUTABLE` | API | Set to `/usr/bin/chromium` by the Dockerfile |
| `OPENROUTER_MODEL`, `OPENROUTER_MODEL_FALLBACK`, `OPENROUTER_REEL_ANALYZE_MODEL` | optional | Override the models |
| `OPENROUTER_REQUESTS_PER_MINUTE`, `OPENROUTER_MIN_INTERVAL_S`, `OPENROUTER_SCORING_WORKERS`, `OPENROUTER_429_*` | optional | Rate limiting (defaults 15 rpm, 1 s, 4 workers) |
| `APIFY_REEL_ACTOR`, `APIFY_INCLUDE_SHARES_COUNT`, `OWN_REELS_SYNC_RESULTS_LIMIT`, `APIFY_SLOT_*` | optional | Scraper tuning (defaults: reel scraper, no shares, 100 reels) |
| `DEFAULT_ORG_SLUG` | optional | Fallback organisation |

`OPENAI_API_KEY` is declared in `core/config.py` but no code reads it. It can be removed from Railway.

### 4.2 Dashboard (Vercel, root directory `content-machine`)

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` + `SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | Sign-in |
| `SUPABASE_SERVICE_ROLE_KEY` | Server routes (onboarding, workspace bootstrap) |
| `CONTENT_API_URL` | Public URL of the FastAPI service. Must not be `localhost` in production |
| `CRON_SECRET` | Authorises `/api/cron/daily-sync` (same value as the API) |

Health check: `/api/health/env`. In Supabase → Authentication → URL configuration, add the Vercel URL to Site URL and Redirect URLs.

### 4.3 GitHub Actions secrets

`CRON_SECRET`, `SYNC_ALL_URL`, `NICHE_DISCOVERY_CRON_URL`, `SCRAPED_REELS_REFRESH_URL`. Each URL is the full address of the matching `/api/v1/cron/...` route on the **Python API**, not the dashboard. GitHub disables scheduled workflows after 60 days without repository activity, so check **Actions** if the daily runs stop.

---

## 5. Run it locally

Prerequisites: Node 20.9+ (the Docker images use Node 22), Python 3.12, ffmpeg.

```bash
cp .env.example .env                       # fill SUPABASE_*, APIFY_API_TOKEN, OPENROUTER_API_KEY, CRON_SECRET
npm install                                # root (concurrently)
npm install --prefix content-machine
(cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt)
npm run dev:full                           # API :8787 + dashboard :3000 + worker
```

| Command | Starts |
|---|---|
| `npm run dev:api` | FastAPI on 8787 |
| `npm run dev:worker` | Worker (needed for queued jobs) |
| `npm run dashboard` | Dashboard only |
| `npm run dev:all` / `dev:full` | API, dashboard and worker together |
| `npm run broll:studio` | Remotion studio for the render project |

Env load order: API/worker read repo `.env`, then `backend/.env`, then `config/.env`; Next reads repo `.env`, `config/.env`, then `content-machine/.env.local`.

Tests:

```bash
cd backend && pip install -r requirements-dev.txt && python -m pytest
```

CI (`.github/workflows/backend-tests.yml`) runs this on backend changes.

---

## 6. Deploy

| Piece | Where | Setup |
|---|---|---|
| Dashboard | Vercel | Root Directory `content-machine`. The build uses `next build --webpack`. |
| API | Railway service | Root Directory empty (repo root), Dockerfile `backend.Dockerfile`; no start command needed (the image's `CMD` runs uvicorn). Public networking on, health check `/health`. |
| Worker | Railway service, same project | Same image; start command `python worker.py`. Do not use `start.sh` here, it starts a second worker. |
| Database | Supabase | Run the files in `backend/sql/` (see the base-schema gap in 2.8). |
| Daily jobs | GitHub Actions + Vercel cron | Secrets in 4.3. |

Railway deploys from `main` automatically. Changing a variable redeploys that service. More detail: `backend/RAILWAY.md`.

Builder note: the Railway dashboard shows both services as "RAILPACK", but the root `railway.toml` forces `backend.Dockerfile`, and the build logs of both services show the Debian `chromium` install from that file. The repo root also holds a `railway.json` that points at the dashboard `Dockerfile`; the two files conflict, and today the `.toml` is the one in effect. Treat that as fragile: if either file changes, check the builder in the next build log. The dashboard itself runs on Vercel, not Railway.

---

## 7. Everyday tasks

**Add a client.** Through the dashboard: `/onboarding` creates the organisation, client and first niche config. For another creator in an existing organisation, `POST /api/v1/clients` creates the row. Then:
1. Fill `/context` with real onboarding material for that creator and rebuild the AI profile. Everything downstream (scores, angles, niche discovery) is derived from it.
2. Check Settings → niche keywords. Keywords are split on commas, semicolons and line breaks; a pasted sentence becomes a single keyword and drives niche discovery.
3. Run Refresh → Everything once to load reels and competitors.

**Refresh data now.** Intelligence → Refresh. "My reels only" runs `baseline_scrape` inline and reports how many reels were stored. "Tracked creators" runs in the background.

**Run a daily job by hand.** GitHub → Actions → pick the workflow → Run workflow, or call the route with the `X-Cron-Secret` header.

**Change what the AI writes.** Edit the prompt in the file listed in 2.6 and deploy.

---

## 8. Operating it

**"The GitHub jobs are green but there is no new data."** Green means the endpoint returned 200. Check, in this order:
1. Worker logs on Railway for `ApifyError`. `HTTP 401 … user-or-token-not-found` means `APIFY_API_TOKEN` is invalid; set a valid one on **both** services.
2. Apify → Billing: the account's monthly limit. A free plan has a small monthly cap that a daily competitor sync can exhaust.
3. `background_jobs` for rows stuck in `queued` or `running`.

Note: `scraped_reels_refresh` records Apify errors in `result.enrich_errors` and still finishes as `completed`, so a failed refresh does not show as failed.

**"Last refreshed" does not move.** That date comes from `client_baselines.scraped_at`, written only by `baseline_scrape`. No scheduler starts a baseline; only the manual Refresh does. Daily jobs still add snapshots.

**Costs.** Per-result Apify prices are on the actor pages; the refresh job estimates `results × $0.0023`. Keyword discovery and 147 tracked creators are the main daily cost.

---

## 9. Known gaps

- No base schema file for the core tables (2.8).
- The Remotion spec lives in two hand-synced trees and the drift check fails today (2.7).
- `/api/cron/niche-discovery` exists in the dashboard but `vercel.json` only schedules `daily-sync`.
- How a new user is created and linked to an organisation (profile, `api_key`, membership) is only implemented in the onboarding route; I did not find a separate admin flow.
- Nothing creates `cron_schedules` rows, so the worker scheduler is idle unless rows were inserted by hand. Verify in Supabase.
- `cleanup-renders` has no scheduler.
- No scheduler starts a baseline (section 8).
- Failed refresh jobs are recorded as completed (section 8).
- Publishing and scheduling are not built.

---

## Legacy and reference

The original prototype was a set of Node scripts that wrote JSON under `data/` (discovery, scraping, video analysis with ffmpeg and Whisper). The production system replaced them with the API and worker above. They remain in `scripts/` and `reference/` for reference and are not deployed:

`scripts/competitor-discovery.js`, `competitor-batch-discover.js`, `competitor-eval.js`, `scraper.js`, `analyze.js`, `smart-frame-extractor.js`, `vision-analyzer.js`, `transcribe.js`, `video-criteria-evaluator.js`; `backend/migrate.py` imports their JSON output into Supabase once.

Background documents: `docs/BACKEND-ARCHITECTURE.md`, `docs/INTELLIGENCE-GUIDE.md`, `docs/ANALYSIS_PIPELINE.md`, `docs/COMPETITOR-DISCOVERY.md`, `docs/client_dna.md`, `docs/remotion-spec-shared.md`. They are older than this file; where they disagree with the code, the code wins.
