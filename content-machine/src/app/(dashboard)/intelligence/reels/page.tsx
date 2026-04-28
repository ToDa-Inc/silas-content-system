import Link from "next/link";
import {
  fetchBaseline,
  fetchClient,
  fetchCompetitors,
  fetchReelsList,
  getCachedServerApiContext,
  type ReelsMediaType,
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
  own?: string;
  competitor?: string;
  source?: string;
  media_type?: string;
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
const MEDIA_TYPE_WHITELIST: readonly ReelsMediaType[] = ["all", "short", "long", "carousel"];

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
  const ownOnly = sp.own === "1" || sp.own === "true";
  const competitorId = (sp.competitor ?? "").trim();
  const source = ownOnly ? "" : (sp.source ?? "").trim();
  const mediaTypeRaw = (sp.media_type ?? "").trim() as ReelsMediaType;
  const mediaType: ReelsMediaType = MEDIA_TYPE_WHITELIST.includes(mediaTypeRaw)
    ? mediaTypeRaw
    : "all";
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

  const [reelsRes, compRes, baselineRes, clientRes] = await Promise.all([
    fetchReelsList({
      includeAnalysis: true,
      limit: pageSize,
      offset,
      sortBy,
      sortDir,
      outlierOnly: outliersOnly || undefined,
      ownReelsOnly: ownOnly || undefined,
      source: source || undefined,
      mediaType,
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
    fetchClient(),
  ]);

  const lastSyncedAt = baselineRes.ok && baselineRes.data ? baselineRes.data.scraped_at : null;
  const rows = reelsRes.ok ? reelsRes.data : [];
  const total = reelsRes.ok ? reelsRes.total : 0;
  const competitors = compRes.ok ? compRes.data : [];
  const competitorLabel =
    competitorId && competitors.length
      ? competitors.find((c) => c.id === competitorId)?.username ?? null
      : null;

  const igHandleRaw =
    clientRes.ok && clientRes.data?.instagram_handle
      ? clientRes.data.instagram_handle.replace(/^@/, "").trim()
      : "";
  const ownCatalogLabel = igHandleRaw ? `@${igHandleRaw}` : "Your reels";

  const buildHref = (opts: {
    outliers?: boolean;
    competitor?: string | null;
    source?: string | null;
    own?: boolean;
  }) => {
    const p = new URLSearchParams();
    if (opts.outliers) p.set("outliers", "1");
    if (opts.competitor) p.set("competitor", opts.competitor);
    if (opts.own) {
      p.set("own", "1");
    } else if (opts.source) {
      p.set("source", opts.source);
    }
    const q = p.toString();
    return q ? `/intelligence/reels?${q}` : "/intelligence/reels";
  };

  return (
    <main className="mx-auto max-w-[min(100%,1400px)] px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6 overflow-hidden rounded-2xl border border-zinc-200/80 bg-zinc-50/70 shadow-sm dark:border-white/10 dark:bg-zinc-950/40">
        <div className="flex flex-col gap-4 border-b border-zinc-200/70 p-4 dark:border-white/[0.08] md:flex-row md:items-start md:justify-between md:p-5">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Link
                href="/intelligence"
                className="font-medium text-app-fg-muted transition-colors hover:text-zinc-800 dark:hover:text-app-fg-secondary"
              >
                ← Intelligence
              </Link>
              <span className="text-zinc-300 dark:text-zinc-600" aria-hidden>
                /
              </span>
              <span className="font-semibold tracking-tight text-app-fg">Reels catalog</span>
            </div>
            <p className="max-w-xl text-xs leading-relaxed text-app-fg-muted md:text-sm">
              Scope what you&apos;re optimizing for, then pick which slice of the library to
              browse — your synced baseline, competitors, niche scan hits, or saved links.
            </p>
          </div>
          <IntelligenceToolbar
            variant="embedded"
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            disabled={syncDisabled}
            disabledHint={syncDisabledHint}
            lastSyncedAt={lastSyncedAt}
          />
        </div>

        <div className="flex flex-col gap-4 p-4 md:flex-row md:flex-wrap md:items-end md:gap-6 md:p-5">
          <div className="min-w-0 shrink-0 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-app-fg-muted">
              Scope
            </p>
            <SourceFilterPills
              layout="segmented"
              pills={[
                {
                  href: buildHref({
                    outliers: false,
                    competitor: competitorId || null,
                    own: ownOnly ? true : undefined,
                    source: ownOnly ? undefined : source ? source : undefined,
                  }),
                  label: "All reels",
                  active: !outliersOnly,
                  variant: "neutral",
                },
                {
                  href: buildHref({
                    outliers: true,
                    competitor: competitorId || null,
                    own: ownOnly ? true : undefined,
                    source: ownOnly ? undefined : source ? source : undefined,
                  }),
                  label: "Breakouts only",
                  active: outliersOnly,
                  variant: "amber",
                },
              ]}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-app-fg-muted">
              Catalog
            </p>
            <SourceFilterPills
              layout="segmented"
              pills={[
                {
                  href: buildHref({
                    outliers: outliersOnly,
                    competitor: competitorId || null,
                  }),
                  label: "Everything",
                  active: !source && !ownOnly,
                  variant: "neutral",
                },
                {
                  href: buildHref({
                    outliers: outliersOnly,
                    competitor: competitorId || null,
                    own: true,
                  }),
                  label: ownCatalogLabel,
                  active: ownOnly,
                  variant: "neutral",
                },
                {
                  href: buildHref({
                    outliers: outliersOnly,
                    competitor: competitorId || null,
                    source: "profile",
                  }),
                  label: "Competitors",
                  active: source === "profile",
                  variant: "neutral",
                },
                {
                  href: buildHref({
                    outliers: outliersOnly,
                    competitor: competitorId || null,
                    source: "keyword_similarity",
                  }),
                  label: "Niche finds",
                  active: source === "keyword_similarity",
                  variant: "purple",
                },
                {
                  href: buildHref({
                    outliers: outliersOnly,
                    competitor: competitorId || null,
                    source: "url_paste",
                  }),
                  label: "Saved",
                  active: source === "url_paste",
                  variant: "neutral",
                },
                {
                  href: buildHref({
                    outliers: outliersOnly,
                    competitor: competitorId || null,
                    source: "niche_search",
                  }),
                  label: "Legacy",
                  active: source === "niche_search",
                  variant: "neutral",
                },
              ]}
            />
          </div>
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
          <Link
            href={buildHref({
              outliers: outliersOnly,
              competitor: null,
              own: ownOnly ? true : undefined,
              source: ownOnly ? undefined : source ? source : undefined,
            })}
            className="font-semibold text-amber-600 hover:underline dark:text-amber-400"
          >
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
            ownReelsOnly: ownOnly,
            source,
            mediaType,
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
