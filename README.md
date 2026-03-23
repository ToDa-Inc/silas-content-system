# Silas Content System

AI-powered content automation pipeline for Instagram Reels. Built for Silas to manage content for info product creators (first client: Conny Gfrerer).

---

## Project Structure

```
silas-content-system/
├── README.md                          # This file
├── package.json
│
├── config/                            # Configuration
│   ├── .env                           # API keys (gitignored)
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
├── content-machine/                   # **Next.js dashboard** (Silas Prism) — App Router, Tailwind v4
│   ├── package.json
│   ├── src/app/                       # Routes: /dashboard, /generate, /intelligence, …
│   └── README.md
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

The repo has **multiple** entry points, so the root `package.json` uses **named** scripts only:

| What | From repo root |
|------|----------------|
| **Next.js dashboard** (`content-machine/`) | `npm run dashboard` (after `npm install --prefix content-machine`) |
| **B-roll Remotion studio** | `npm run broll:studio` (after `npm install --prefix video-production/broll-caption-editor`) |
| **Pipeline CLI** | `npm run scrape`, `npm run analyze`, etc. |

Dashboard URL: [http://localhost:3000](http://localhost:3000) → `/dashboard`. Details: `content-machine/README.md`.

### If `content-machine` looks empty on GitHub

**Common cause:** Git recorded `content-machine` as a **submodule** (broken / unpopulated). Then `git add content-machine/` stages **nothing**, and inside that folder you get `fatal: in unpopulated submodule 'content-machine'`.

**Fix:** follow **[docs/FIX-CONTENT-MACHINE-SUBMODULE.md](docs/FIX-CONTENT-MACHINE-SUBMODULE.md)** — remove the submodule entry, then add the folder as normal files.

**If it is not a submodule**, commit source like this (ignored: `node_modules/`, `.next/` only):

```bash
cd silas-content-system
git add content-machine/
git status   # expect package.json, src/, public/, configs
git commit -m "Add Next.js dashboard (content-machine)"
git push
```

If `git status` still shows nothing after the submodule fix, the files are missing on disk.

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
