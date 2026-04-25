# Deploy the FastAPI API on Railway

The **repo root** `Dockerfile` builds the **Next.js** dashboard only. GitHub Actions cron URLs must hit **this Python API**, which exposes `POST /api/v1/cron/sync-all`, `…/keyword-reel-similarity`, `…/niche-discovery`, etc.

## API image layout (single source of truth)

- **Dockerfile:** `backend.Dockerfile` at the **monorepo root** (not inside `backend/`).
- **Build context:** repo root so the image can `COPY video-production/broll-caption-editor` into `/opt/broll-caption-editor` and `COPY backend/` into `/app`.
- **Remotion:** `npm ci` runs in `/opt/broll-caption-editor`. Renders use **Debian `chromium`** (`REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium`) so slim images do not download headless-shell or chase missing `.so` files.
- **Config-as-code:** root `railway.toml` sets `dockerfilePath = "backend.Dockerfile"` for the service that uses it. Adjust in the Railway UI if your API service uses a different config file.

## Second Railway service (recommended)

1. Railway → **New service** (or select existing API) → same GitHub repo as the dashboard.
2. **Settings → Root Directory** → leave **empty** (repository root).  
   **Do not** set Root Directory to `backend` — the API image needs `video-production/` on the build context.
3. **Settings → Build → Dockerfile path** → `backend.Dockerfile`.
4. **Variables:** same as a working local API (or `backend/.env` / repo `.env`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `APIFY_API_TOKEN`, `OPENROUTER_API_KEY`, `CORS_ORIGINS`, etc. Optional override: `REMOTION_EDITOR_DIR` (defaults to `/opt/broll-caption-editor` in the image).
5. Deploy, then open `https://<this-service-url>/openapi.json` and confirm `/api/v1/cron/…` routes exist.
6. Point **GitHub Actions** secrets at this host (`SYNC_ALL_URL`, `NICHE_DISCOVERY_CRON_URL`, etc.).
7. On the **dashboard** service, set `CONTENT_API_URL` / `NEXT_PUBLIC_CONTENT_API_URL` to this API’s public URL.

### Migrating from the old layout

If your API service used **Root Directory = `backend`** and **`backend/Dockerfile`**, update it to **Root Directory = empty** and **`backend.Dockerfile`**, then redeploy. The previous layout existed only to vendor a copy of the Remotion project; that copy is removed from the repo.

## Worker

Queued jobs need **`python worker.py`** (or a separate Railway service with the **same image** and **Start Command** `python worker.py`). The cron endpoints only enqueue rows in `background_jobs`.

## Remotion source trees (for contributors)

| Location | Role |
|----------|------|
| `video-production/broll-caption-editor/` | **CLI + production render** — only copy baked into the API image. |
| `content-machine/src/remotion-spec/` | **Next.js in-app preview** — must stay in sync with the folder above (see `schema.ts` header comments). |

Long-term cleanup: one shared npm workspace package for `remotion-spec` consumed by both apps.
