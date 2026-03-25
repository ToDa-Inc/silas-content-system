"use client";

import { useMemo, useState } from "react";
import type { BaselineRow, CompetitorRow } from "@/lib/api";

type Props = {
  competitors: CompetitorRow[];
  baseline: BaselineRow | null;
};

function baselineMultiplier(
  avgViews: number | null,
  median: number | null | undefined,
): number | null {
  if (avgViews == null || median == null || median <= 0) return null;
  return Math.round(avgViews / median);
}

export function CompetitorsList({ competitors, baseline }: Props) {
  const [showAll, setShowAll] = useState(false);

  const median = baseline?.median_views;

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
          Use Discover competitors above to find accounts in this niche.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visibleRows.map((row, idx) => {
        const rank = competitors.indexOf(row) + 1;
        const mult = baselineMultiplier(row.avg_views, median);
        const score =
          row.composite_score != null ? row.composite_score : row.relevance_score ?? null;
        const scoreLabel = score != null ? `Score ${score}` : "—";

        return (
          <div
            key={row.id}
            className="glass rounded-xl px-4 py-3 transition-colors hover:bg-zinc-100/70 dark:hover:bg-white/[0.06]"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <span className="w-8 shrink-0 text-[11px] text-app-fg-subtle">#{rank}</span>
              <span className="font-semibold text-app-fg">@{row.username}</span>
              <span className="text-app-fg-muted">
                {row.avg_views != null ? `${row.avg_views.toLocaleString()} avg views` : "—"}
              </span>
              <span className="font-bold text-amber-400">
                {mult != null ? `${mult}× your baseline` : "—"}
              </span>
              <span className="text-app-fg-muted">{scoreLabel}</span>
              {row.profile_url ? (
                <a
                  href={row.profile_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-amber-400 hover:underline sm:ml-auto"
                >
                  Profile ↗
                </a>
              ) : null}
            </div>
            {row.reasoning ? (
              <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-app-fg-subtle">
                {row.reasoning}
              </p>
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
