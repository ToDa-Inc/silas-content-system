# Content Machine (dashboard)

Next.js **App Router** app inside this monorepo: UI migrated from the HTML prototype at  
**`../dashboard_code.md`** (repo root — Tailwind CDN + Material Symbols in the export).

## Why Next.js (not raw HTML or Vite-only SPA)

- **App Router**: one layout (sidebar + top bar), real URLs per section (`/dashboard`, `/generate`, …).
- **Components**: shell reused across pages; no duplicated `<head>` / CDN Tailwind.
- **Production**: `next build`, image optimization, easy deploy (Vercel or any Node host).
- **Path to backend**: later you add Route Handlers or a separate API; the UI stays the same.

## Run locally

**Backend + frontend:** from **repo root** run **`npm run dev:all`** (FastAPI **8787** + Next **3000**).  
If you only run **`npm run dev`** here, the UI works but **API routes from the dashboard will fail** until `npm run dev:api` is running from the root.

From **repo root**:

```bash
npm run dashboard
```

Or from this folder (same as above — dashboard only):

```bash
cd content-machine
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → redirects to `/dashboard`.

## Backend (FastAPI)

The dashboard calls **`silas-content-system/backend`** on **`http://127.0.0.1:8787`** by default (`NEXT_PUBLIC_CONTENT_API_URL` or `NEXT_PUBLIC_API_URL`).

### Environment (shared with the API)

From the **repo root** (`silas-content-system/`):

```bash
cp .env.example .env
```

Edit **`.env`** — one file for FastAPI, worker, and Next.js. `next.config.ts` loads the repo-root **`.env`**; you can still add **`content-machine/.env.local`** for overrides (e.g. machine-specific URLs).

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Project URL — shared by API, worker, and dashboard |
| `SUPABASE_ANON_KEY` | **Anon** key (public by design; RLS protects data). `next.config` exposes it to the browser — you do **not** need duplicate `NEXT_PUBLIC_SUPABASE_*` in `.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | API + worker only — never in the browser |
| `NEXT_PUBLIC_CONTENT_API_URL` | FastAPI base URL, e.g. `http://127.0.0.1:8787` |

**Auth:** `/login` and `/signup` use **Supabase Auth**. After login, org + client slugs come from **`organization_members`** + the active-client cookie (`resolveTenancy`) — nothing to configure in `.env`. FastAPI calls send **`X-Api-Key`** (`profiles.api_key`) and **`X-Org-Slug`**. If `profiles.api_key` is missing, apply the `profiles` section from **`backend/sql/phase1_all_in_one.sql`**. Without membership, the API returns **403**.

**Site URL / redirect:** In Supabase → Authentication → URL configuration, set **Site URL** to `http://localhost:3000` and add the same to **Redirect URLs** so email links and `/auth/callback` work.

From the **repo root**, run API + UI together: **`npm install`** once, then **`npm run dev:all`**. Still run **`python worker.py`** from `backend/` when using queued jobs.

## Stack

- Next.js 16, React 19, TypeScript
- Tailwind CSS **4.2.x** (keep `tailwindcss` and `@tailwindcss/postcss` on the same minor — 4.0 + mixed deps caused a PostCSS `ScannerOptions.sources` build error here)
- **Lucide** icons (replacing Material Symbols from the prototype)
- Plus Jakarta Sans via `next/font/google`
- Design tokens + glass utilities in `src/app/globals.css` (`@theme { … }`)

## Routes

| Path | Status |
|------|--------|
| `/dashboard` | Full UI from first HTML block (overview, activity, context column) |
| `/generate` | Hooks page (interactive tone + hook list) |
| `/intelligence` | Competitors + discovery + baseline/reel actions + scraped reels list |
| `/login` | Supabase Auth |
| `/scheduling`, `/context`, `/settings` | Placeholder cards — next implementation slice |

## Source of truth

- Visual/copy reference: `../dashboard_code.md` (sibling folder at repo root)
- Product / interaction spec: `.cursor/plans/silas_dashboard_design_bab5ee02.plan.md` (if present on your machine)

When the prototype HTML gains new sections, **port them into React components** under `src/app/(dashboard)/` and `src/components/dashboard/` — do not ship the CDN HTML as the app shell.
