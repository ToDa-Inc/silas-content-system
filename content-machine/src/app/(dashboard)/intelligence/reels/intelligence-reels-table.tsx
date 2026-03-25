"use client";

import { useState } from "react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import type { ScrapedReelRow } from "@/lib/api";
import { replicabilityLabel } from "@/lib/replicability-label";
import { ReelAnalysisDetailModal } from "../components/reel-analysis-detail-modal";

function formatPosted(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

type Props = {
  rows: ScrapedReelRow[];
  clientSlug: string;
  orgSlug: string;
};

export function IntelligenceReelsTable({ rows, clientSlug, orgSlug }: Props) {
  const [detailReelId, setDetailReelId] = useState<string | null>(null);

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-zinc-200/90 bg-zinc-50/90 dark:border-white/10 dark:bg-zinc-950/60">
        <table className="w-full min-w-[800px] border-collapse text-left">
          <thead>
            <tr className="border-b border-zinc-200/90 text-[10px] uppercase tracking-widest text-zinc-500 dark:border-white/10 dark:text-app-fg-subtle">
              <th className="px-3 py-3 pr-2 font-medium">#</th>
              <th className="py-3 pr-2 font-medium">Thumb</th>
              <th className="py-3 pr-2 font-medium">Account</th>
              <th className="py-3 pr-2 font-medium">Silas</th>
              <th className="py-3 pr-2 font-medium">Views</th>
              <th className="py-3 pr-2 font-medium">×Their avg</th>
              <th className="py-3 pr-2 font-medium">Likes</th>
              <th className="py-3 pr-2 font-medium">Comments</th>
              <th className="py-3 pr-2 font-medium">Date</th>
              <th className="py-3 pr-2 font-medium">Link</th>
            </tr>
          </thead>
          <tbody className="text-xs text-zinc-800 dark:text-app-fg-secondary">
            {rows.map((row, i) => {
              const a = row.analysis;
              return (
                <tr
                  key={row.id}
                  className="border-b border-zinc-100/90 transition-colors hover:bg-zinc-100/80 dark:border-white/[0.06] dark:hover:bg-white/[0.06]"
                >
                  <td className="px-3 py-2.5 pr-2 align-middle tabular-nums text-zinc-500 dark:text-app-fg-subtle">
                    {i + 1}
                  </td>
                  <td className="py-2.5 pr-2 align-middle">
                    <ReelThumbnail
                      src={row.thumbnail_url}
                      alt={`@${row.account_username} reel`}
                      href={row.post_url}
                      size="sm"
                    />
                  </td>
                  <td className="py-2.5 pr-2 align-middle font-medium text-zinc-900 dark:text-app-fg">
                    @{row.account_username}
                  </td>
                  <td className="py-2.5 pr-2 align-middle">
                    {a ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="whitespace-nowrap text-[10px] font-semibold text-emerald-700 dark:text-emerald-300/95">
                          {a.total_score != null ? `${a.total_score}/50` : "—"}
                          {a.replicability_rating
                            ? ` · ${replicabilityLabel(a.replicability_rating)}`
                            : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => setDetailReelId(row.id)}
                          className="w-fit text-left text-[10px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
                        >
                          View analysis
                        </button>
                      </div>
                    ) : (
                      <span className="text-zinc-400 dark:text-app-fg-faint">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-2 align-middle tabular-nums">
                    {row.views != null ? row.views.toLocaleString() : "—"}
                  </td>
                  <td
                    className={
                      row.is_outlier === true
                        ? "py-2.5 pr-2 align-middle font-bold text-amber-600 dark:text-amber-400"
                        : "py-2.5 pr-2 align-middle text-zinc-400 dark:text-app-fg-faint"
                    }
                  >
                    {row.outlier_ratio != null ? `${Number(row.outlier_ratio).toFixed(1)}×` : "—"}
                  </td>
                  <td className="py-2.5 pr-2 align-middle tabular-nums">
                    {row.likes != null ? row.likes.toLocaleString() : "—"}
                  </td>
                  <td className="py-2.5 pr-2 align-middle tabular-nums">
                    {row.comments != null ? row.comments.toLocaleString() : "—"}
                  </td>
                  <td className="py-2.5 pr-2 align-middle text-zinc-600 dark:text-app-fg-muted">
                    {formatPosted(row.posted_at)}
                  </td>
                  <td className="py-2.5 align-middle">
                    {row.post_url ? (
                      <a
                        href={row.post_url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-amber-600 hover:underline dark:text-amber-400"
                      >
                        ↗
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ReelAnalysisDetailModal
        open={detailReelId != null}
        onClose={() => setDetailReelId(null)}
        reelId={detailReelId ?? ""}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
      />
    </>
  );
}
