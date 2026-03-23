# Silas Prism — Content Machine (dashboard)

Next.js **App Router** app inside this monorepo: UI migrated from the HTML prototype at  
**`../dashboard_code.md`** (repo root — Tailwind CDN + Material Symbols in the export).

## Why Next.js (not raw HTML or Vite-only SPA)

- **App Router**: one layout (sidebar + top bar), real URLs per section (`/dashboard`, `/generate`, …).
- **Components**: shell reused across pages; no duplicated `<head>` / CDN Tailwind.
- **Production**: `next build`, image optimization, easy deploy (Vercel or any Node host).
- **Path to backend**: later you add Route Handlers or a separate API; the UI stays the same.

## Run locally

From **this repo root** (`silas-content-system/`):

```bash
npm run dashboard
```

Or from this folder:

```bash
cd content-machine
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → redirects to `/dashboard`.

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
| `/intelligence` | Viral feed + patterns grid |
| `/scheduling`, `/context`, `/settings` | Placeholder cards — next implementation slice |

## Source of truth

- Visual/copy reference: `../dashboard_code.md` (sibling folder at repo root)
- Product / interaction spec: `.cursor/plans/silas_dashboard_design_bab5ee02.plan.md` (if present on your machine)

When the prototype HTML gains new sections, **port them into React components** under `src/app/(dashboard)/` and `src/components/dashboard/` — do not ship the CDN HTML as the app shell.
