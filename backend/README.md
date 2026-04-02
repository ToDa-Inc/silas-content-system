# Content Machine API (Phase 1)

FastAPI service + background worker for clients, competitors, baselines, and jobs.

## Prerequisites

- Python 3.9+
- **Supabase**
  - **New empty project:** apply your Phase 1 schema (see **`docs/BACKEND-ARCHITECTURE.md`** — `profiles` must include a **`api_key` text** column, unique if you enforce it). RLS/policies as you define there.
  - **Already have Phase 1 tables:** add migrations from **`backend/sql/`** as needed (`phase2`…`phase4` in this repo; scrape pipeline SQL may live in docs or another branch).
  - **Manual competitors:** run **[sql/phase1c_competitors_added_by.sql](sql/phase1c_competitors_added_by.sql)** once to add `competitors.added_by` (who pasted the handle in the UI).
  - **Saved reel analyses (Analyze by URL history):** run **[sql/phase2_reel_analyses.sql](sql/phase2_reel_analyses.sql)** once. This creates `reel_analyses` (stable key `(client_id, post_url)`) and links optional `reel_id` → `scraped_reels`. If you used the old `client_reel_analyses` migration, drop that table first, then run this file. List via `GET /api/v1/clients/{slug}/reel-analyses`.
  - **Reel metric history (growth / snapshots):** run **[sql/phase3_reel_snapshots.sql](sql/phase3_reel_snapshots.sql)** once. Creates `reel_snapshots` (append-only views/likes/comments per sync). Required for `GET …/activity` own-reel growth and historical deltas.
  - **Client brain (Context page, PDF/DOCX uploads):** run **[sql/phase4_client_context.sql](sql/phase4_client_context.sql)** once. Adds `clients.client_context` and the private **`client-context`** storage bucket.
  - **Client DNA (compressed briefs for reel analysis / generation):** run **[sql/phase5_client_dna.sql](sql/phase5_client_dna.sql)** once. Adds `clients.client_dna`. See **`docs/client_dna.md`**.

**Signup without email confirmation (local dev):** Authentication → Email → disable **Confirm email**. **Site URL** `http://localhost:3000`.

**Onboarding 500 on profile:** ensure `public.profiles` has an **`api_key`** column; the Next.js route **`POST /api/onboarding/complete`** creates the row and sets the key in app code (same idea as Bookedin `generate_api_key()` on business create).

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

If you have no env file yet: from **repo root** run **`cp .env.example .env`**, then edit **`silas-content-system/.env`**.  
Optional: `backend/.env` or `config/.env` for overrides (see load order in root `.env.example`).

### Step-by-step: fill env (repo root `.env`)

1. **Open** `silas-content-system/.env` (create it from `.env.example` at the same folder).

2. **`SUPABASE_URL`**  
   - Supabase Dashboard → your project → **Project Settings** (gear) → **API**.  
   - Copy **Project URL** (looks like `https://abcdefgh.supabase.co`).  
   - Paste as `SUPABASE_URL=...` (no quotes).

3. **`SUPABASE_ANON_KEY`** (dashboard auth — same **anon** / `public` key from the API page)  
   - **Never** use the service role key in the browser; the anon key is expected to ship to the client (RLS enforces access).

4. **`SUPABASE_SERVICE_ROLE_KEY`**  
   - Same **API** page → **Project API keys** → **service_role** (`secret`).  
   - Click reveal, copy, paste.  
   - **Never** commit this key or use it in the browser; only server/worker.

5. **`APIFY_API_TOKEN`** (needed for **worker**: discovery + baseline + profile reel scrape)  
   - [Apify Console](https://console.apify.com/) → **Settings** → **Integrations** → API token.  
   - Same value as `APIFY_API_TOKEN` in `config/.env` if you already use the Node scripts.  
   - **403 Forbidden** from `api.apify.com/v2/acts/.../runs`: token invalid/revoked, no Apify credits, or wrong actor. Create a new token, confirm billing, then restart the API. The backend uses actor **`apify~instagram-reel-scraper`** by default (override with **`APIFY_REEL_ACTOR`** in `.env` if needed).
   - **Saves / shares show 0:** Instagram often does not expose save counts in scraped public data. **Shares** need Apify’s **`includeSharesCount`** (enabled by default via **`APIFY_INCLUDE_SHARES_COUNT=true`**) and typically a **paid Apify plan** — see [Instagram Reel Scraper pricing](https://apify.com/apify/instagram-reel-scraper/pricing). Re-sync after changing plan.
   - **Duration missing for some reels:** The actor only fills **`videoDuration`** when Instagram returns it for that item; we also read a few alternate fields. Gaps are normal for some post types.

6. **`OPENROUTER_API_KEY`** (needed for **worker**: Gemini relevance scoring)  
   - [openrouter.ai/keys](https://openrouter.ai/keys) → create key.  
   - Same idea as `OPENROUTER_API_KEY` in `config/.env` for the JS scripts.

7. **`OPENROUTER_MODEL`** — optional; default is fine unless you want another model.

8. **`CORS_ORIGINS`** — include `http://localhost:3000` and `http://127.0.0.1:3000` for local Next.js; add production origins as needed.

9. **`CRON_SECRET`** — set a long random string to enable cron routes (`POST /api/v1/cron/scrape-cycle`, `POST /api/v1/cron/sync-all`, `POST /api/v1/cron/recompute-breakouts`) with header `X-Cron-Secret`. If unset, those routes return 503 (safe default). Use the **same** value in Vercel as `CRON_SECRET` for `/api/cron/daily-sync`.

10. **Save** the file. Load order is **repo `.env` → `backend/.env` → `config/.env`** (each overrides the previous). Put shared keys in repo `.env`; keep `config/.env` only if Node scripts still read it.

## One-time data migration

```bash
python migrate.py
```

Seeds org + client from `config/clients/conny-gfrerer.json` and optional `data/niches/conny-gfrerer/*.json`.  
If the org row is created fresh, its display **`name`** defaults to **Agency**; override with **`MIGRATE_DEFAULT_ORG_NAME`** in the environment.

## Run API

**Default port `8787`** (matches the Next.js app’s `NEXT_PUBLIC_CONTENT_API_URL` / `NEXT_PUBLIC_API_URL`).

From repo root:

```bash
npm run dev:api
```

Or from `backend/`:

```bash
python3 -m uvicorn main:app --reload --host 127.0.0.1 --port 8787
```

**One Railway container (API + worker):** from `backend/` set the service **Start Command** to `bash start.sh` and ensure **`PORT`** is unset or left to Railway (the script uses `$PORT`). Set **`CORS_ORIGINS`** to include your Vercel URL (see repo `.env.example`).

## Run worker (separate terminal)

From **`backend/`**:

```bash
python3 worker.py
```

From **repo root** (same command, scripted):

```bash
npm run dev:worker
```

For **API + Next + worker** together: `npm run dev:full` at repo root (`dev:all` does not include the worker).

## Auth / tenancy

- **Browser / dashboard → FastAPI:** header **`X-Api-Key: <profiles.api_key>`** (or **`Authorization: Bearer <api_key>`**) plus **`X-Org-Slug`**. The API looks up `profiles` by `api_key`, then checks **`organization_members`**. **`profiles.api_key`** is generated when the user completes **workspace onboarding** (`content-machine` → **`POST /api/onboarding/complete`**), same pattern as Bookedin **`generate_api_key()`** on business creation — not DB triggers.
- **Worker + cron:** Service role only. Cron uses **`X-Cron-Secret`**.

The service role bypasses RLS for server-side writes; still use network controls in production.

**Dashboard shows no workspace / no creators after onboarding:** run **`sql/apply.sql`** once in the SQL Editor.

**Add a user to an org** (after they sign up in Supabase Auth — copy `user id` from Authentication → Users):

```sql
INSERT INTO organization_members (id, org_id, user_id, role)
VALUES (
  'mbr_' || encode(gen_random_bytes(8), 'hex'),
  (SELECT id FROM organizations WHERE slug = 'YOUR_ORG_SLUG'),
  'PASTE_AUTH_USER_UUID_HERE'::uuid,
  'member'
);
```

## Endpoints

- `GET/POST /api/v1/clients`
- `GET/PUT /api/v1/clients/{slug}`
- `GET /api/v1/clients/{slug}/competitors`
- `POST /api/v1/clients/{slug}/competitors/discover`
- `GET /api/v1/clients/{slug}/baseline`
- `POST /api/v1/clients/{slug}/baseline/refresh`
- `GET /api/v1/clients/{slug}/reels` (optional `?outlier_only=true`)
- `POST /api/v1/clients/{slug}/reels/scrape`
- `POST /api/v1/cron/scrape-cycle` (header `X-Cron-Secret`) — stale competitor scrapes only
- `POST /api/v1/cron/sync-all` (header `X-Cron-Secret`) — enqueue own baseline + all competitors per active client (needs **`worker.py`** to run Apify jobs)
- `POST /api/v1/cron/recompute-breakouts` (header `X-Cron-Secret`) — refresh breakout flags from existing `scraped_reels` only (no Apify)
- `POST /api/v1/clients/{slug}/recompute-breakouts` (dashboard auth) — same recompute for one client
- **Vercel:** `content-machine/vercel.json` schedules **`GET /api/cron/daily-sync`** daily (default **05:00 UTC**); set **`CONTENT_API_URL`**, **`CRON_SECRET`**, and enable Vercel’s cron auth so the route can call the backend. Adjust the schedule in `vercel.json` if you need another hour.
- `GET /api/v1/jobs/{job_id}`
- `GET /health`
