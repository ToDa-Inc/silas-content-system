# Silas Content API (Phase 1)

FastAPI service + background worker for clients, competitors, baselines, and jobs.

## Prerequisites

- Python 3.9+
- Supabase: run **[sql/phase1_all_in_one.sql](sql/phase1_all_in_one.sql)** once in the SQL editor (empty project: copy-paste whole file).  
  Split files [01_phase1_schema.sql](sql/01_phase1_schema.sql) + [02_phase1_rls.sql](sql/02_phase1_rls.sql) are equivalent if you prefer two steps.

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

If `.env` is missing: `cp .env.example .env`

### Step-by-step: fill `backend/.env`

1. **Open** `backend/.env` in your editor (repo root: `silas-content-system/backend/.env`).

2. **`SUPABASE_URL`**  
   - Supabase Dashboard → your project → **Project Settings** (gear) → **API**.  
   - Copy **Project URL** (looks like `https://abcdefgh.supabase.co`).  
   - Paste as `SUPABASE_URL=...` (no quotes).

3. **`SUPABASE_SERVICE_ROLE_KEY`**  
   - Same **API** page → **Project API keys** → **service_role** (`secret`).  
   - Click reveal, copy, paste.  
   - **Never** commit this key or use it in the browser; only server/worker.

4. **`DEFAULT_ORG_SLUG`**  
   - Leave `silas-agency` unless you change the slug in `migrate.py` / your org row.  
   - Must match the organization `migrate.py` creates or uses.

5. **`APIFY_API_TOKEN`** (needed for **worker**: discovery + baseline scrape)  
   - [Apify Console](https://console.apify.com/) → **Settings** → **Integrations** → API token.  
   - Same value as `APIFY_API_TOKEN` in `config/.env` if you already use the Node scripts.

6. **`OPENROUTER_API_KEY`** (needed for **worker**: Gemini relevance scoring)  
   - [openrouter.ai/keys](https://openrouter.ai/keys) → create key.  
   - Same idea as `OPENROUTER_API_KEY` in `config/.env` for the JS scripts.

7. **`OPENROUTER_MODEL`** — optional; default is fine unless you want another model.

8. **`CORS_ORIGINS`** — keep `http://localhost:3000` for local Next.js; add comma-separated origins if needed (e.g. `http://localhost:3000,https://app.example.com`).

9. **Save** the file. The API also loads `../config/.env` if present (for shared Apify/OpenRouter keys), but `backend/.env` is the main place for Supabase + backend-specific vars.

## One-time data migration

```bash
python migrate.py
```

Seeds org + client from `config/clients/conny-gfrerer.json` and optional `data/niches/conny-gfrerer/*.json`.

## Run API

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Run worker (separate terminal)

```bash
python worker.py
```

## Auth / tenancy (Phase 1)

Pass header `X-Org-Slug: silas-agency` (or your org slug). If omitted, `DEFAULT_ORG_SLUG` from env is used.

The API uses the **service role** key and bypasses RLS; lock down network access in production.

## Endpoints

- `GET/POST /api/v1/clients`
- `GET/PUT /api/v1/clients/{slug}`
- `GET /api/v1/clients/{slug}/competitors`
- `POST /api/v1/clients/{slug}/competitors/discover`
- `GET /api/v1/clients/{slug}/baseline`
- `POST /api/v1/clients/{slug}/baseline/refresh`
- `GET /api/v1/jobs/{job_id}`
- `GET /health`
