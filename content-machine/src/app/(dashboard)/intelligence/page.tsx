import Link from "next/link";
import { ChevronRight, Heart, MessageCircle, Sparkles } from "lucide-react";
import {
  fetchBaseline,
  fetchCompetitors,
  getApiBase,
  getDefaultClientSlug,
  getDefaultOrgSlug,
  type CompetitorRow,
} from "@/lib/intelligence-api";
import { DiscoverPanel } from "./components/discover-button";

function tierBadge(tier: number | null) {
  if (tier === 1) return "BLUEPRINT";
  if (tier === 2) return "STRONG";
  if (tier === 3) return "PEER";
  if (tier === 4) return "SKIP";
  return "—";
}

function CompetitorRowView({ row }: { row: CompetitorRow }) {
  const initial = (row.username || "?").slice(0, 1).toUpperCase();
  const title = `@${row.username}`;
  const pattern =
    row.tier_label ||
    row.content_style ||
    (row.topics?.length ? `Topics: ${row.topics.slice(0, 3).join(", ")}` : "—");
  const outlier =
    row.composite_score != null ? `${row.composite_score}` : row.relevance_score ?? "—";

  return (
    <div className="group grid cursor-default grid-cols-1 items-center gap-4 rounded-xl bg-surface-container-low p-4 transition-colors hover:border hover:border-outline-variant/10 hover:bg-surface-container-high md:grid-cols-12">
      <div className="flex items-center gap-4 md:col-span-5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-sm font-bold text-amber-400">
          {initial}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-tighter text-zinc-500">
            {tierBadge(row.tier)}
          </p>
          <h4 className="truncate text-sm font-semibold text-on-surface">{title}</h4>
        </div>
      </div>
      <div className="text-center md:col-span-2">
        <p className="mb-1 text-[10px] text-zinc-500">Score</p>
        <span className="text-lg font-bold text-amber-400">{outlier}</span>
      </div>
      <div className="md:col-span-3">
        <p className="mb-1 text-[10px] uppercase tracking-widest text-zinc-500">Signal</p>
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          <span className="line-clamp-2 text-[11px] font-medium text-on-surface">{pattern}</span>
        </div>
      </div>
      <div className="flex justify-end md:col-span-2">
        {row.profile_url ? (
          <a
            href={row.profile_url}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-semibold text-primary hover:underline"
          >
            Profile
          </a>
        ) : (
          <span className="text-zinc-600">—</span>
        )}
      </div>
      {row.reasoning ? (
        <p className="col-span-1 text-[11px] leading-relaxed text-zinc-500 md:col-span-12">
          {row.reasoning}
        </p>
      ) : null}
    </div>
  );
}

export default async function IntelligencePage() {
  const [compRes, baseRes] = await Promise.all([fetchCompetitors(), fetchBaseline()]);
  const competitors = compRes.data;
  const baseline = baseRes.data;
  const apiBase = getApiBase();
  const orgSlug = getDefaultOrgSlug();
  const clientSlug = getDefaultClientSlug();

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8 md:px-8">
      <header className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <nav className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            <span>Intelligence</span>
            <ChevronRight className="h-3 w-3" aria-hidden />
            <span className="text-primary">Competitors</span>
          </nav>
          <h2 className="text-4xl font-extrabold leading-none tracking-tighter text-on-surface md:text-5xl lg:text-6xl">
            Live competitor feed.
          </h2>
        </div>
        <div className="flex flex-wrap gap-4">
          {baseline ? (
            <div className="flex items-center gap-3 rounded-lg bg-surface-container-high px-4 py-2">
              <span className="text-xs font-medium text-zinc-500">Median views (baseline)</span>
              <span className="font-bold text-primary">
                {baseline.median_views?.toLocaleString() ?? "—"}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg bg-surface-container-high px-4 py-2">
              <span className="text-xs font-medium text-zinc-500">Baseline</span>
              <span className="font-bold text-zinc-400">Not loaded</span>
            </div>
          )}
        </div>
      </header>

      {!compRes.ok ? (
        <div className="mb-8 rounded-xl border border-amber-900/40 bg-amber-950/20 p-4 text-sm text-amber-200/90">
          <p className="font-semibold">Backend unreachable or misconfigured</p>
          <p className="mt-1 text-zinc-400">{compRes.error}</p>
          <p className="mt-2 text-xs text-zinc-500">
            Start the API: <code className="rounded bg-zinc-900 px-1">cd backend && uvicorn main:app --port 8000</code>
            . Set{" "}
            <code className="rounded bg-zinc-900 px-1">NEXT_PUBLIC_API_URL</code> and run{" "}
            <code className="rounded bg-zinc-900 px-1">python migrate.py</code> after Supabase setup.
          </p>
        </div>
      ) : null}

      <section className="mb-10">
        <DiscoverPanel apiBase={apiBase} orgSlug={orgSlug} clientSlug={clientSlug} />
      </section>

      <section className="mb-12 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="relative col-span-1 overflow-hidden rounded-xl bg-surface-container lg:col-span-4">
          <div className="relative flex aspect-[9/16] max-h-[520px] flex-col justify-end bg-zinc-900 p-6">
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
            <div className="relative space-y-3">
              <p className="text-xs font-bold uppercase tracking-widest text-amber-400/90">
                Data source
              </p>
              <p className="text-sm text-white/90">
                Ranked competitors from Supabase (composite score when baseline exists, otherwise
                relevance from discovery).
              </p>
              <div className="flex gap-3 text-[10px] text-white/60">
                <span className="flex items-center gap-1">
                  <Heart className="h-3 w-3" aria-hidden />
                  {competitors.length} accounts
                </span>
                <span className="flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" aria-hidden />
                  Client: {clientSlug}
                </span>
              </div>
            </div>
          </div>
          <div className="absolute right-4 top-4 rounded-full bg-primary-container/90 px-3 py-1 text-[10px] font-extrabold text-on-primary-container backdrop-blur-md">
            API: LIVE
          </div>
        </div>

        <div className="col-span-1 space-y-6 lg:col-span-8">
          <div className="rounded-xl bg-surface-container p-6 md:p-8">
            <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
              <h3 className="text-xl font-bold tracking-tight text-on-surface">Competitors</h3>
              <span className="rounded-full bg-surface-container-high px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                {competitors.length} loaded
              </span>
            </div>
            <div className="space-y-4">
              {competitors.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No competitors yet. Run discovery above or migrate from{" "}
                  <code className="rounded bg-zinc-900 px-1">current-competitors.json</code>.
                </p>
              ) : (
                competitors.map((row) => <CompetitorRowView key={row.id} row={row} />)
              )}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-primary/10 bg-primary-container/5 p-8">
            <div className="absolute -right-32 -top-32 h-64 w-64 bg-primary/5 blur-[80px]" />
            <div className="relative flex flex-col gap-8 sm:flex-row">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary-container">
                <Sparkles className="h-6 w-6" aria-hidden />
              </div>
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-on-surface">Intelligence breakdown</h3>
                <p className="max-w-xl text-sm leading-relaxed text-zinc-400">
                  Tier 1–3 competitors are prioritized for pattern extraction. Refresh baseline
                  periodically so composite scores stay meaningful vs. your own account median
                  views.
                </p>
                <div className="flex flex-wrap gap-6 pt-2">
                  <div>
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                      API base
                    </span>
                    <p className="rounded bg-surface-container px-3 py-1 font-mono text-xs">
                      {apiBase}
                    </p>
                  </div>
                  <div>
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                      Org slug
                    </span>
                    <p className="rounded bg-surface-container px-3 py-1 font-mono text-xs">
                      {orgSlug}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-16 md:mt-20">
        <h3 className="mb-8 text-2xl font-extrabold tracking-tight text-on-surface">Next steps.</h3>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-outline-variant/5 bg-surface-container-low p-6">
            <p className="mb-1 text-sm font-semibold text-on-surface">Baseline</p>
            <p className="text-[11px] text-zinc-500">
              POST <code className="text-zinc-400">/baseline/refresh</code> via API or add a button
              later.
            </p>
          </div>
          <div className="rounded-xl border border-outline-variant/5 bg-surface-container-low p-6">
            <p className="mb-1 text-sm font-semibold text-on-surface">Worker</p>
            <p className="text-[11px] text-zinc-500">
              Keep <code className="text-zinc-400">python worker.py</code> running for queued jobs.
            </p>
          </div>
          <div className="rounded-xl border border-outline-variant/5 bg-surface-container-low p-6">
            <p className="mb-1 text-sm font-semibold text-on-surface">Scraped reels</p>
            <p className="text-[11px] text-zinc-500">Phase 2: viral reel feed from scraped_reels.</p>
          </div>
          <div className="flex flex-col justify-between rounded-xl bg-primary-container p-6">
            <p className="text-xs font-extrabold uppercase tracking-widest text-on-primary-container">
              Actionable
            </p>
            <h4 className="font-bold leading-tight text-on-primary-container">
              Generate scripts from these signals?
            </h4>
            <Link
              href="/generate"
              className="mt-4 w-full rounded-lg bg-on-primary-container py-2 text-center text-xs font-bold uppercase text-primary-container transition-opacity hover:opacity-90"
            >
              Open Generate
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
