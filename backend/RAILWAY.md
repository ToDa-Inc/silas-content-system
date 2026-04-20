# Deploy the FastAPI API on Railway

The **repo root** `Dockerfile` builds the **Next.js** dashboard only. GitHub Actions cron URLs must hit **this Python API**, which exposes `POST /api/v1/cron/sync-all`, `…/keyword-reel-similarity`, `…/niche-discovery`, etc.

## Second Railway service (recommended)

1. Railway → **New service** → **GitHub repo** → same repo as the dashboard.
2. **Settings → Root Directory** → `backend`.
3. **Settings → Build** → Dockerfile path `Dockerfile` (default when Root Directory is `backend`).
4. **Variables**: copy from your working API (or local `.env`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `APIFY_API_TOKEN`, `OPENROUTER_API_KEY`, `CORS_ORIGINS`, etc. Match whatever you use for `SYNC_ALL_URL` today if that URL already works.
5. Deploy, then open `https://<this-service-url>/openapi.json` and confirm you see `keyword-reel-similarity` or `niche-discovery` under `/api/v1/cron`.
6. Point **GitHub Actions** secrets at this host:
   - `SYNC_ALL_URL` = `https://<api-service>/api/v1/cron/sync-all`
   - `NICHE_DISCOVERY_CRON_URL` = `https://<api-service>/api/v1/cron/keyword-reel-similarity` (or `…/niche-discovery`)
   - Optional: `SCRAPED_REELS_REFRESH_URL` = `https://<api-service>/api/v1/cron/scraped-reels-refresh` (or omit and derive from `SYNC_ALL_URL`; workflow `cron-scraped-reels-refresh.yml` runs this daily)
7. On the **dashboard** service, set `CONTENT_API_URL` / `NEXT_PUBLIC_CONTENT_API_URL` to this API’s public URL.

## Worker

Queued jobs need **`python worker.py`** (or a separate Railway service with the same image and `Start Command` overridden to `python worker.py`). The cron endpoints only enqueue rows in `background_jobs`.
