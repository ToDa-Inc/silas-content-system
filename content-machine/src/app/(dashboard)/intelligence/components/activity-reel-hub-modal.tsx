"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Sparkles, X } from "lucide-react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import type { ScrapedReelRow } from "@/lib/api";
import { commentViewRatio, formatCommentViewPct } from "@/lib/reel-comment-view";
import { formatSilasScoreSummary } from "@/lib/silas-score-display";
import { AnalyzeReelModal } from "./analyze-reel-modal";
import { ReelAnalysisDetailModal } from "./reel-analysis-detail-modal";
import { ReelHistoryStrip } from "./reel-history-strip";

type Sub = "hub" | "analysis" | "analyze";

type Props = {
  reel: ScrapedReelRow | null;
  open: boolean;
  onClose: () => void;
  clientSlug: string;
  orgSlug: string;
  onAfterAnalyzeJob?: () => void;
};

function formatPostedAt(d: string | null | undefined): string {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export function ActivityReelHubModal({
  reel,
  open,
  onClose,
  clientSlug,
  orgSlug,
  onAfterAnalyzeJob,
}: Props) {
  const router = useRouter();
  const [sub, setSub] = useState<Sub>("hub");

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && sub === "hub") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose, sub]);

  if (!open || !reel) return null;

  if (sub === "analysis") {
    return (
      <ReelAnalysisDetailModal
        open
        onClose={() => setSub("hub")}
        reelId={reel.id}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
      />
    );
  }

  if (sub === "analyze") {
    return (
      <AnalyzeReelModal
        open
        onClose={() => setSub("hub")}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
        initialUrl={reel.post_url}
        skipApify={Boolean(reel.analysis)}
        onAnalysisJobEnqueued={() => {
          onAfterAnalyzeJob?.();
        }}
      />
    );
  }

  const postUrl = reel.post_url?.trim() || "";
  const score = reel.analysis ? formatSilasScoreSummary(reel.analysis) : null;
  const postedAt = formatPostedAt(reel.posted_at);

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm dark:bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-labelledby="activity-reel-hub-title"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200/90 bg-zinc-50 shadow-xl dark:border-white/12 dark:bg-zinc-950/95 dark:shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Scrollable body */}
        <div className="max-h-[88vh] overflow-y-auto p-5">
          {/* Header */}
          <div className="mb-4 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2
                id="activity-reel-hub-title"
                className="text-sm font-semibold text-zinc-900 dark:text-app-fg"
              >
                @{reel.account_username}
              </h2>
              {postedAt ? (
                <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-app-fg-muted">
                  Posted {postedAt}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-200/80 dark:text-app-fg-subtle dark:hover:bg-white/10"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Thumbnail + stats */}
          <div className="flex gap-4">
            {/* Fixed-size thumbnail container — never grows beyond its box */}
            <div className="shrink-0">
              <div className="h-36 w-24 overflow-hidden rounded-xl border border-zinc-200/80 dark:border-white/10">
                <ReelThumbnail
                  src={reel.thumbnail_url}
                  alt={`@${reel.account_username} reel`}
                  href={reel.post_url}
                  size="md"
                  className="h-full w-full"
                />
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <p className="line-clamp-4 text-[12px] leading-relaxed text-zinc-800 dark:text-app-fg-secondary">
                {reel.hook_text || reel.caption || "—"}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 tabular-nums text-[11px]">
                <div>
                  <dt className="text-zinc-500 dark:text-app-fg-muted">Views</dt>
                  <dd className="font-medium text-zinc-900 dark:text-app-fg">
                    {reel.views != null ? Number(reel.views).toLocaleString() : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500 dark:text-app-fg-muted">Likes</dt>
                  <dd className="font-medium text-zinc-900 dark:text-app-fg">
                    {reel.likes != null ? Number(reel.likes).toLocaleString() : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500 dark:text-app-fg-muted">Comments</dt>
                  <dd className="font-medium text-zinc-900 dark:text-app-fg">
                    {reel.comments != null ? Number(reel.comments).toLocaleString() : "—"}
                  </dd>
                </div>
                {commentViewRatio(reel) != null ? (
                  <div>
                    <dt className="text-zinc-500 dark:text-app-fg-muted">C / V</dt>
                    <dd className="font-medium text-zinc-900 dark:text-app-fg">
                      {formatCommentViewPct(reel)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </div>

          <ReelHistoryStrip clientSlug={clientSlug} orgSlug={orgSlug} reelId={reel.id} />

          {/* Score pill */}
          {score ? (
            <div className="mt-4 flex items-center gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5 dark:bg-emerald-500/15">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-900 dark:text-emerald-200/80">
                  Score
                </p>
                <p className="mt-0.5 text-[13px] font-bold text-emerald-950 dark:text-emerald-100">
                  {score.scoreText}
                  <span className="text-[11px] font-normal opacity-75">{score.maxSuffix}</span>
                  {score.ratingText ? (
                    <span className="ml-2 text-[11px] font-medium opacity-85">
                      {score.ratingText}
                    </span>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSub("analysis")}
                className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-500/20 dark:text-amber-200"
              >
                View breakdown
              </button>
            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-zinc-200/80 bg-zinc-100/80 px-3 py-2 text-[11px] leading-relaxed text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-app-fg-muted">
              Not scored yet — use the button below to run an analysis.
            </p>
          )}

          {/* Action buttons */}
          <div className="mt-5 flex flex-col gap-2">
            {postUrl ? (
              <button
                type="button"
                onClick={() => setSub("analyze")}
                className="inline-flex w-full items-center justify-center rounded-lg border border-zinc-300/60 bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-200/70 dark:border-white/10 dark:bg-white/[0.07] dark:text-app-fg dark:hover:bg-white/[0.12]"
              >
                {reel.analysis ? "Re-score this reel" : "Score this reel"}
              </button>
            ) : (
              <p className="text-center text-[11px] text-zinc-500 dark:text-app-fg-muted">
                No URL stored — sync this reel first to score it.
              </p>
            )}
            {postUrl ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  router.push(
                    `/generate?mode=url_adapt&url=${encodeURIComponent(postUrl)}`,
                  );
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-500/35 bg-violet-500/10 px-4 py-2.5 text-sm font-semibold text-violet-950 transition-colors hover:bg-violet-500/20 dark:text-violet-100 dark:hover:bg-violet-500/20"
              >
                <Sparkles className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                Recreate this hook
              </button>
            ) : (
              <p className="text-center text-[11px] text-zinc-500 dark:text-app-fg-muted">
                No URL stored — sync this reel first to recreate.
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/80 pt-4 dark:border-white/10">
            {postUrl ? (
              <a
                href={postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 hover:underline dark:text-sky-300"
              >
                Open on Instagram
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ) : (
              <span />
            )}
            <Link
              href="/intelligence/reels"
              className="text-[11px] font-semibold text-amber-700 hover:underline dark:text-amber-400"
              onClick={onClose}
            >
              All reels →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
