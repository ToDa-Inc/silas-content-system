"use client";

import { useState, type ReactNode } from "react";
import type { ScrapedReelRow } from "@/lib/api";
import { replicabilityLabel } from "@/lib/replicability-label";
import { ReelAnalysisDetailModal } from "./reel-analysis-detail-modal";

type Props = {
  row: ScrapedReelRow;
  clientSlug: string;
  orgSlug: string;
  children: ReactNode;
};

/** Readable card surface + optional Silas summary + open full analysis. */
export function ReelCardWithAnalysis({ row, clientSlug, orgSlug, children }: Props) {
  const [open, setOpen] = useState(false);
  const a = row.analysis;

  return (
    <>
      <div className="flex flex-col rounded-xl border border-zinc-200/90 bg-zinc-50/95 p-3 shadow-sm dark:border-white/10 dark:bg-zinc-950/75 dark:shadow-none">
        <div className="flex gap-3">{children}</div>
        {a ? (
          <div className="mt-2 flex w-full min-w-0 flex-wrap items-center gap-2 border-t border-zinc-200/80 pt-2 dark:border-white/10">
            <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200/95">
              {a.total_score != null ? `${a.total_score}/50` : "—"}
              {a.replicability_rating ? ` · ${replicabilityLabel(a.replicability_rating)}` : ""}
            </span>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-[10px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
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
