"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import type { BaselineRow, CompetitorRow, ScrapedReelRow } from "@/lib/api";
import { DeleteCompetitorButton } from "./delete-competitor-button";
import { ScrapeCompetitorReelsButton } from "./scrape-competitor-reels-button";

type Props = {
  competitors: CompetitorRow[];
  baseline: BaselineRow | null;
  scrapedReels?: ScrapedReelRow[];
  clientSlug: string;
  orgSlug: string;
  syncDisabled?: boolean;
};

/** Compare competitor avg views to your typical reel (median from last profile sync). */
function vsYourAverageMultiplier(
  avgViews: number | null,
  yourTypicalViews: number | null | undefined,
): number | null {
  if (avgViews == null || yourTypicalViews == null || yourTypicalViews <= 0) return null;
  return Math.round(avgViews / yourTypicalViews);
}

function recentReelsForCompetitor(reels: ScrapedReelRow[], competitorId: string, limit: number): ScrapedReelRow[] {
  return reels
    .filter((r) => r.competitor_id === competitorId)
    .sort((a, b) => {
      const ta = a.posted_at ? new Date(a.posted_at).getTime() : 0;
      const tb = b.posted_at ? new Date(b.posted_at).getTime() : 0;
      return tb - ta;
    })
    .slice(0, limit);
}

export function CompetitorsList({
  competitors,
  baseline,
  scrapedReels,
  clientSlug,
  orgSlug,
  syncDisabled,
}: Props) {
  const [showAll, setShowAll] = useState(false);
  const reels = Array.isArray(scrapedReels) ? scrapedReels : [];

  const yourTypical = baseline?.median_views;

  const visibleRows = useMemo(() => {
    if (showAll) return competitors;
    return competitors.filter((c) => c.tier !== 4);
  }, [competitors, showAll]);

  const hasTier4 = useMemo(() => competitors.some((c) => c.tier === 4), [competitors]);
  const hasHiddenTier4 = hasTier4 && !showAll;

  if (competitors.length === 0) {
    return (
      <div className="glass rounded-xl px-6 py-12 text-center">
        <p className="text-sm font-medium text-app-fg">No competitors tracked yet.</p>
        <p className="mt-2 text-xs text-app-fg-subtle">
          Open <strong>Add competitors</strong> above to add manually or run discovery.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visibleRows.map((row) => {
        const rank = competitors.indexOf(row) + 1;
        const mult = vsYourAverageMultiplier(row.avg_views, yourTypical);
        const score =
          row.composite_score != null ? row.composite_score : row.relevance_score ?? null;
        const recent = recentReelsForCompetitor(reels, row.id, 3);

        return (
          <div
            key={row.id}
            className="glass !overflow-visible rounded-xl px-4 py-3 transition-colors hover:bg-zinc-100/70 dark:hover:bg-white/[0.06]"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="w-8 shrink-0 text-[11px] text-app-fg-subtle">#{rank}</span>
              <span className="font-semibold text-app-fg">@{row.username}</span>
              {row.added_by ? (
                <span className="rounded bg-emerald-500/20 px-1.5 py-0 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                  Added · {row.added_by}
                </span>
              ) : row.discovery_job_id == null ? (
                <span className="rounded bg-sky-500/20 px-1.5 py-0 text-[10px] font-medium text-sky-800 dark:text-sky-400">
                  Added manually
                </span>
              ) : (
                <span className="rounded bg-zinc-400/15 px-1.5 py-0 text-[10px] text-app-fg-subtle">
                  Discovered
                </span>
              )}
              <span className="text-app-fg-muted">
                {row.avg_views != null ? `${row.avg_views.toLocaleString()} avg views` : "—"}
              </span>
              <span className="font-bold text-amber-400">
                {mult != null ? `${mult}× your average` : "—"}
              </span>
              {row.followers != null ? (
                <span className="text-[11px] text-app-fg-subtle">
                  {row.followers.toLocaleString()} followers
                </span>
              ) : null}
              {row.last_scraped_at ? (
                <span className="text-[10px] text-app-fg-faint">
                  Synced {new Date(row.last_scraped_at).toLocaleDateString()}
                </span>
              ) : null}
              <div className="flex w-full flex-wrap items-center gap-3 sm:ml-auto sm:w-auto">
                <Link
                  href={`/intelligence/reels?competitor=${encodeURIComponent(row.id)}`}
                  className="text-xs font-semibold text-amber-400 hover:underline"
                >
                  Their reels →
                </Link>
                {row.profile_url ? (
                  <a
                    href={row.profile_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-app-fg-muted hover:text-amber-400 hover:underline"
                  >
                    Profile ↗
                  </a>
                ) : null}
              </div>
            </div>

            {recent.length > 0 ? (
              <div className="mt-2 flex flex-col gap-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-app-fg-subtle">
                  Recent
                </span>
                <div className="flex flex-wrap gap-1">
                  {recent.map((r) => (
                    <ReelThumbnail
                      key={r.id}
                      src={r.thumbnail_url}
                      alt={`@${row.username} reel`}
                      href={r.post_url}
                      size="sm"
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {row.reasoning || score != null ? (
              <details className="mt-2 rounded-lg border border-zinc-200/60 dark:border-white/[0.08]">
                <summary className="cursor-pointer select-none px-2 py-1.5 text-[11px] font-medium text-app-fg-muted hover:text-app-fg">
                  Why we track this account
                </summary>
                <div className="border-t border-zinc-200/60 px-2 py-2 dark:border-white/[0.08]">
                  {score != null ? (
                    <p className="text-[10px] text-app-fg-subtle">Relevance score · {score}</p>
                  ) : null}
                  {row.reasoning ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-app-fg-subtle">{row.reasoning}</p>
                  ) : null}
                </div>
              </details>
            ) : null}

            {clientSlug.trim() && orgSlug.trim() ? (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-3">
                <ScrapeCompetitorReelsButton
                  clientSlug={clientSlug}
                  orgSlug={orgSlug}
                  competitorId={row.id}
                  username={row.username}
                  disabled={syncDisabled}
                />
                <div className="flex justify-start sm:justify-end">
                  <DeleteCompetitorButton
                    clientSlug={clientSlug}
                    orgSlug={orgSlug}
                    competitorId={row.id}
                    username={row.username}
                    disabled={syncDisabled}
                  />
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      {hasHiddenTier4 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full py-2 text-center text-xs font-medium text-amber-400 hover:underline"
        >
          Show all accounts ↓
        </button>
      ) : null}
    </div>
  );
}
