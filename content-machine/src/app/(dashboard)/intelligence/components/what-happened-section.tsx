"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Module-level cache: survives tab switches and re-mounts within the same browser session.
// Cleared only when the user triggers a manual sync (activityRefreshKey increments).
const _activityCache = new Map<string, { data: unknown; fetchedAt: number; refreshKey: number }>();
const ACTIVITY_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes — matches backend TTL

import { clientApiHeaders, contentApiFetch, getContentApiBase } from "@/lib/api-client";
import type { ActivityLanePayload, ScrapedReelRow, WeekBreakoutsPayload } from "@/lib/api";
import { ActivityReelHubModal } from "./activity-reel-hub-modal";
import { AnalyzeReelModal } from "./analyze-reel-modal";
import { IntelligenceOverviewSections } from "./intelligence-overview-sections";
import { SYNC_COMPLETED_EVENT } from "./sync-data-modal";
import { normalizeTopList, topThreeSlotsOrdered } from "./intelligence-momentum-panels";

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

export function WhatHappenedSection({ clientSlug, orgSlug, disabled, disabledHint }: Props) {
  const [data, setData] = useState<ActivityPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const [weeklyMetric, setWeeklyMetric] = useState<"views" | "likes" | "comments">("comments");
  const [hubReel, setHubReel] = useState<ScrapedReelRow | null>(null);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);

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

  return (
    <section className="mb-8">
      <IntelligenceOverviewSections
        clientSlug={clientSlug}
        orgSlug={orgSlug}
        disabled={disabled}
        disabledHint={disabledHint}
        momentum={{
          activityLoading: loading,
          activityErr: err,
          trendingReels: data?.trending_now?.reels ?? [],
          provenReels: data?.proven_performers?.reels ?? [],
          weeklySlots,
          wb,
          weeklyMetric,
          onWeeklyMetricChange: setWeeklyMetric,
          trendHours,
          trendFloor,
          provenDays,
          weeklyMomentumBadge,
          onOpenReelHub: setHubReel,
        }}
      />

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

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/50 pt-3 dark:border-white/[0.08]">
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
