"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Compass, Flame, Loader2, Sparkles } from "lucide-react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import type { ScrapedReelRow } from "@/lib/api";
import {
  fetchDashboardCompetitorWinsClient,
  fetchDashboardFreshNicheClient,
} from "@/lib/api-client";
import { RecreateReelModal } from "@/app/(dashboard)/intelligence/components/recreate-reel-modal";

/**
 * Dashboard "what dropped today" lanes.
 *
 * Two surfaces share this component via thin wrappers below:
 *   - FreshFromNiche — keyword-similarity reels ranked by views
 *   - CompetitorWins — competitor reels beating their account avg
 *
 * Each lane:
 *   - Receives SSR-rendered initial reels (fast first paint)
 *   - Owns a time-range chip (24h / 3d / 1w) that triggers a client-side re-fetch
 *   - Links to /intelligence/reels with filters pre-applied via the footer
 */

type LaneKind = "fresh-niche" | "competitor-wins";

type LaneConfig = {
  kind: LaneKind;
  title: string;
  subtitle: string;
  icon: ReactNode;
  iconBgClass: string;
  emptyCopy: string;
  badgeFor: (reel: ScrapedReelRow) => string | null;
  reelsPageHref: (days: number) => string;
};

type LaneProps = {
  initial: ScrapedReelRow[];
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
  config: LaneConfig;
};

type RangeKey = "1" | "3" | "7";

const RANGE_OPTIONS: ReadonlyArray<{ key: RangeKey; days: number; label: string }> = [
  { key: "1", days: 1, label: "24h" },
  { key: "3", days: 3, label: "3d" },
  { key: "7", days: 7, label: "1w" },
];

const DEFAULT_RANGE: RangeKey = "3";

function titleFor(reel: ScrapedReelRow): string {
  const h = (reel.hook_text || reel.caption || "").trim().replace(/\s+/g, " ");
  if (h.length > 48) return `${h.slice(0, 46)}…`;
  if (h.length > 0) return h;
  return `@${reel.account_username || "creator"} reel`;
}

function formatViews(views: number | null | undefined): string {
  const n = Number(views || 0);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k views`;
  return `${n} views`;
}

function fetchLane(
  kind: LaneKind,
  clientSlug: string,
  orgSlug: string,
  days: number,
) {
  return kind === "fresh-niche"
    ? fetchDashboardFreshNicheClient(clientSlug, orgSlug, days)
    : fetchDashboardCompetitorWinsClient(clientSlug, orgSlug, days);
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function DashboardDailyLane({
  initial,
  clientSlug,
  orgSlug,
  disabled,
  disabledHint,
  config,
}: LaneProps) {
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);
  const [reels, setReels] = useState<ScrapedReelRow[]>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recreateRow, setRecreateRow] = useState<ScrapedReelRow | null>(null);

  // Client-side re-fetch on range change. Skip the initial default range
  // render (initial prop already covers that exact query).
  useEffect(() => {
    if (range === DEFAULT_RANGE) return;
    if (!clientSlug || !orgSlug) return;
    let cancelled = false;
    const days = RANGE_OPTIONS.find((r) => r.key === range)?.days ?? 3;
    setLoading(true);
    setError(null);
    void (async () => {
      const res = await fetchLane(config.kind, clientSlug, orgSlug, days);
      if (cancelled) return;
      if (res.ok) setReels(res.data);
      else setError(res.error);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [range, clientSlug, orgSlug, config.kind]);

  const list = reels;
  const activeDays = RANGE_OPTIONS.find((r) => r.key === range)?.days ?? 3;

  return (
    <>
      <div className="glass glass-strong flex h-full min-h-[260px] flex-col rounded-2xl border border-app-card-border">
        <div className="flex items-center justify-between border-b border-app-divider px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className={`rounded-lg p-1.5 ${config.iconBgClass}`}>{config.icon}</div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-app-fg">{config.title}</h2>
              <p className="line-clamp-2 text-[10px] text-app-fg-muted">{config.subtitle}</p>
            </div>
          </div>
          <Sparkles className="h-4 w-4 shrink-0 text-app-fg-faint" aria-hidden />
        </div>

        <div
          className="flex items-center gap-1 border-b border-app-divider px-3 py-2"
          role="group"
          aria-label="Time range"
        >
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setRange(opt.key)}
              className={
                range === opt.key
                  ? "rounded-full bg-app-accent/15 px-2.5 py-1 text-[10px] font-semibold text-app-accent"
                  : "rounded-full px-2.5 py-1 text-[10px] font-medium text-app-fg-muted hover:bg-app-chip-bg-hover"
              }
            >
              {opt.label}
            </button>
          ))}
          {loading ? (
            <Loader2 className="ml-1 h-3 w-3 animate-spin text-app-fg-muted" aria-hidden />
          ) : null}
        </div>

        {/*
          Body scrolls vertically when more than ~5 rows arrive. max-h caps
          growth so the card stays compact in the dashboard column; flex-1
          still expands the empty/error states to center their copy.
        */}
        <div className="flex flex-1 flex-col overflow-y-auto overscroll-contain max-h-80">
          {error ? (
            <div className="flex flex-1 items-center justify-center px-4 py-6 text-center">
              <p className="text-xs text-app-callout-warning-fg">{error}</p>
            </div>
          ) : list.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-4 py-6 text-center">
              <p className="text-xs text-app-fg-muted">{config.emptyCopy}</p>
            </div>
          ) : (
            <ul className="divide-y divide-app-divider">
              {list.map((reel) => {
                const badge = config.badgeFor(reel);
                return (
                  <li key={reel.id} className="flex items-center gap-2 px-3 py-2.5">
                    <ReelThumbnail
                      src={reel.thumbnail_url}
                      alt=""
                      href={reel.post_url}
                      className="h-11 w-11 shrink-0 rounded-lg"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[10px] font-semibold text-app-fg-muted">
                        @{reel.account_username}
                      </p>
                      <p className="truncate text-xs font-medium text-app-fg">{titleFor(reel)}</p>
                      {badge ? (
                        <p className="mt-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                          {badge}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={disabled}
                      title={disabledHint ?? undefined}
                      onClick={() => setRecreateRow(reel)}
                      className="shrink-0 rounded-md bg-amber-500/15 px-2.5 py-1.5 text-[10px] font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-50"
                    >
                      Recreate
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-app-divider px-4 py-2.5">
          <Link
            href={config.reelsPageHref(activeDays)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-app-accent hover:underline"
          >
            View all
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      </div>

      <RecreateReelModal
        open={Boolean(recreateRow)}
        onClose={() => setRecreateRow(null)}
        reel={recreateRow}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
        disabled={disabled}
        disabledHint={disabledHint}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Lane wrappers — one per concept.
// ---------------------------------------------------------------------------

type WrapperProps = {
  reels: ScrapedReelRow[];
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
};

export function FreshFromNiche({ reels, ...rest }: WrapperProps) {
  return (
    <DashboardDailyLane
      initial={reels}
      {...rest}
      config={{
        kind: "fresh-niche",
        title: "Fresh from your niche",
        subtitle:
          "New reels from random accounts matching your client's style — found via the daily keyword scan",
        icon: <Compass className="h-4 w-4 text-sky-500 dark:text-sky-400" aria-hidden />,
        iconBgClass: "bg-sky-500/15",
        emptyCopy: "No new niche reels in this range. Widen the window or wait for tomorrow's scrape.",
        badgeFor: (reel) => formatViews(reel.views),
        reelsPageHref: (days) =>
          `/intelligence/reels?source=keyword_similarity&posted_after=${encodeURIComponent(
            isoDaysAgo(days),
          )}&sort_by=views&sort_dir=desc`,
      }}
    />
  );
}

export function CompetitorWins({ reels, ...rest }: WrapperProps) {
  return (
    <DashboardDailyLane
      initial={reels}
      {...rest}
      config={{
        kind: "competitor-wins",
        title: "Competitors are blowing up",
        subtitle:
          "Recent reels from tracked competitors scaling past their usual — copy before the curve flattens",
        icon: <Flame className="h-4 w-4 text-rose-500 dark:text-rose-400" aria-hidden />,
        iconBgClass: "bg-rose-500/15",
        emptyCopy: "No competitor breakouts in this range. Tomorrow's daily scrape will pick them up.",
        badgeFor: (reel) => {
          const r = reel.win_ratio;
          if (r == null || !Number.isFinite(Number(r))) return null;
          return `${Number(r).toFixed(1)}× @${reel.account_username || "competitor"}'s usual`;
        },
        reelsPageHref: (days) =>
          `/intelligence/reels?source=profile&posted_after=${encodeURIComponent(
            isoDaysAgo(days),
          )}&sort_by=views&sort_dir=desc`,
      }}
    />
  );
}
