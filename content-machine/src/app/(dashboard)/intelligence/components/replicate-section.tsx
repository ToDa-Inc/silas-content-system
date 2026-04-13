"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import type { ScrapedReelRow } from "@/lib/api";
import { formatViewsToComments, viewsToCommentsRatio } from "@/lib/reel-comment-view";
import { fetchReplicateSuggestions } from "@/lib/api-client";
import { ReelCardWithAnalysis } from "./reel-card-with-analysis";
import { RecreateReelModal } from "./recreate-reel-modal";

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
};

const HOUR_OPTIONS = [24, 48, 72] as const;

export function ReplicateSection({ clientSlug, orgSlug, disabled, disabledHint }: Props) {
  const [hours, setHours] = useState<number>(24);
  const [reels, setReels] = useState<ScrapedReelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalReel, setModalReel] = useState<ScrapedReelRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const canFetch = Boolean(!disabled && clientSlug.trim() && orgSlug.trim());
  const showLoading = canFetch && loading;

  useEffect(() => {
    if (!canFetch) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchReplicateSuggestions(clientSlug, orgSlug, hours, 8).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) {
        setReels(res.data);
      } else {
        setReels([]);
        setError(res.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clientSlug, orgSlug, hours, canFetch]);

  return (
    <>
      <div className="mb-6">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-app-fg">Replicate</h3>
          <div className="flex gap-1">
            {HOUR_OPTIONS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHours(h)}
                className={`rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                  hours === h
                    ? "bg-amber-500/20 text-amber-700 dark:text-amber-400"
                    : "text-app-fg-muted hover:bg-white/10"
                }`}
              >
                {h}h
              </button>
            ))}
          </div>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-app-fg-muted">
          Competitor reels posted in the last {hours}h compared against what their account&apos;s
          reels typically get at the {hours}h mark. Ranked by outbreaker ratio. Click to adapt
          for your client.
        </p>

        {showLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-app-fg-subtle" />
          </div>
        ) : error ? (
          <p className="text-xs text-red-400/90">{error}</p>
        ) : reels.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300/60 bg-zinc-50/30 px-4 py-6 text-center dark:border-white/10 dark:bg-white/[0.02]">
            <p className="text-xs font-semibold text-app-fg-muted">
              No outbreaker reels in the last {hours}h
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-app-fg-subtle">
              Run a sync to refresh competitor data, or use{" "}
              <Link href="/generate" className="font-semibold text-amber-700 hover:underline dark:text-amber-400">
                Generate
              </Link>{" "}
              to paste a reel URL and adapt it.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 xl:grid-cols-4">
            {reels.map((reel) => (
              <ReelCardWithAnalysis
                key={reel.id}
                row={reel}
                clientSlug={clientSlug}
                orgSlug={orgSlug}
                compact
              >
                <div className="group/thumb relative shrink-0 overflow-hidden rounded">
                  <ReelThumbnail
                    src={reel.thumbnail_url}
                    alt={`@${reel.account_username} reel`}
                    href={reel.post_url}
                    size="sm"
                  />
                  {reel.outbreaker_ratio != null ? (
                    <span
                      className="pointer-events-none absolute left-0 right-0 bottom-0 z-10 rounded-b-[inherit] bg-gradient-to-t from-zinc-950/95 via-zinc-950/75 to-transparent px-1 pb-0.5 pt-3 text-center text-[7px] font-semibold leading-tight text-amber-300/95 opacity-0 shadow-sm transition-opacity duration-200 group-hover/thumb:opacity-100 group-focus-within/thumb:opacity-100"
                      title={
                        reel.outbreaker_ratio_source === "milestone_avg"
                          ? `Views ÷ this account's avg views at ${hours}h`
                          : "Views ÷ account avg (milestone data insufficient)"
                      }
                    >
                      {reel.outbreaker_ratio.toFixed(1)}× @{hours}h
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold leading-tight text-app-fg">
                    @{reel.account_username}
                  </p>
                  <p className="mt-0.5 line-clamp-1 text-[10px] text-app-fg-muted">
                    {reel.hook_text || reel.caption || "—"}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[9px] tabular-nums text-app-fg-subtle">
                    <span>
                      {reel.views != null ? `${Number(reel.views).toLocaleString()} views` : "—"}
                    </span>
                    <span>
                      {reel.comments != null
                        ? `${Number(reel.comments).toLocaleString()} comments`
                        : "—"}
                    </span>
                  </div>
                  {viewsToCommentsRatio(reel) != null ? (
                    <p
                      className="mt-1 text-[9px] tabular-nums text-app-fg-subtle"
                      title="Views ÷ comments"
                    >
                      {formatViewsToComments(reel)}
                    </p>
                  ) : null}
                  {reel.outbreaker_ratio != null ? (
                    <span className="mt-1 inline-block rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-amber-700 dark:text-amber-400">
                      {reel.outbreaker_ratio.toFixed(1)}×
                      {reel.outbreaker_ratio_source === "account_avg_fallback" ? " avg" : ` @${hours}h`}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setModalReel(reel);
                      setModalOpen(true);
                    }}
                    className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-lg bg-amber-500/15 py-1.5 text-[10px] font-bold text-amber-800 hover:bg-amber-500/25 disabled:opacity-50 dark:text-amber-400"
                  >
                    <Sparkles className="h-3 w-3" aria-hidden />
                    Replicate
                  </button>
                </div>
              </ReelCardWithAnalysis>
            ))}
          </div>
        )}
      </div>

      <RecreateReelModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setModalReel(null);
        }}
        reel={modalReel}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
        disabled={disabled}
        disabledHint={disabledHint}
      />
    </>
  );
}
