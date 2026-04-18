"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Module-level cache: survives tab switches and re-mounts within the same browser session.
// Cleared only when the user triggers a manual sync (activityRefreshKey increments).
const _activityCache = new Map<string, { data: unknown; fetchedAt: number; refreshKey: number }>();
const ACTIVITY_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes — matches backend TTL
import { clientApiHeaders, contentApiFetch, getContentApiBase } from "@/lib/api-client";
import type {
  ActivityLanePayload,
  ScrapedReelRow,
  WeekBreakoutsPayload,
} from "@/lib/api";
import { commentViewRatio, formatCommentViewPct } from "@/lib/reel-comment-view";
import { AppSelect } from "@/components/ui/app-select";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import { ActivityReelHubModal } from "./activity-reel-hub-modal";
import { AnalyzeReelModal } from "./analyze-reel-modal";
import { ReelCardWithAnalysis } from "./reel-card-with-analysis";
import { ReplicateSection } from "./replicate-section";
import { SYNC_COMPLETED_EVENT } from "./sync-data-modal";

type ActivityPayload = {
  since: string;
  new_breakout_reels: ScrapedReelRow[];
  trending_now?: ActivityLanePayload;
  proven_performers?: ActivityLanePayload;
  week_breakouts?: WeekBreakoutsPayload;
  is_quiet: boolean;
};

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
};

type Tab = "act" | "track";

const TABS: { id: Tab; label: string; hint: string }[] = [
  {
    id: "act",
    label: "Hot this week",
    hint: "Fresh competitor posts that are already beating that account’s usual reach — good candidates to recreate first.",
  },
  {
    id: "track",
    label: "Long-term winners",
    hint: "Older posts that kept gaining — patterns worth studying when you’re planning ahead.",
  },
];

function formatWindowHint(wb: WeekBreakoutsPayload | undefined): string {
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

function normalizeTopList(raw: unknown): ScrapedReelRow[] {
  if (Array.isArray(raw)) return raw as ScrapedReelRow[];
  if (raw && typeof raw === "object") return [raw as ScrapedReelRow];
  return [];
}

function topThreeSlotsOrdered(reels: ScrapedReelRow[]): (ScrapedReelRow | null)[] {
  if (!reels.length) return [];
  const out: (ScrapedReelRow | null)[] = reels.slice(0, 3).map((r) => r);
  while (out.length < 3) out.push(null);
  return out.slice(0, 3);
}

function formatCompactAbs(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}K`;
  return String(Math.round(abs));
}

function formatCompactDeltaSigned(n: number): string {
  if (n === 0) return "0";
  const body = formatCompactAbs(n);
  return n > 0 ? `+${body}` : `−${body}`;
}

function growthDeltaForMetric(
  reel: ScrapedReelRow,
  metric: "views" | "likes" | "comments",
): number | null {
  if (metric === "views") return reel.growth_views != null ? Number(reel.growth_views) : null;
  if (metric === "likes") return reel.growth_likes != null ? Number(reel.growth_likes) : null;
  return reel.growth_comments != null ? Number(reel.growth_comments) : null;
}

function CompactBreakoutRow({
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
        title="Views ÷ this account average (from last competitor sync)"
      >
        {trendingRatio.toFixed(2)}× avg
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

function TopMetricPlaceholderRow() {
  return (
    <div className="flex min-h-[72px] items-center rounded-xl border border-dashed border-zinc-300/60 bg-zinc-50/30 px-3 py-2 dark:border-white/10 dark:bg-white/[0.02]">
      <p className="text-[10px] leading-relaxed text-app-fg-muted">—</p>
    </div>
  );
}

function ActivityLaneBlock({
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

function WeeklyMomentumGrid({
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

const WEEKLY_METRIC_OPTIONS = [
  { value: "comments", label: "Comments growth" },
  { value: "views", label: "Views growth" },
  { value: "likes", label: "Likes growth" },
];

export function WhatHappenedSection({ clientSlug, orgSlug, disabled, disabledHint }: Props) {
  const [data, setData] = useState<ActivityPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>("act");
  const [weeklyMetric, setWeeklyMetric] = useState<"views" | "likes" | "comments">("comments");
  const [hubReel, setHubReel] = useState<ScrapedReelRow | null>(null);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);

  // After any sync (toolbar Sync button), invalidate the 3-min activity cache so the
  // user sees fresh "What happened" data immediately, not stale cached results.
  useEffect(() => {
    const handler = () => setActivityRefreshKey((k) => k + 1);
    window.addEventListener(SYNC_COMPLETED_EVENT, handler);
    return () => window.removeEventListener(SYNC_COMPLETED_EVENT, handler);
  }, []);

  useEffect(() => {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      setLoading(false);
      return;
    }
    const cacheKey = `${orgSlug}:${clientSlug}`;
    const cached = _activityCache.get(cacheKey);
    const now = Date.now();
    // Use cached data if: same refresh key (no manual sync triggered) AND within TTL
    if (
      cached &&
      cached.refreshKey === activityRefreshKey &&
      now - cached.fetchedAt < ACTIVITY_CACHE_TTL_MS
    ) {
      setData(cached.data as ActivityPayload);
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const apiBase = getContentApiBase();
        const headers = await clientApiHeaders({ orgSlug });
        const res = await contentApiFetch(
          `${apiBase}/api/v1/clients/${encodeURIComponent(clientSlug)}/activity`,
          { headers },
        );
        if (!res.ok) {
          const t = await res.text();
          if (!cancelled) setErr(t.slice(0, 200));
          return;
        }
        const json = (await res.json()) as ActivityPayload;
        if (!cancelled) {
          _activityCache.set(cacheKey, { data: json, fetchedAt: Date.now(), refreshKey: activityRefreshKey });
          setData(json);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [clientSlug, orgSlug, disabled, activityRefreshKey]);

  if (disabled || !clientSlug.trim()) return null;

  if (loading) {
    return (
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-app-fg">What happened</h2>
        <div className="glass animate-pulse rounded-xl px-5 py-8 text-xs text-app-fg-muted">Loading…</div>
      </section>
    );
  }

  if (err) {
    return (
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-app-fg">What happened</h2>
        <p className="text-xs text-app-fg-muted">{err}</p>
      </section>
    );
  }

  const wb = data?.week_breakouts;
  const topViews = topThreeSlotsOrdered(normalizeTopList(wb?.top_by_views));
  const topLikes = topThreeSlotsOrdered(normalizeTopList(wb?.top_by_likes));
  const topComments = topThreeSlotsOrdered(normalizeTopList(wb?.top_by_comments));
  const weeklySlots =
    weeklyMetric === "views" ? topViews : weeklyMetric === "likes" ? topLikes : topComments;

  const trendMeta = data?.trending_now?.meta ?? {};
  const trendHours =
    typeof trendMeta.posted_within_hours === "number" ? trendMeta.posted_within_hours : 48;
  const trendFloor =
    typeof trendMeta.min_views_vs_account_avg === "number" ? trendMeta.min_views_vs_account_avg : 0.3;
  const provenMeta = data?.proven_performers?.meta ?? {};
  const provenDays =
    typeof provenMeta.min_post_age_days === "number" ? provenMeta.min_post_age_days : 14;

  const mDays = wb?.maturity_days ?? 7;
  const measDays = wb?.measure_days ?? 7;
  const weeklyMomentumBadge =
    wb?.scope === "growth_7d_post_age" ? `d${mDays + 1}–${mDays + measDays}` : "7d";

  const activeTabMeta = TABS.find((t) => t.id === activeTab)!;

  return (
    <section className="mb-8">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-app-fg">What happened</h2>
      </div>

      {/* Tab bar */}
      <div className="mb-1 flex gap-1 rounded-xl border border-zinc-200/80 bg-zinc-100/60 p-1 dark:border-white/10 dark:bg-white/[0.04]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === tab.id
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-app-fg"
                : "text-app-fg-muted hover:text-app-fg"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <p className="mb-5 text-[11px] leading-relaxed text-app-fg-muted">{activeTabMeta.hint}</p>

      {/* Tab: Hot this week — Replicate + trending lane */}
      {activeTab === "act" ? (
        <div>
          <ReplicateSection
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            disabled={disabled}
            disabledHint={disabledHint}
          />
          {(data?.trending_now?.reels ?? []).length > 0 ? (
            <div className="mt-2 border-t border-zinc-200/50 pt-5 dark:border-white/[0.08]">
              <ActivityLaneBlock
                title="More from the last day"
                subtitle={`Competitor reels posted in the last ${trendHours}h with views at least ${Math.round(trendFloor * 100)}% of that account’s usual reach. Ranked strongest first — open a card for details or recreate.`}
                reels={data?.trending_now?.reels ?? []}
                clientSlug={clientSlug}
                orgSlug={orgSlug}
                lane="trending"
                onOpenReel={setHubReel}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Tab: Long-term winners — proven + weekly momentum */}
      {activeTab === "track" ? (
        <div>
          <ActivityLaneBlock
            title="Still gaining after weeks"
            subtitle={`Top competitor posts at least ${provenDays} days old, ranked by how much they grew after publish. If we don’t have enough history yet, we show the strongest totals in your catalog instead.`}
            reels={data?.proven_performers?.reels ?? []}
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            lane="proven"
            maxReels={5}
            onOpenReel={setHubReel}
          />

          <div className="mt-2 border-t border-zinc-200/50 pt-5 dark:border-white/[0.08]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-app-fg">Weekly momentum</p>
                <p className="text-[11px] text-app-fg-subtle">{formatWindowHint(wb)}</p>
              </div>
              <AppSelect
                label="Growth signal"
                value={weeklyMetric}
                onChange={(v) => setWeeklyMetric(v as "views" | "likes" | "comments")}
                options={WEEKLY_METRIC_OPTIONS}
                dense
                triggerClassName="min-w-[10.5rem] px-2.5 py-1.5 text-xs"
                menuAbove
              />
            </div>
            <p className="mb-4 text-[11px] leading-relaxed text-app-fg-muted">
              Top 3 reels by growth in the selected metric over the last 7 days. Hover a thumbnail for the delta badge.
            </p>
            <WeeklyMomentumGrid
              slots={weeklySlots}
              highlight={weeklyMetric}
              clientSlug={clientSlug}
              orgSlug={orgSlug}
              weeklyMomentumBadge={weeklyMomentumBadge}
              onOpenReel={setHubReel}
            />
          </div>
        </div>
      ) : null}

      {hubReel ? (
        <ActivityReelHubModal
          key={hubReel.id}
          reel={hubReel}
          open
          onClose={() => setHubReel(null)}
          clientSlug={clientSlug}
          orgSlug={orgSlug}
          onAfterAnalyzeJob={() => setActivityRefreshKey((k) => k + 1)}
        />
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/50 pt-3 dark:border-white/[0.08]">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setAnalyzeOpen(true)}
          className="text-xs font-semibold text-app-fg-muted transition-colors hover:text-amber-700 disabled:opacity-50 dark:hover:text-amber-400"
        >
          + Analyze a reel
        </button>
        <Link
          href="/intelligence/reels"
          className="group inline-flex items-center gap-1 text-xs font-semibold text-amber-700 transition-colors hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300"
        >
          View all reels
          <span
            className="text-app-fg-muted transition-transform group-hover:translate-x-0.5 group-hover:text-amber-600 dark:group-hover:text-amber-400"
            aria-hidden
          >
            →
          </span>
        </Link>
      </div>

      <AnalyzeReelModal
        open={analyzeOpen}
        onClose={() => setAnalyzeOpen(false)}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
        disabled={disabled}
        disabledHint={disabledHint}
      />
    </section>
  );
}
