"use client";

import type { ScrapedReelRow, WeekBreakoutsPayload } from "@/lib/api";
import { commentViewRatio, formatCommentViewPct } from "@/lib/reel-comment-view";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import { ReelCardWithAnalysis } from "./reel-card-with-analysis";

export function formatWindowHint(wb: WeekBreakoutsPayload | undefined): string {
  if (wb?.scope === "growth_7d_post_age") {
    const m = wb.maturity_days ?? 7;
    const d = wb.measure_days ?? 7;
    return `Top 3 by growth (days ${m + 1}–${m + d} after publish)`;
  }
  if (wb?.scope === "growth_7d") {
    return "Top 3 by growth (last 7 days)";
  }
  if (wb?.scope === "all_stored") {
    return "All synced reels · same catalog as Reels";
  }
  if (!wb?.window_start || !wb?.window_end) {
    return "Last 7 days · competitor breakouts";
  }
  try {
    const start = new Date(wb.window_start);
    const end = new Date(wb.window_end);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${start.toLocaleDateString(undefined, opts)}–${end.toLocaleDateString(undefined, opts)} · rolling weekly`;
  } catch {
    return "Last 7 days · competitor breakouts";
  }
}

export function normalizeTopList(raw: unknown): ScrapedReelRow[] {
  if (Array.isArray(raw)) return raw as ScrapedReelRow[];
  if (raw && typeof raw === "object") return [raw as ScrapedReelRow];
  return [];
}

export function topThreeSlotsOrdered(reels: ScrapedReelRow[]): (ScrapedReelRow | null)[] {
  if (!reels.length) return [];
  const out: (ScrapedReelRow | null)[] = reels.slice(0, 3).map((r) => r);
  while (out.length < 3) out.push(null);
  return out.slice(0, 3);
}

export function formatCompactAbs(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}K`;
  return String(Math.round(abs));
}

export function formatCompactDeltaSigned(n: number): string {
  if (n === 0) return "0";
  const body = formatCompactAbs(n);
  return n > 0 ? `+${body}` : `−${body}`;
}

export function growthDeltaForMetric(
  reel: ScrapedReelRow,
  metric: "views" | "likes" | "comments",
): number | null {
  if (metric === "views") return reel.growth_views != null ? Number(reel.growth_views) : null;
  if (metric === "likes") return reel.growth_likes != null ? Number(reel.growth_likes) : null;
  return reel.growth_comments != null ? Number(reel.growth_comments) : null;
}

export function CompactBreakoutRow({
  reel,
  clientSlug,
  orgSlug,
  highlight,
  lane = "weekly",
  weeklyMomentumBadge = "7d",
  onOpenDetail,
}: {
  reel: ScrapedReelRow;
  clientSlug: string;
  orgSlug: string;
  highlight: "views" | "likes" | "comments";
  lane?: "weekly" | "trending" | "proven";
  weeklyMomentumBadge?: string;
  onOpenDetail?: () => void;
}) {
  const hv = highlight === "views";
  const hl = highlight === "likes";
  const hc = highlight === "comments";
  const growth = growthDeltaForMetric(reel, highlight);
  const gv = growthDeltaForMetric(reel, "views");
  const gl = growthDeltaForMetric(reel, "likes");
  const gc = growthDeltaForMetric(reel, "comments");
  const metricWord = highlight === "views" ? "views" : highlight === "likes" ? "likes" : "comments";
  const growthTitle =
    growth != null
      ? `${formatCompactDeltaSigned(growth)} ${metricWord} vs prior snapshot (≈7d window or last sync)`
      : undefined;

  const trendingRatio =
    reel.trending_ratio != null && Number.isFinite(Number(reel.trending_ratio))
      ? Number(reel.trending_ratio)
      : null;
  const provenGrowth = reel.growth_views != null ? Number(reel.growth_views) : null;

  const thumbOverlay =
    lane === "trending" && trendingRatio != null ? (
      <span
        className="pointer-events-none absolute left-0 right-0 bottom-0 z-10 rounded-b-[inherit] bg-gradient-to-t from-zinc-950/95 via-zinc-950/75 to-transparent px-1 pb-0.5 pt-3 text-center text-[7px] font-semibold leading-tight text-sky-300/95 opacity-0 shadow-sm transition-opacity duration-200 group-hover/thumb:opacity-100 group-focus-within/thumb:opacity-100"
        title="Views compared with this account’s usual reach from the last competitor sync"
      >
        {trendingRatio.toFixed(1)}× their usual
      </span>
    ) : lane === "proven" && provenGrowth != null ? (
      <span
        className={`pointer-events-none absolute left-0 right-0 bottom-0 z-10 rounded-b-[inherit] bg-gradient-to-t from-zinc-950/95 via-zinc-950/75 to-transparent px-1 pb-0.5 pt-3 text-center text-[7px] font-semibold leading-tight opacity-0 shadow-sm transition-opacity duration-200 group-hover/thumb:opacity-100 group-focus-within/thumb:opacity-100 ${
          provenGrowth > 0
            ? "text-emerald-300/95"
            : provenGrowth < 0
              ? "text-zinc-300/90"
              : "text-amber-200/95"
        }`}
        title="View change vs baseline snapshot (~14d after post, or nearest sync history)"
      >
        {formatCompactDeltaSigned(provenGrowth)} views
      </span>
    ) : lane === "weekly" && growth != null ? (
      <span
        className={`pointer-events-none absolute left-0 right-0 bottom-0 z-10 rounded-b-[inherit] bg-gradient-to-t from-zinc-950/95 via-zinc-950/75 to-transparent px-1 pb-0.5 pt-3 text-center text-[7px] font-semibold leading-tight opacity-0 shadow-sm transition-opacity duration-200 group-hover/thumb:opacity-100 group-focus-within/thumb:opacity-100 ${
          growth > 0
            ? "text-emerald-300/95"
            : growth < 0
              ? "text-zinc-300/90"
              : "text-amber-200/95"
        }`}
        title={growthTitle}
      >
        {formatCompactDeltaSigned(growth)} · {weeklyMomentumBadge}
      </span>
    ) : null;

  const showWeeklyDeltas = lane === "weekly";

  const card = (
    <ReelCardWithAnalysis row={reel} clientSlug={clientSlug} orgSlug={orgSlug} compact>
      <div className="group/thumb relative shrink-0 overflow-hidden rounded">
        <ReelThumbnail
          src={reel.thumbnail_url}
          alt={`@${reel.account_username} reel`}
          href={reel.post_url}
          size="sm"
        />
        {thumbOverlay}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold leading-tight text-app-fg">@{reel.account_username}</p>
        <p className="mt-0.5 line-clamp-1 text-[10px] text-app-fg-muted">{reel.hook_text || reel.caption || "—"}</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[9px] tabular-nums text-app-fg-subtle">
          <span className={`inline-flex flex-col gap-0 ${hv ? "font-semibold text-amber-600 dark:text-amber-400" : ""}`}>
            <span>{reel.views != null ? `${Number(reel.views).toLocaleString()} views` : "—"}</span>
            {showWeeklyDeltas && gv != null ? (
              <span
                className={`font-medium text-[8px] leading-tight ${
                  gv > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : gv < 0
                      ? "text-zinc-500 dark:text-zinc-400"
                      : "text-app-fg-muted"
                }`}
                title="Change vs baseline snapshot"
              >
                {formatCompactDeltaSigned(gv)} · {weeklyMomentumBadge}
              </span>
            ) : null}
          </span>
          <span className={`inline-flex flex-col gap-0 ${hl ? "font-semibold text-amber-600 dark:text-amber-400" : ""}`}>
            <span>{reel.likes != null ? `${Number(reel.likes).toLocaleString()} likes` : "—"}</span>
            {showWeeklyDeltas && gl != null ? (
              <span
                className={`font-medium text-[8px] leading-tight ${
                  gl > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : gl < 0
                      ? "text-zinc-500 dark:text-zinc-400"
                      : "text-app-fg-muted"
                }`}
                title="Change vs baseline snapshot"
              >
                {formatCompactDeltaSigned(gl)} · {weeklyMomentumBadge}
              </span>
            ) : null}
          </span>
          <span className={`inline-flex flex-col gap-0 ${hc ? "font-semibold text-amber-600 dark:text-amber-400" : ""}`}>
            <span>{reel.comments != null ? `${Number(reel.comments).toLocaleString()} comments` : "—"}</span>
            {showWeeklyDeltas && gc != null ? (
              <span
                className={`font-medium text-[8px] leading-tight ${
                  gc > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : gc < 0
                      ? "text-zinc-500 dark:text-zinc-400"
                      : "text-app-fg-muted"
                }`}
                title="Change vs baseline snapshot"
              >
                {formatCompactDeltaSigned(gc)} · {weeklyMomentumBadge}
              </span>
            ) : null}
          </span>
        </div>
        {commentViewRatio(reel) != null ? (
          <p className="mt-1 text-[9px] tabular-nums text-app-fg-subtle" title="Comments ÷ views">
            C/V {formatCommentViewPct(reel)}
          </p>
        ) : null}
        {lane === "proven" && reel.proven_growth_source === "raw_views" ? (
          <p className="mt-0.5 text-[8px] leading-snug text-app-fg-muted">
            Ranked by total views (no snapshot history yet)
          </p>
        ) : null}
      </div>
    </ReelCardWithAnalysis>
  );

  if (onOpenDetail) {
    return (
      <button
        type="button"
        onClick={onOpenDetail}
        className="w-full cursor-pointer text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-1"
        aria-label={`Open details for @${reel.account_username}`}
      >
        {card}
      </button>
    );
  }

  return card;
}

export function TopMetricPlaceholderRow() {
  return (
    <div className="flex min-h-[72px] items-center rounded-xl border border-dashed border-zinc-300/60 bg-zinc-50/30 px-3 py-2 dark:border-white/10 dark:bg-white/[0.02]">
      <p className="text-[10px] leading-relaxed text-app-fg-muted">—</p>
    </div>
  );
}

export function ActivityLaneBlock({
  title,
  subtitle,
  reels,
  clientSlug,
  orgSlug,
  lane,
  maxReels,
  onOpenReel,
}: {
  title: string;
  subtitle: string;
  reels: ScrapedReelRow[];
  clientSlug: string;
  orgSlug: string;
  lane: "trending" | "proven";
  maxReels?: number;
  onOpenReel: (reel: ScrapedReelRow) => void;
}) {
  if (!reels.length) return null;
  const list = maxReels != null ? reels.slice(0, maxReels) : reels;
  return (
    <div className="mb-2">
      {title ? <h3 className="mb-1 text-xs font-semibold text-app-fg">{title}</h3> : null}
      <p className="mb-3 text-[11px] leading-relaxed text-app-fg-muted">{subtitle}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 lg:items-stretch">
        {list.map((reel) => (
          <div key={reel.id} className="min-w-0">
            <CompactBreakoutRow
              reel={reel}
              clientSlug={clientSlug}
              orgSlug={orgSlug}
              highlight="views"
              lane={lane}
              onOpenDetail={() => onOpenReel(reel)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function WeeklyMomentumGrid({
  slots,
  clientSlug,
  orgSlug,
  highlight,
  weeklyMomentumBadge,
  onOpenReel,
}: {
  slots: (ScrapedReelRow | null)[];
  clientSlug: string;
  orgSlug: string;
  highlight: "views" | "likes" | "comments";
  weeklyMomentumBadge?: string;
  onOpenReel: (reel: ScrapedReelRow) => void;
}) {
  if (!slots.length) {
    return (
      <div className="flex min-h-[120px] flex-col rounded-xl border border-dashed border-zinc-300/80 bg-zinc-50/50 p-3 dark:border-white/15 dark:bg-white/[0.02]">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-app-fg-subtle">Top 3</p>
        <p className="mt-2 flex-1 text-xs leading-relaxed text-app-fg-muted">
          No reels in your catalog yet. Sync content or open Reels to browse.
        </p>
      </div>
    );
  }

  return (
    <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-3">
      {slots.map((reel, i) =>
        reel ? (
          <div key={reel.id} className="min-w-0">
            <CompactBreakoutRow
              reel={reel}
              clientSlug={clientSlug}
              orgSlug={orgSlug}
              highlight={highlight}
              weeklyMomentumBadge={weeklyMomentumBadge}
              onOpenDetail={() => onOpenReel(reel)}
            />
          </div>
        ) : (
          <TopMetricPlaceholderRow key={`empty-weekly-${i}`} />
        ),
      )}
    </div>
  );
}

export const WEEKLY_METRIC_OPTIONS: { value: string; label: string }[] = [
  { value: "comments", label: "Comments growth" },
  { value: "views", label: "Views growth" },
  { value: "likes", label: "Likes growth" },
];
