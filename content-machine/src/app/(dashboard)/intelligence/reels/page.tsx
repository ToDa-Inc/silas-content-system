import Link from "next/link";
import {
  fetchBaseline,
  fetchCompetitors,
  fetchScrapedReels,
  getCachedServerApiContext,
  type ScrapedReelRow,
} from "@/lib/api";
import { IntelligenceToolbar } from "../components/intelligence-toolbar";
import { IntelligenceReelsTable } from "./intelligence-reels-table";
import { SourceFilterPills } from "./source-filter-pills";

type PageProps = {
  searchParams: Promise<{ outliers?: string; competitor?: string; source?: string }>;
};

export default async function IntelligenceReelsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const outliersOnly = sp.outliers === "1" || sp.outliers === "true";
  const competitorId = (sp.competitor ?? "").trim();
  const source = (sp.source ?? "").trim();

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
  // Fetch 500 most recent reels sorted by posted_at — enough for all filters, avoids full table dump
  const [reelsRes, compRes, baselineRes] = await Promise.all([
    fetchScrapedReels(false, true, 500, "posted_at", source || undefined),
    fetchCompetitors(),
    fetchBaseline(),
  ]);
  const lastSyncedAt = baselineRes.ok && baselineRes.data ? baselineRes.data.scraped_at : null;

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

  const buildHref = (opts: { outliers?: boolean; competitor?: string | null; source?: string | null }) => {
    const p = new URLSearchParams();
    if (opts.outliers) p.set("outliers", "1");
    if (opts.competitor) p.set("competitor", opts.competitor);
    if (opts.source) p.set("source", opts.source);
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
            lastSyncedAt={lastSyncedAt}
          />
        </div>
        <SourceFilterPills
          pills={[
            {
              href: buildHref({ outliers: false, competitor: competitorId || null, source: null }),
              label: "All sources",
              active: !source && !outliersOnly,
              variant: "neutral",
            },
            {
              href: buildHref({ outliers: true, competitor: competitorId || null, source: source || null }),
              label: "Breakouts only",
              active: outliersOnly,
              variant: "amber",
            },
            {
              href: buildHref({ outliers: false, competitor: competitorId || null, source: "profile" }),
              label: "Competitors",
              active: source === "profile",
              variant: "neutral",
            },
            {
              href: buildHref({ outliers: false, competitor: competitorId || null, source: "keyword_similarity" }),
              label: "Niche reels",
              active: source === "keyword_similarity",
              variant: "purple",
            },
          ]}
        />
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
