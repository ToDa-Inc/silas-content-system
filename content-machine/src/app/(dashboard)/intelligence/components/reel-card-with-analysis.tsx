"use client";

import { useState, type ReactNode } from "react";
import type { ScrapedReelRow } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatSilasScoreSummary } from "@/lib/silas-score-display";
import { ReelAnalysisDetailModal } from "./reel-analysis-detail-modal";

type Props = {
  row: ScrapedReelRow;
  clientSlug: string;
  orgSlug: string;
  children: ReactNode;
  /** Tighter padding and typography for stacked lists (e.g. What happened top 3). */
  compact?: boolean;
};

/** Readable card surface + optional Silas summary + open full analysis. */
export function ReelCardWithAnalysis({ row, clientSlug, orgSlug, children, compact }: Props) {
  const [open, setOpen] = useState(false);
  const a = row.analysis;
  const silas = a ? formatSilasScoreSummary(a) : null;

  return (
    <>
      <div
        className={cn(
          "flex flex-col border border-zinc-200/90 bg-zinc-50/95 shadow-sm dark:border-white/10 dark:bg-zinc-950/75 dark:shadow-none",
          compact ? "rounded-lg p-2" : "rounded-xl p-3",
        )}
      >
        <div className={cn("flex", compact ? "gap-2" : "gap-3")}>{children}</div>
        {a ? (
          <div
            className={cn(
              "flex w-full min-w-0 flex-wrap items-center gap-2 border-t border-zinc-200/80 dark:border-white/10",
              compact ? "mt-1.5 pt-1.5" : "mt-2 pt-2",
            )}
          >
            <span
              className={cn(
                "rounded-md bg-emerald-500/15 font-semibold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200/95",
                compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]",
              )}
            >
              {silas ? (
                <>
                  {silas.scoreText}
                  <span className="font-normal opacity-80">{silas.maxSuffix}</span>
                  {silas.ratingText ? ` · ${silas.ratingText}` : ""}
                </>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className={cn(
                "font-semibold text-amber-600 hover:underline dark:text-amber-400",
                compact ? "text-[9px]" : "text-[10px]",
              )}
            >
              View analysis
            </button>
          </div>
        ) : null}
      </div>
      <ReelAnalysisDetailModal
        open={open}
        onClose={() => setOpen(false)}
        reelId={row.id}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
      />
    </>
  );
}
