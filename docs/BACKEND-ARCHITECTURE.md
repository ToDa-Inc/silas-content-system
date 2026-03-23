# Backend Architecture — FastAPI + Supabase

**Status:** Reference design — to be implemented
**Last updated:** 2026-03-23
**Decision:** FastAPI (Python) + Supabase (Postgres + Auth + RLS)

---

## Why this stack

- **FastAPI (Python):** Consistent with company backend standard. Better AI/ML ecosystem (Anthropic SDK, OpenAI SDK). Background worker as a separate process is natural in Python. Scales cleanly to SaaS — Next.js frontend stays thin, all business logic lives in FastAPI.
- **Supabase:** Postgres with built-in Auth, Row Level Security, and Storage. RLS enforces multi-tenant isolation at the DB level — a bug in application code cannot leak one org's data to another.
- **Not Next.js API routes:** The existing scripts are Node.js but will be ported to Python. FastAPI as a separate service is the right call for a SaaS with multiple future operators — not for one operator.

---

## Multi-tenancy model

```
auth.users (Supabase Auth)
    ↓
profiles           — extends auth.users with display_name etc.
    ↓
organizations      — the billing/tenant unit. Silas's agency = 1 org.
    ↓
organization_members — who belongs to which org + their role
    ↓
clients            — Conny is a client of Silas's org
    ↓
everything else    — scoped through client_id → org_id
```

Every table either has `org_id` directly or is reachable through a path that traces to it. Supabase RLS enforces this automatically on every query.

---

## Service architecture

```
┌─────────────────┐      ┌─────────────────────────────────┐
│   Next.js App   │─────▶│         FastAPI Service          │
│  (frontend UI)  │      │                                  │
└─────────────────┘      │  /api/v1/orgs/...                │
                         │  /api/v1/clients/...             │
                         │  /api/v1/intelligence/...        │
                         │  /api/v1/generate/...            │
                         │  /api/v1/queue/...               │
                         │                                  │
                         │  + background worker loop        │
                         │    polls background_jobs table   │
                         │    every 5s, processes queued    │
                         └──────────────┬──────────────────┘
                                        │
                                        ▼
                               ┌─────────────────┐
                               │    Supabase      │
                               │  Postgres + Auth │
                               │  + Storage       │
                               └─────────────────┘
```

**Two FastAPI processes:**
1. **API server** — handles HTTP from Next.js
2. **Worker** — asyncio loop polling `background_jobs WHERE status = 'queued'` every 5s, processes jobs (Apify, Gemini, Claude, renders), writes results back

No Redis, no Celery for Phase 1. Postgres as a queue handles tens of thousands of jobs/day. Scale infrastructure when revenue justifies it.

---

## Background jobs pattern

All async operations share one table. Single Responsibility: tracks operational state only. Output lives in domain tables.

```
POST /intelligence/discover  →  INSERT background_jobs (status: queued)  →  return { job_id }
Worker picks it up           →  UPDATE status: running
Worker calls Apify + Gemini  →  INSERT competitors rows
Worker finishes              →  UPDATE status: completed, result: { accounts_found, cost_usd }
Frontend polls               →  GET /jobs/{job_id}  →  redirect to competitors list when done
```

For safe concurrent processing across multiple workers:
```sql
SELECT * FROM background_jobs
WHERE status = 'queued'
ORDER BY priority DESC, created_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;
```

---

## Outlier detection logic (Phase 1)

Outlier detection is a **Phase 1** concern — it is computed at scrape time, not analysis time.

### Who is an outlier (Phase 1 — quantitative)

```
outlier_ratio = reel.views / competitor.avg_views

is_outlier = outlier_ratio >= 10.0
```

A post is an outlier if it performed **10x or more** above its account's average views. This is stored directly on the `scraped_reels` row.

- `outlier_ratio = 1.0` → typical post for that account
- `outlier_ratio = 5.0` → strong post
- `outlier_ratio = 10.0+` → **outlier** (study this)
- `outlier_ratio = 50.0+` → **viral breakout** (highest priority)

### Why it is an outlier (Phase 2 — qualitative, Claude)

Phase 2 runs Claude against each outlier using the 5-criteria scoring system from `docs/CRITERIA.md`:

| # | Criterion | What it measures |
|---|-----------|-----------------|
| 1 | Instant Hook | Attention in 0–2 seconds |
| 2 | High Relatability | "That happened to me" factor |
| 3 | Cognitive Tension | Curiosity or disagreement trigger |
| 4 | Clear Value | Insight, script, framework, or validation |
| 5 | Comment Trigger | Discussion and share potential |

Total score 1–50 → replicability rating:
- **40–50** → Highly Replicable (blueprint found)
- **30–39** → Strong Pattern (adapt for niche)
- **20–29** → Moderate
- **<20** → Weak

This scoring is stored in `reel_analyses` (Phase 2 table).

---

## Phase 1 API endpoints (what to build first)

```
# Clients
GET    /api/v1/clients                               list all clients (sidebar selector)
POST   /api/v1/clients                               create new client
GET    /api/v1/clients/{slug}                        get client + config
PUT    /api/v1/clients/{slug}                        update niche_config / icp / products

# Competitors — Discovery
GET    /api/v1/clients/{slug}/competitors            ranked competitor list from DB
POST   /api/v1/clients/{slug}/competitors/discover   trigger discovery job → { job_id }

# Competitors — Reel Scraping (Phase 1B — outlier detection)
POST   /api/v1/clients/{slug}/reels/scrape           scrape reels from all BLUEPRINT/STRONG competitors → { job_id }
GET    /api/v1/clients/{slug}/reels                  list scraped reels ordered by outlier_ratio DESC
                                                     supports filter: ?outlier_only=true

# Baseline
GET    /api/v1/clients/{slug}/baseline               latest non-expired baseline
POST   /api/v1/clients/{slug}/baseline/refresh       trigger re-scrape job → { job_id }

# Jobs (polling)
GET    /api/v1/jobs/{job_id}                         status + result of any background job
```

That is all Phase 1 needs. **Eight endpoints.**

---

## Full SQL schema

Run in order. Phase labels indicate when each block is needed.

```sql
-- ═══════════════════════════════════════════════════════
-- PHASE 1: Identity & Access
-- ═══════════════════════════════════════════════════════

CREATE TABLE profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text,
  avatar_url    text,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  plan        text DEFAULT 'free',   -- free | pro | agency
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE organization_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member',  -- owner | admin | member
  joined_at timestamptz DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE TABLE invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text DEFAULT 'member',
  token       text UNIQUE NOT NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════
-- PHASE 1: Client Management
-- ═══════════════════════════════════════════════════════

CREATE TABLE clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug              text NOT NULL,              -- "conny-gfrerer"
  name              text NOT NULL,
  instagram_handle  text,
  language          text DEFAULT 'de',
  niche_config      jsonb NOT NULL DEFAULT '[]',  -- array of niche objects
  icp               jsonb NOT NULL DEFAULT '{}',
  products          jsonb NOT NULL DEFAULT '{}',
  is_active         boolean DEFAULT true,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE TABLE client_baselines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  avg_views       integer,
  median_views    integer,
  max_views       integer,
  p90_views       integer,   -- blueprint threshold (top 10% of client's reels)
  p10_views       integer,   -- peer threshold (bottom 10%)
  avg_likes       integer,
  reels_analyzed  integer,
  scraped_at      timestamptz DEFAULT now(),
  expires_at      timestamptz   -- scraped_at + 7 days
);

-- ═══════════════════════════════════════════════════════
-- PHASE 1: Background Jobs (shared across all phases)
-- ═══════════════════════════════════════════════════════

CREATE TABLE background_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id     uuid REFERENCES clients(id),
  job_type      text NOT NULL,
  -- job_type values (Phase 1):
  --   competitor_discovery  → discovers + scores accounts via Apify + Gemini
  --   baseline_scrape       → scrapes client's own reels to derive thresholds
  --   profile_scrape        → scrapes reels from BLUEPRINT/STRONG competitors
  -- job_type values (Phase 2+):
  --   ai_analysis           → Claude scores outlier reels (5-criteria)
  --   niche_patterns        → aggregates patterns across analyzed reels
  --   hook_generation       → generates hooks from patterns
  --   script_generation     → generates talking head scripts
  --   image_render          → gpt-image-1 background generation
  --   video_render          → ffmpeg / Remotion composition
  payload       jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'queued',  -- queued | running | completed | failed
  result        jsonb,
  error_message text,
  priority      integer DEFAULT 0,
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_background_jobs_status ON background_jobs(status, created_at);
CREATE INDEX idx_background_jobs_org    ON background_jobs(org_id, job_type);

-- ═══════════════════════════════════════════════════════
-- PHASE 1: Competitors
-- ═══════════════════════════════════════════════════════

CREATE TABLE competitors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  username          text NOT NULL,
  profile_url       text,
  followers         integer,
  avg_views         integer,
  avg_likes         integer,
  language          text,
  content_style     text,        -- educator | motivational | brand | mixed
  topics            text[],
  reasoning         text,        -- Gemini's explanation of why it's relevant
  relevance_score   integer,     -- 0-100 (Gemini)
  performance_score integer,     -- 0-100 (derived from client baseline thresholds)
  language_bonus    integer DEFAULT 0,
  composite_score   integer,     -- 50% relevance + 40% performance + 10% language
  tier              integer,     -- 1=BLUEPRINT 2=STRONG 3=PEER 4=SKIP
  tier_label        text,        -- "BLUEPRINT" | "STRONG" | "PEER" | "SKIP"
  discovery_job_id  uuid REFERENCES background_jobs(id),
  last_evaluated_at timestamptz DEFAULT now(),
  created_at        timestamptz DEFAULT now(),
  UNIQUE (client_id, username)
);

CREATE INDEX idx_competitors_client ON competitors(client_id, tier, composite_score DESC);

-- ═══════════════════════════════════════════════════════
-- PHASE 1: Scraped Reels + Outlier Detection
-- ═══════════════════════════════════════════════════════
-- NOTE: Scraped reels belong in Phase 1 because outlier detection
-- (identifying WHO is an outlier by views ratio) is a Phase 1B deliverable.
-- The WHY analysis (Claude 5-criteria scoring) is Phase 2.

CREATE TABLE scraped_reels (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  competitor_id       uuid REFERENCES competitors(id),
  scrape_job_id       uuid REFERENCES background_jobs(id),
  platform            text DEFAULT 'instagram',
  post_url            text,
  thumbnail_url       text,
  account_username    text NOT NULL,
  account_avg_views   integer,           -- competitor's avg views at time of scrape
  views               integer,
  likes               integer,
  comments            integer,
  saves               integer,
  shares              integer,
  outlier_ratio       numeric(8,2),      -- views / account_avg_views
  -- outlier_ratio >= 10.0 = outlier (10x above account average)
  -- outlier_ratio >= 50.0 = viral breakout (highest priority)
  is_outlier          boolean GENERATED ALWAYS AS (outlier_ratio >= 10.0) STORED,
  hook_text           text,              -- first line / visible text overlay
  caption             text,
  hashtags            text[],
  posted_at           timestamptz,
  format              text,              -- reel | image | carousel
  source              text,              -- profile | hashtag | url_paste
  niche               text,
  is_bookmarked       boolean DEFAULT false,
  created_at          timestamptz DEFAULT now(),
  UNIQUE (client_id, post_url)
);

-- Primary query: show outliers ranked by how much they exceeded the account avg
CREATE INDEX idx_scraped_reels_outlier   ON scraped_reels(client_id, is_outlier, outlier_ratio DESC);
CREATE INDEX idx_scraped_reels_client    ON scraped_reels(client_id, outlier_ratio DESC);

-- ═══════════════════════════════════════════════════════
-- PHASE 2: Why Analysis (Claude 5-criteria scoring)
-- ═══════════════════════════════════════════════════════
-- Separate table because:
--   1. Generated at a different time from scraping (async, after outlier detected)
--   2. Can be regenerated without re-scraping
--   3. Different access pattern (generation pipeline reads this, scraper doesn't)

CREATE TABLE reel_analyses (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_id                 uuid NOT NULL REFERENCES scraped_reels(id) ON DELETE CASCADE,
  analysis_job_id         uuid REFERENCES background_jobs(id),

  -- 5-criteria scoring (docs/CRITERIA.md — each 1-10, total 50)
  instant_hook_score      integer CHECK (instant_hook_score BETWEEN 1 AND 10),
  relatability_score      integer CHECK (relatability_score BETWEEN 1 AND 10),
  cognitive_tension_score integer CHECK (cognitive_tension_score BETWEEN 1 AND 10),
  clear_value_score       integer CHECK (clear_value_score BETWEEN 1 AND 10),
  comment_trigger_score   integer CHECK (comment_trigger_score BETWEEN 1 AND 10),
  total_score             integer GENERATED ALWAYS AS (
    COALESCE(instant_hook_score, 0) +
    COALESCE(relatability_score, 0) +
    COALESCE(cognitive_tension_score, 0) +
    COALESCE(clear_value_score, 0) +
    COALESCE(comment_trigger_score, 0)
  ) STORED,
  -- 40-50: Highly Replicable | 30-39: Strong Pattern | 20-29: Moderate | <20: Weak
  replicability_rating    text GENERATED ALWAYS AS (
    CASE
      WHEN (COALESCE(instant_hook_score,0)+COALESCE(relatability_score,0)+COALESCE(cognitive_tension_score,0)+COALESCE(clear_value_score,0)+COALESCE(comment_trigger_score,0)) >= 40 THEN 'highly_replicable'
      WHEN (COALESCE(instant_hook_score,0)+COALESCE(relatability_score,0)+COALESCE(cognitive_tension_score,0)+COALESCE(clear_value_score,0)+COALESCE(comment_trigger_score,0)) >= 30 THEN 'strong_pattern'
      WHEN (COALESCE(instant_hook_score,0)+COALESCE(relatability_score,0)+COALESCE(cognitive_tension_score,0)+COALESCE(clear_value_score,0)+COALESCE(comment_trigger_score,0)) >= 20 THEN 'moderate'
      ELSE 'weak'
    END
  ) STORED,

  -- Qualitative breakdown (Claude's reasoning per criterion)
  hook_type               text,    -- conflict | pov | curiosity | red_flag | situational
  emotional_trigger       text,    -- fear | validation | anger | recognition
  content_angle           text,    -- red_flags | what_to_say | hidden_psychology | corporate_reality | situational
  caption_structure       text,    -- story | list | framework | script
  why_it_worked           text,    -- 2-3 sentence summary of the winning formula
  replicable_elements     jsonb,   -- { hook: "...", value: "...", format: "..." }
  suggested_adaptations   jsonb,   -- ideas for adapting to client's niche/language

  model_used              text,    -- which Claude model ran this
  created_at              timestamptz DEFAULT now(),
  UNIQUE (reel_id)         -- one analysis per reel; upsert to regenerate
);

-- Aggregated niche patterns per client/niche (generated from reel_analyses)
CREATE TABLE niche_patterns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  niche           text NOT NULL,
  patterns        jsonb NOT NULL,   -- aggregated hook types, triggers, angles
  reels_analyzed  integer,
  generated_at    timestamptz DEFAULT now(),
  UNIQUE (client_id, niche)   -- upsert on each run
);

-- ═══════════════════════════════════════════════════════
-- PHASE 3: Content Generation
-- ═══════════════════════════════════════════════════════

-- A generation run = one batch request (10 hooks, 1 script, etc.)
CREATE TABLE generation_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  job_id            uuid REFERENCES background_jobs(id),
  type              text NOT NULL,   -- hooks | script | caption | story
  niche             text,
  tone              text,
  reference_reel_id uuid REFERENCES scraped_reels(id),
  count_requested   integer DEFAULT 10,
  count_generated   integer,
  created_at        timestamptz DEFAULT now()
);

CREATE TABLE hooks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  run_id       uuid REFERENCES generation_runs(id) ON DELETE CASCADE,
  hook_text    text NOT NULL,
  tier         text,    -- tier1_conflict | tier2_relatable | tier3_curiosity
  is_favorited boolean DEFAULT false,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE scripts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  run_id         uuid REFERENCES generation_runs(id) ON DELETE CASCADE,
  hook_id        uuid REFERENCES hooks(id),
  format         text NOT NULL,   -- talking_head | static_slide
  script_text    text NOT NULL,
  word_count     integer,
  estimated_secs integer,
  created_at     timestamptz DEFAULT now()
);

CREATE TABLE captions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  run_id       uuid REFERENCES generation_runs(id) ON DELETE CASCADE,
  hook_id      uuid REFERENCES hooks(id),
  caption_text text NOT NULL,
  hashtags     text[],
  cta_keyword  text,
  created_at   timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════
-- PHASE 4/5: Production Pipeline
-- ═══════════════════════════════════════════════════════

-- The assembled piece: hook + caption + script + media
-- This is what goes through the approval queue
CREATE TABLE content_pieces (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  hook_id           uuid REFERENCES hooks(id),
  script_id         uuid REFERENCES scripts(id),
  caption_id        uuid REFERENCES captions(id),
  reference_reel_id uuid REFERENCES scraped_reels(id),
  format            text,    -- static_slide | talking_head | b_roll
  video_format      text,    -- one of the 5 preset layout names
  status            text DEFAULT 'draft',
  -- status values: draft | pending_review | approved | rejected | scheduled | published
  revision_notes    text,
  image_url         text,
  video_url         text,
  thumbnail_url     text,
  scheduled_at      timestamptz,
  approved_at       timestamptz,
  approved_by       uuid REFERENCES profiles(id),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- Written once when a piece is posted to Instagram
CREATE TABLE publications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_piece_id uuid NOT NULL REFERENCES content_pieces(id),
  client_id        uuid NOT NULL REFERENCES clients(id),
  platform         text DEFAULT 'instagram',
  postiz_job_id    text,
  published_at     timestamptz DEFAULT now()
);

-- Performance data per published post (fed manually or via API)
CREATE TABLE post_performance (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  client_id      uuid NOT NULL REFERENCES clients(id),
  views          integer,
  likes          integer,
  comments       integer,
  saves          integer,
  shares         integer,
  recorded_at    timestamptz DEFAULT now()
);
```

---

## Row Level Security — all tenant-scoped tables

Pattern for tables with `org_id` directly:

```sql
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON clients
  USING (
    org_id IN (
      SELECT org_id FROM organization_members
      WHERE user_id = auth.uid()
    )
  );
```

Pattern for tables scoped through `client_id`:

```sql
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON competitors
  USING (
    client_id IN (
      SELECT id FROM clients
      WHERE org_id IN (
        SELECT org_id FROM organization_members
        WHERE user_id = auth.uid()
      )
    )
  );
```

Apply this pattern to: `clients`, `client_baselines`, `background_jobs`, `competitors`, `scraped_reels`, `reel_analyses`, `niche_patterns`, `generation_runs`, `hooks`, `scripts`, `captions`, `content_pieces`, `publications`, `post_performance`.

---

## Migration from JSON files (one-time)

| JSON file | → | Supabase table |
|---|---|---|
| `config/clients/conny-gfrerer.json` | → | `clients` row |
| `data/niches/conny-gfrerer/baseline.json` | → | `client_baselines` row |
| `data/niches/conny-gfrerer/current-competitors.json` | → | `competitors` rows |
| `data/niches/conny-gfrerer/evaluations/*.json` | → | archive or discard |

Write a one-time Python script: read JSONs → insert into Supabase via `supabase-py` client.

---

## FastAPI project structure

```
backend/
├── main.py                       # FastAPI app + router registration
├── worker.py                     # Background job processor (runs separately)
├── core/
│   ├── config.py                 # Settings via pydantic-settings (env vars)
│   ├── database.py               # Supabase client init
│   └── auth.py                   # JWT validation from Supabase Auth
├── routers/
│   ├── clients.py                # GET/POST/PUT /api/v1/clients/...
│   ├── intelligence.py           # competitors + discover + reels + scrape
│   ├── generate.py               # hooks + scripts + captions
│   ├── queue.py                  # content-pieces approval queue
│   └── jobs.py                   # GET /api/v1/jobs/{job_id}
├── services/
│   ├── apify.py                  # Apify API wrapper — account search + reel scraping
│   ├── gemini.py                 # OpenRouter + Gemini — competitor relevance scoring
│   ├── claude.py                 # Anthropic SDK — 5-criteria analysis + generation
│   └── openai_images.py          # gpt-image-1 — background image generation
├── jobs/
│   ├── competitor_discovery.py   # job_type: competitor_discovery (port of competitor-discovery.js)
│   ├── baseline_scrape.py        # job_type: baseline_scrape (port of competitor-eval.js baseline step)
│   ├── profile_scrape.py         # job_type: profile_scrape (scrape reels from BLUEPRINT/STRONG accounts)
│   ├── ai_analysis.py            # job_type: ai_analysis (Claude 5-criteria scoring per outlier)
│   └── hook_generation.py        # job_type: hook_generation
└── models/
    ├── client.py
    ├── competitor.py
    ├── reel.py
    ├── job.py
    └── content.py
```

---

## SOLID principles applied

| Principle | Application |
|---|---|
| **S — Single Responsibility** | `background_jobs` tracks operational state only. Output lives in domain tables. `scraped_reels` stores what Apify returned. `reel_analyses` stores what Claude added. Never mixed. |
| **O — Open/Closed** | JSONB for `niche_config`, `icp`, `products` — add new fields without schema migrations. Typed columns only for what you query/filter/join on. |
| **I — Interface Segregation** | `hooks`, `scripts`, `captions` are separate tables. Don't make a fat `content` table with 40 nullable columns. |
| **D — Dependency Inversion** | `background_jobs` is the single interface for all async work. The worker doesn't care what type of job it is until processing begins. |

---

## Build order

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SPRINT 1 — Phase 1 complete (target: today)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Infrastructure
  ☐ Create Supabase project
  ☐ Run Phase 1 SQL schema (Identity + Clients + Background Jobs + Competitors + Scraped Reels)
  ☐ Apply RLS policies to all Phase 1 tables
  ☐ FastAPI skeleton: main.py + core/ (config, database, auth)

  Data
  ☐ Migration script: JSON → Supabase (clients, baseline, current-competitors)
  ☐ Verify Conny's competitors + baseline are live in DB

  API
  ☐ GET  /clients + GET /clients/{slug}
  ☐ GET  /clients/{slug}/competitors
  ☐ POST /clients/{slug}/competitors/discover (queues competitor_discovery job)
  ☐ POST /clients/{slug}/reels/scrape (queues profile_scrape job)
  ☐ GET  /clients/{slug}/reels?outlier_only=true
  ☐ GET  /clients/{slug}/baseline
  ☐ GET  /jobs/{job_id}

  Workers (port Node.js scripts to Python)
  ☐ competitor_discovery job (port of competitor-discovery.js)
  ☐ baseline_scrape job (port of baseline logic in competitor-eval.js)
  ☐ profile_scrape job (scrapes last 30 reels per BLUEPRINT/STRONG competitor,
                        computes outlier_ratio, sets is_outlier)

  Dashboard wire-up
  ☐ Intelligence page reads from /clients/{slug}/competitors (real DB data)
  ☐ Intelligence page reads from /clients/{slug}/reels (real scraped reels)
  ☐ Outlier badge shown for is_outlier = true posts
  ☐ Outlier ratio displayed per post (e.g. "23x")
  ☐ "Discover" button triggers job + polls until complete
  ☐ "Scrape Reels" button triggers job + polls until complete

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SPRINT 2 — Phase 2: WHY analysis
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ☐ Run Phase 2 SQL (reel_analyses, niche_patterns)
  ☐ ai_analysis job: Claude scores each outlier reel using 5-criteria rubric
  ☐ GET /clients/{slug}/reels/{reel_id}/analysis
  ☐ POST /clients/{slug}/reels/analyze (queues ai_analysis for all unanalyzed outliers)
  ☐ niche_patterns job: aggregate patterns across analyzed reels
  ☐ Intelligence feed page shows analysis cards (score, hook type, why it worked)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SPRINT 3 — Phase 3: Generation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ☐ Run Phase 3 SQL (generation_runs, hooks, scripts, captions)
  ☐ hook_generation + script_generation jobs
  ☐ Generate page wired to real API

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SPRINT 4+ — Phase 4/5: Production
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ☐ Phase 4/5 SQL (content_pieces, publications, post_performance)
  ☐ Video render jobs (ffmpeg / Remotion)
  ☐ Approval queue + Postiz integration
```
