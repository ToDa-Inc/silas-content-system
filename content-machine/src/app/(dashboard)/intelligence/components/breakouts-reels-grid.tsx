"use client";

import { useState } from "react";
import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import type { ScrapedReelRow } from "@/lib/api";
import { ReelCardWithAnalysis } from "./reel-card-with-analysis";
import { ReelEngagementInline } from "./reel-engagement-inline";
import { RecreateReelModal } from "./recreate-reel-modal";

type Props = {
  reels: ScrapedReelRow[];
  clientSlug: string;
  orgSlug: string;
};

function breakoutTypeLabels(row: ScrapedReelRow): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  if (row.is_outlier_views) out.push({ key: "v", label: "Views" });
  if (row.is_outlier_likes) out.push({ key: "l", label: "Likes" });
  if (row.is_outlier_comments) out.push({ key: "c", label: "Comments" });
  if (out.length === 0 && row.is_outlier) out.push({ key: "legacy", label: "Views" });
  return out;
}

export function BreakoutsReelsGrid({ reels, clientSlug, orgSlug }: Props) {
  const [recreateRow, setRecreateRow] = useState<ScrapedReelRow | null>(null);

  if (reels.length === 0) {
    return (
      <div className="glass rounded-xl px-6 py-10 text-center">
        <p className="text-sm text-app-fg-muted">
          No breakout reels yet. Add competitors on the{" "}
          <Link href="/intelligence/competitors" className="font-semibold text-amber-600 hover:underline dark:text-amber-400">
            Competitors
          </Link>{" "}
          page — a breakout is when a reel clearly beats that account&apos;s usual performance (your threshold in
          settings). Use <strong>Sync</strong> in the header or <strong>Sync reels</strong> on a competitor row.
        </p>
      </div>
    );
  }

  return (
    <>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {reels.map((row) => (
        <ReelCardWithAnalysis key={row.id} row={row} clientSlug={clientSlug} orgSlug={orgSlug}>
          <div className="relative shrink-0">
            <ReelThumbnail
              src={row.thumbnail_url}
              alt={`@${row.account_username} reel`}
              href={row.post_url}
              size="md"
            />
            {row.outlier_ratio != null ? (
              <span className="absolute -right-1 -top-1 rounded-md bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-zinc-950 shadow">
                {Number(row.outlier_ratio).toFixed(1)}× avg
              </span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-zinc-900 dark:text-app-fg">@{row.account_username}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {breakoutTypeLabels(row).map((t) => (
                <span
                  key={t.key}
                  className="rounded bg-zinc-200/90 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-zinc-700 dark:bg-white/15 dark:text-app-fg-muted"
                >
                  {t.label}
                </span>
              ))}
            </div>
            <p className="mt-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              {row.outlier_ratio != null
                ? `${Number(row.outlier_ratio).toFixed(1)}× peak vs their average (strongest metric)`
                : "—"}
            </p>
            <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-app-fg-muted">
              {row.hook_text || row.caption || "—"}
            </p>
            <ReelEngagementInline className="mt-2" views={row.views} comments={row.comments} comment_view_ratio={row.comment_view_ratio} />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
              {row.competitor_id ? (
                <Link
                  href={`/intelligence/reels?competitor=${encodeURIComponent(row.competitor_id)}`}
                  className="font-semibold text-amber-600 hover:underline dark:text-amber-400"
                >
                  More from account →
                </Link>
              ) : null}
              {row.post_url ? (
                <a
                  href={row.post_url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-app-fg-muted hover:underline"
                >
                  Instagram ↗
                </a>
              ) : null}
              {row.post_url ? (
                <button
                  type="button"
                  onClick={() => setRecreateRow(row)}
                  className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline dark:text-emerald-300/90"
                  title="Adapt this reel for your client"
                >
                  <Clapperboard className="h-3 w-3 shrink-0" aria-hidden />
                  Recreate
                </button>
              ) : null}
            </div>
          </div>
        </ReelCardWithAnalysis>
      ))}
    </div>
    <RecreateReelModal
      open={recreateRow != null}
      onClose={() => setRecreateRow(null)}
      reel={recreateRow}
      clientSlug={clientSlug}
      orgSlug={orgSlug}
    />
    </>
  );
}
