import Link from "next/link";
import {
  fetchBaseline,
  fetchCompetitors,
  fetchReelsList,
  getCachedServerApiContext,
  type ReelsListSortBy,
} from "@/lib/api";
import { IntelligenceToolbar } from "../components/intelligence-toolbar";
import { IntelligenceReelsTable } from "./intelligence-reels-table";
import { SourceFilterPills } from "./source-filter-pills";

/**
 * URL contract for /intelligence/reels.
 * Every server-side filter is a query param so views are shareable and
 * the back/forward buttons replay history correctly.
 */
type ReelsSearchParams = {
  outliers?: string;
  competitor?: string;
  source?: string;
  creator?: string;
  sort?: string;
  dir?: string;
  page?: string;
  per?: string;
  min_views?: string;
  max_views?: string;
  min_likes?: string;
  max_likes?: string;
  min_comments?: string;
  max_comments?: string;
  posted_after?: string;
  posted_before?: string;
};

type PageProps = {
  searchParams: Promise<ReelsSearchParams>;
};

const SORT_WHITELIST: readonly ReelsListSortBy[] = [
  "posted_at",
  "views",
  "likes",
  "comments",
  "saves",
  "shares",
  "outlier_ratio",
  "similarity_score",
  "video_duration",
  "first_seen_at",
];

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function clampInt(raw: string | undefined, fallback: number, min: number, max: number) {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function optionalInt(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default async function IntelligenceReelsPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const outliersOnly = sp.outliers === "1" || sp.outliers === "true";
  const competitorId = (sp.competitor ?? "").trim();
  const source = (sp.source ?? "").trim();
  const creator = (sp.creator ?? "").trim();
  const sortRaw = (sp.sort ?? "").trim() as ReelsListSortBy;
  const sortBy: ReelsListSortBy = SORT_WHITELIST.includes(sortRaw) ? sortRaw : "posted_at";
  const sortDir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const pageSize = clampInt(sp.per, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const page = clampInt(sp.page, 1, 1, 1_000);
  const offset = (page - 1) * pageSize;

  const minViews = optionalInt(sp.min_views);
  const maxViews = optionalInt(sp.max_views);
  const minLikes = optionalInt(sp.min_likes);
  const maxLikes = optionalInt(sp.max_likes);
  const minComments = optionalInt(sp.min_comments);
  const maxComments = optionalInt(sp.max_comments);
  const postedAfter = (sp.posted_after ?? "").trim() || null;
  const postedBefore = (sp.posted_before ?? "").trim() || null;

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

  const [reelsRes, compRes, baselineRes] = await Promise.all([
    fetchReelsList({
      includeAnalysis: true,
      limit: pageSize,
      offset,
      sortBy,
      sortDir,
      outlierOnly: outliersOnly || undefined,
      source: source || undefined,
      creator: creator || undefined,
      competitorId: competitorId || undefined,
      minViews,
      maxViews,
      minLikes,
      maxLikes,
      minComments,
      maxComments,
      postedAfter,
      postedBefore,
    }),
    fetchCompetitors(),
    fetchBaseline(),
  ]);

  const lastSyncedAt = baselineRes.ok && baselineRes.data ? baselineRes.data.scraped_at : null;
  const rows = reelsRes.ok ? reelsRes.data : [];
  const total = reelsRes.ok ? reelsRes.total : 0;
  const competitors = compRes.ok ? compRes.data : [];
  const competitorLabel =
    competitorId && competitors.length
      ? competitors.find((c) => c.id === competitorId)?.username ?? null
      : null;

  const buildHref = (opts: {
    outliers?: boolean;
    competitor?: string | null;
    source?: string | null;
  }) => {
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
      ) : (
        <IntelligenceReelsTable
          rows={rows}
          total={total}
          clientSlug={clientSlug}
          orgSlug={orgSlug}
          serverState={{
            sortBy,
            sortDir,
            page,
            pageSize,
            creator,
            outliersOnly,
            source,
            competitorId,
            minViews,
            maxViews,
            minLikes,
            maxLikes,
            minComments,
            maxComments,
            postedAfter,
            postedBefore,
          }}
        />
      )}
    </main>
  );
}
