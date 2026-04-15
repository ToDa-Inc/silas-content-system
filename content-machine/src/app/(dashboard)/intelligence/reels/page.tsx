import Link from "next/link";
import {
  fetchCompetitors,
  fetchScrapedReels,
  getCachedServerApiContext,
  type ScrapedReelRow,
} from "@/lib/api";
import { IntelligenceToolbar } from "../components/intelligence-toolbar";
import { IntelligenceReelsTable } from "./intelligence-reels-table";

type PageProps = {
  searchParams: Promise<{ outliers?: string; competitor?: string }>;
};

export default async function IntelligenceReelsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const outliersOnly = sp.outliers === "1" || sp.outliers === "true";
  const competitorId = (sp.competitor ?? "").trim();

  const { clientSlug, orgSlug, user, tenancy } = await getCachedServerApiContext();
  const syncDisabled = !clientSlug.trim() || !orgSlug.trim();
  const syncDisabledHint =
    user && !tenancy
      ? "No workspace membership visible for this login — see the alert on Intelligence."
      : !orgSlug.trim()
        ? "Missing organization slug — refresh or check Supabase session."
        : !clientSlug.trim()
          ? "Pick a creator in the header or finish onboarding."
          : null;
  // Fetch 200 most recent reels sorted by posted_at — enough for all filters, avoids full table dump
  const [reelsRes, compRes] = await Promise.all([fetchScrapedReels(false, true, 200, "posted_at"), fetchCompetitors()]);

  const reelsAll = reelsRes.ok ? reelsRes.data : [];
  const competitors = compRes.ok ? compRes.data : [];
  const competitorLabel =
    competitorId && competitors.length
      ? competitors.find((c) => c.id === competitorId)?.username ?? null
      : null;

  let rows: ScrapedReelRow[] = reelsAll;
  if (outliersOnly) {
    rows = rows.filter((r) => r.is_outlier === true);
  }
  if (competitorId) {
    rows = rows.filter((r) => r.competitor_id === competitorId);
  }

  const buildHref = (opts: { outliers?: boolean; competitor?: string | null }) => {
    const p = new URLSearchParams();
    if (opts.outliers) p.set("outliers", "1");
    if (opts.competitor) p.set("competitor", opts.competitor);
    const q = p.toString();
    return q ? `/intelligence/reels?${q}` : "/intelligence/reels";
  };

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-8 md:px-8">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link
              href="/intelligence"
              className="font-medium text-app-fg-muted transition-colors hover:text-amber-400"
            >
              ← Intelligence
            </Link>
            <span className="text-zinc-400 dark:text-zinc-600">|</span>
            <span className="font-semibold text-app-fg">Reels</span>
          </div>
          <IntelligenceToolbar
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            disabled={syncDisabled}
            disabledHint={syncDisabledHint}
            showSyncLabel
          />
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link
            href={buildHref({ outliers: false, competitor: competitorId || null })}
            className={
              !outliersOnly
                ? "rounded-lg bg-zinc-200 px-3 py-1.5 font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                : "rounded-lg px-3 py-1.5 text-app-fg-muted hover:bg-zinc-200 dark:hover:bg-zinc-800"
            }
          >
            All
          </Link>
          <Link
            href={buildHref({ outliers: true, competitor: competitorId || null })}
            className={
              outliersOnly
                ? "rounded-lg bg-amber-500/20 px-3 py-1.5 font-semibold text-amber-700 dark:text-amber-400"
                : "rounded-lg px-3 py-1.5 text-app-fg-muted hover:bg-zinc-200 dark:hover:bg-zinc-800"
            }
          >
            Breakouts only
          </Link>
        </div>
      </header>

      {(competitorId && competitorLabel) || competitorId ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          <span className="text-app-fg-secondary">
            {competitorLabel ? (
              <>
                Showing reels from <strong>@{competitorLabel}</strong>
              </>
            ) : (
              <>Filtered by competitor</>
            )}
          </span>
          <Link href={buildHref({ outliers: outliersOnly, competitor: null })} className="font-semibold text-amber-600 hover:underline dark:text-amber-400">
            Clear account filter
          </Link>
        </div>
      ) : null}

      {!reelsRes.ok ? (
        <p className="text-sm text-app-fg-muted">Couldn&apos;t load reels. Try again later.</p>
      ) : rows.length === 0 ? (
        <div className="glass rounded-xl px-6 py-12 text-center">
          <p className="text-sm text-app-fg-muted">
            {competitorId
              ? "No reels stored for this account yet. Sync them from Intelligence."
              : "No reels yet. Go back to Intelligence and run a sync."}
          </p>
          <Link
            href="/intelligence"
            className="mt-4 inline-block text-sm font-semibold text-amber-400 hover:underline"
          >
            ← Intelligence
          </Link>
        </div>
      ) : (
        <IntelligenceReelsTable rows={rows} clientSlug={clientSlug} orgSlug={orgSlug} />
      )}
    </main>
  );
}
