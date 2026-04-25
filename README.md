# Content system (monorepo)

AI-powered content automation pipeline for Instagram Reels — multi-client dashboard and workers (example client config: Conny Gfrerer).

---

## Project Structure

```
silas-content-system/
├── README.md                          # This file
├── package.json
├── .env.example                       # Env template — copy to `.env` at repo root (API + worker + dashboard)
├── .env                               # Your secrets (gitignored — create from `.env.example`)
│
├── config/                            # Configuration
│   ├── .env                           # Optional: legacy keys for Node scripts (gitignored)
│   └── clients/                       # Per-client niche profiles
│       └── conny-gfrerer.json         # Conny's niches, ICP, keywords
│
├── scripts/                           # Core automation scripts
│   ├── competitor-discovery.js        # Find competitors (keyword/URL/username)
│   ├── competitor-batch-discover.js   # Run multiple keyword searches at once
│   ├── competitor-eval.js             # Rank competitors against client baseline
│   ├── scraper.js                     # Apify reel scraper
│   ├── analyze.js                     # Video analysis entry point
│   ├── smart-frame-extractor.js       # Extract key frames from video
│   ├── vision-analyzer.js             # AI vision analysis of frames
│   ├── transcribe.js                  # Whisper transcription
│   └── video-criteria-evaluator.js    # Score against 5 outlier criteria
│
├── data/                              # Generated data (gitignored)
│   └── niches/
│       └── conny-gfrerer/
│           ├── baseline.json          # Client's own metrics (auto-cached)
│           ├── current-competitors.json # Latest ranked competitor list
│           ├── competitors/           # Raw discovery results (per keyword)
│           └── evaluations/           # Full evaluation reports (timestamped)
│
├── context/                           # Business context & strategy
│   ├── master-plan.md                 # Full project vision & pipeline
│   ├── niche-strategy.md              # Niche breakdown for Conny
│   └── proposal-silas.md              # Client proposal
│
├── docs/                              # Documentation
│   ├── COMPETITOR-DISCOVERY.md        # How the discovery system works
│   ├── DISCOVERY-LEARNINGS.md         # What we learned (German market findings)
│   ├── COMPLETE_PROJECT_PLAN.md       # Original project plan
│   ├── ANALYSIS_PIPELINE.md           # Video analysis workflow
│   ├── CRITERIA.md                    # 5 outlier criteria explained
│   ├── VIDEO_ANALYSIS_CRITERIA.md     # Detailed criteria guide
│   └── INTEGRATION.md                 # Integration notes
│
├── dashboard/                         # Legacy static HTML (reference)
│   ├── index.html                     # Main dashboard
│   ├── mockup.html                    # Design mockup
│   └── ARCHITECTURE.md                # Dashboard architecture
├── dashboard_code.md                  # Exported HTML prototype (Stitch/AI) — UI reference only
├── content-machine/                   # **Next.js dashboard** (Prism) — App Router, Tailwind v4
│   ├── package.json
│   ├── src/app/                       # Routes: /dashboard, /generate, /intelligence, …
│   └── README.md
│
├── backend/                           # **Phase 1 API** — FastAPI + Supabase + worker (default port **8787**)
│   ├── README.md                      # Runbook (uvicorn, worker, migrate)
│   ├── sql/                           # Phase 1 schema + RLS (run in Supabase)
│   └── migrate.py                     # JSON → Supabase one-time import
│
├── video-production/                  # B-roll + caption generation
│   └── broll-caption-editor/          # Remotion-based caption overlay tool
│       ├── src/                       # React/Remotion components
│       ├── generate-captions.js       # Caption generation script
│       └── QUICKSTART.md
│
├── assets/                            # Static assets (sample videos, etc.)
│   └── IMG_9451_3.mp4                 # Sample B-roll video
│
└── reference/                         # Reference material (not active code)
    ├── video-analyzer/                # Original video-analyzer repo (github.com/danilovichz/video-analyzer)
    │   ├── SKILL.md                   # Full documentation for video analysis skill
    │   ├── README.md
    │   ├── analyze.js                 # Original analysis scripts
    │   ├── scraper.js
    │   ├── smart-frame-extractor.js
    │   ├── vision-analyzer.js
    │   ├── transcribe.js
    │   ├── video-criteria-evaluator.js
    │   └── .env.example
    └── legacy/                        # Old planning docs (pre-consolidation)
        ├── silasproject.md            # Original master document
        ├── apify-scraping-reference.md # Apify technical reference
        ├── niche-strategy-original.md # Original niche strategy (Silas wrote this)
        ├── INTEGRATION.md
        └── tweet.md
```

---

## Starting apps (explicit scripts — no generic `dev` at root)

**API + dashboard:** the **backend** (FastAPI on **8787**) and the **frontend** (Next on **3000**) are two processes. Running only `npm run dev` inside `content-machine/` starts the **dashboard UI**; pages that call the API (e.g. Intelligence) need the API up too.

From **repo root** `silas-content-system/`:

```bash
npm run dev:all
```

That runs **API + dashboard** only. **Queued scrapes and other `background_jobs` need the worker** — same env as the API (`APIFY_API_TOKEN`, Supabase service role, etc.):

```bash
npm run dev:full
```

That runs **API + dashboard + worker** in one terminal. Or add a second terminal: `npm run dev:worker` (equivalent to `cd backend && python3 worker.py`) while `dev:all` is already running.

The repo has **multiple** entry points, so the root `package.json` uses **named** scripts only:

| What | From repo root |
|------|----------------|
| **FastAPI** (`backend/`, port **8787**) | `npm run dev:api` (after `npm install` at root for `concurrently`, plus backend venv + deps) |
| **Dashboard + API together** | `npm run dev:all` |
| **Background worker** (scrapes / `background_jobs`) | `npm run dev:worker` — not included in `dev:all` |
| **API + dashboard + worker** | `npm run dev:full` |
| **Next.js dashboard only** | `npm run dashboard` (or `cd content-machine && npm run dev` — same thing; **no API**) |
| **B-roll Remotion studio** | `npm run broll:studio` (after `npm install --prefix video-production/broll-caption-editor`) |
| **Pipeline CLI** | `npm run scrape`, `npm run analyze`, etc. |

Dashboard URL: [http://localhost:3000](http://localhost:3000) → `/dashboard`. Details: `content-machine/README.md`.

**Environment:** `cp .env.example .env` at the repo root (or use `config/.env` — already loaded by the API and by Next via `next.config`). Use **`SUPABASE_URL` + `SUPABASE_ANON_KEY`** (no `NEXT_PUBLIC_*` in `.env`); the dashboard maps them for the browser. Optional overrides: `backend/.env`, `content-machine/.env.local`.

### Dashboard not showing on GitHub?

Only `node_modules/` and `.next/` under `content-machine/` are ignored. Commit the rest:

```bash
git add content-machine/
git commit -m "Add or update dashboard" && git push
```

If `git add content-machine/` stages nothing but files exist on disk, the path was likely added as a **submodule** by mistake: `git rm --cached content-machine`, remove any `content-machine/.git`, then `git add content-machine/` again.

### Vercel (`404 NOT_FOUND` / empty deploy)

The Next.js app is in **`content-machine/`**, not the repo root. If **Root Directory** stays `.`, Vercel has no `next build` there and the deployment can show a platform **404**.

**Fix:** Vercel → **Project → Settings → General → Root Directory** → **`content-machine`** → Save. Leave **Install Command** and **Build Command** as defaults (`npm install`, `npm run build`). Redeploy (Deployments → … → Redeploy).

`content-machine/vercel.json` sets the **Next.js** framework preset for that app.

**If the deploy succeeds in logs but the site shows `404 NOT_FOUND` (Vercel error page):** Next.js 16 defaults to **Turbopack** for `next build`; some Vercel pipelines still mis-handle that output. This repo uses **`next build --webpack`** in `content-machine/package.json` so production matches the classic bundler Vercel expects. Push, redeploy, then open the **Visit** URL on that exact deployment (not an old bookmark).

**Environment variables** (Production and Preview): mirror your local `.env` — at minimum **`SUPABASE_URL`**, **`SUPABASE_ANON_KEY`**, **`SUPABASE_SERVICE_ROLE_KEY`** (server routes), and **`CONTENT_API_URL`** (public URL of your FastAPI API, not `localhost`). Add the same keys for **Preview** if you open preview deployments. You can use **`NEXT_PUBLIC_SUPABASE_URL`** and **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** instead of the `SUPABASE_*` names; they are equivalent for the dashboard.

If the site loads but shows **“Application error” / a digest**, open Vercel → the deployment → **Logs** (or **Runtime Logs**) and search for the error text — often **missing Supabase env** or a failed Supabase query. `next.config` only injects `NEXT_PUBLIC_*` when values exist locally so empty strings from a missing `.env` at build time do not override Vercel’s variables.

**Checklist:** After deploy, open **`https://<your-deployment>/api/health/env`**. If `supabaseConfigured` is `false`, variables are still not on that environment — enable **Preview** (not only Production) for branch/preview URLs, or confirm you edited variables on **this** Vercel project (same Git repo + Root Directory `content-machine`). Build logs will show a **`[content-machine] Supabase env missing during Vercel build`** warning if keys were absent when `next build` ran.

Supabase → **Authentication → URL configuration**: add your Vercel URL (`https://…vercel.app`) to **Site URL** and **Redirect URLs**.

### Railway (Railpack / “No start command detected”)

The dashboard service has one supported Docker setup:

1. **Settings → Root Directory** → **`content-machine`**.
2. **Dockerfile path** → `Dockerfile` (the Dockerfile in that root).
3. **Builder** → `DOCKERFILE`.
4. **Start Command** → leave empty or `node server.js` (not `bash`). `content-machine/railway.json` pins this as `node server.js`.

The root **`package.json`** now also defines **`start`** and **`build`** pointing at `content-machine/` so Railpack can fall back if Docker is not used.

**Variables** (same as Vercel): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CONTENT_API_URL`, etc. Enable them for **build** where Railway offers it, so Docker `ARG`s receive values.

Health check: **`/api/health/env`**.

**FastAPI (cron / GitHub Actions):** the repo-root **`Dockerfile`** builds the **Next.js dashboard** only (not the Python API). Cron URLs such as `POST /api/v1/cron/sync-all` must target the **Python API**. Add a **second Railway service** with **Root Directory** empty (repo root), **`backend.Dockerfile`**, and the same secrets the API needs (`CRON_SECRET`, Supabase service role, Apify, OpenRouter, …). Step-by-step: **`backend/RAILWAY.md`**. If `SYNC_ALL_URL` / niche cron return **404** with `{"detail":"Not Found"}`, that URL is not running this repo’s FastAPI (wrong service or stale image).

---

## Quick Start

### Prerequisites
- Node.js 18+
- ffmpeg (`brew install ffmpeg`)
- API keys in `config/.env`:
  - `APIFY_API_TOKEN` — Instagram scraping
  - `OPENROUTER_API_KEY` — Gemini Flash for analysis
  - `OPENAI_API_KEY` — Whisper transcription

### Competitor Discovery
```bash
# Find competitors by keyword
node scripts/competitor-discovery.js --client conny-gfrerer --keyword "leadership coach"

# Batch search with all German keywords from config
node scripts/competitor-batch-discover.js --client conny-gfrerer --lang de --eval

# Evaluate all discovered competitors against client baseline
node scripts/competitor-eval.js --client conny-gfrerer
```

### Video Analysis
```bash
# Analyze a competitor's top reels
node scripts/analyze.js --username thebigapplered --limit 10

# Analyze a specific reel
node scripts/analyze.js --url "https://www.instagram.com/reel/XXXXX/" --full
```

---

## Pipeline Status

| Phase | Status | Script |
|-------|--------|--------|
| 1. Competitor Discovery | ✅ Working | competitor-discovery.js + eval |
| 2. Video Scraping | ✅ Working | scraper.js |
| 3. Video Analysis | ✅ Working | analyze.js + vision + transcribe |
| 4. Hook/Script Generation | ⬜ Not started | — |
| 5. B-roll + Caption Creation | 🟡 Prototype | video-production/broll-caption-editor/ |
| 6. Dashboard | 🟡 Next.js UI | `content-machine/` — `npm run dashboard` from repo root |
| 7. Scheduling (Postiz) | ⬜ Not started | — |

---

## API Costs

| Operation | Cost | Notes |
|-----------|------|-------|
| Apify keyword search | ~$0.03 | Per search |
| Apify reel scrape | ~$0.0026 | Per reel |
| Gemini 3 Flash (relevance) | ~$0.002 | Per account |
| Whisper transcription | ~$0.006 | Per minute |
| Vision analysis | ~$0.0004 | Per frame |

Full competitor discovery + eval cycle: ~$0.20
Per video analysis: ~$0.01-0.05
