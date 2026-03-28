"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clientApiHeaders, contentApiFetch, getContentApiBase } from "@/lib/api-client";
import type { ScrapedReelRow, WeekBreakoutsPayload } from "@/lib/api";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import { ReelCardWithAnalysis } from "./reel-card-with-analysis";
import { ReelEngagementInline } from "./reel-engagement-inline";
import { SectionSyncButton } from "./section-sync-button";

type OwnReelGrowth = {
  reel_id: string;
  views_gained: number;
  views_now: number;
  post_url?: string | null;
  thumbnail_url?: string | null;
  hook_text?: string | null;
  caption?: string | null;
  account_username?: string | null;
  likes?: number | null;
  comments?: number | null;
};

type ActivityPayload = {
  since: string;
  new_breakout_reels: ScrapedReelRow[];
  week_breakouts?: WeekBreakoutsPayload;
  own_reel_growth: OwnReelGrowth[];
  is_quiet: boolean;
};

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
};

function formatWindowHint(wb: WeekBreakoutsPayload | undefined): string {
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

/** API may return arrays (new) or a single reel (legacy). */
function normalizeTopList(raw: unknown): ScrapedReelRow[] {
  if (Array.isArray(raw)) return raw as ScrapedReelRow[];
  if (raw && typeof raw === "object") return [raw as ScrapedReelRow];
  return [];
}

function breakoutRatioForColumn(
  reel: ScrapedReelRow,
  highlight: "views" | "likes" | "comments",
): number | null {
  if (highlight === "views") {
    const v = reel.outlier_views_ratio ?? reel.outlier_ratio;
    return v != null ? Number(v) : null;
  }
  if (highlight === "likes") {
    return reel.outlier_likes_ratio != null ? Number(reel.outlier_likes_ratio) : null;
  }
  return reel.outlier_comments_ratio != null ? Number(reel.outlier_comments_ratio) : null;
}

function CompactBreakoutRow({
  reel,
  clientSlug,
  orgSlug,
  highlight,
}: {
  reel: ScrapedReelRow;
  clientSlug: string;
  orgSlug: string;
  highlight: "views" | "likes" | "comments";
}) {
  const hv = highlight === "views";
  const hl = highlight === "likes";
  const hc = highlight === "comments";
  const colRatio = breakoutRatioForColumn(reel, highlight);
  const ratioLabel =
    highlight === "views" ? "views" : highlight === "likes" ? "likes" : "comments";

  return (
    <ReelCardWithAnalysis row={reel} clientSlug={clientSlug} orgSlug={orgSlug} compact>
      <div className="relative shrink-0">
        <ReelThumbnail
          src={reel.thumbnail_url}
          alt={`@${reel.account_username} reel`}
          href={reel.post_url}
          size="sm"
        />
        {colRatio != null ? (
          <span
            className="absolute -right-0.5 -top-0.5 max-w-[4.5rem] rounded bg-amber-500 px-0.5 py-px text-[6px] font-bold leading-tight text-zinc-950 shadow"
            title={`${colRatio.toFixed(1)}× vs their avg ${ratioLabel}`}
          >
            {colRatio.toFixed(1)}× {ratioLabel}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold leading-tight text-app-fg">@{reel.account_username}</p>
        <p className="mt-0.5 line-clamp-1 text-[10px] text-app-fg-muted">{reel.hook_text || reel.caption || "—"}</p>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0 text-[9px] tabular-nums text-app-fg-subtle">
          <span className={hv ? "font-semibold text-amber-600 dark:text-amber-400" : ""}>
            {reel.views != null ? `${Number(reel.views).toLocaleString()} views` : "—"}
          </span>
          <span className={hl ? "font-semibold text-amber-600 dark:text-amber-400" : ""}>
            {reel.likes != null ? `${Number(reel.likes).toLocaleString()} likes` : "—"}
          </span>
          <span className={hc ? "font-semibold text-amber-600 dark:text-amber-400" : ""}>
            {reel.comments != null ? `${Number(reel.comments).toLocaleString()} comments` : "—"}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          {reel.competitor_id ? (
            <Link
              href={`/intelligence/reels?competitor=${encodeURIComponent(reel.competitor_id)}`}
              className="text-[9px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
            >
              More →
            </Link>
          ) : null}
          {reel.post_url ? (
            <a
              href={reel.post_url}
              target="_blank"
              rel="noreferrer"
              className="text-[9px] font-semibold text-app-fg-muted hover:underline"
            >
              IG ↗
            </a>
          ) : null}
        </div>
      </div>
    </ReelCardWithAnalysis>
  );
}

function WeeklyBreakoutColumn({
  title,
  reels,
  clientSlug,
  orgSlug,
  highlight,
}: {
  title: string;
  reels: ScrapedReelRow[];
  clientSlug: string;
  orgSlug: string;
  highlight: "views" | "likes" | "comments";
}) {
  if (!reels.length) {
    return (
      <div className="flex min-h-[120px] flex-col rounded-xl border border-dashed border-zinc-300/80 bg-zinc-50/50 p-3 dark:border-white/15 dark:bg-white/[0.02]">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-app-fg-subtle">{title}</p>
        <p className="mt-2 flex-1 text-xs leading-relaxed text-app-fg-muted">
          No breakout in this window. Sync competitors to refresh.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-app-fg-subtle">{title}</p>
      <div className="flex flex-col gap-2">
        {reels.map((reel) => (
          <CompactBreakoutRow
            key={reel.id}
            reel={reel}
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            highlight={highlight}
          />
        ))}
      </div>
    </div>
  );
}

export function WhatHappenedSection({ clientSlug, orgSlug, disabled, disabledHint }: Props) {
  const [data, setData] = useState<ActivityPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
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
        const res = await contentApiFetch(`${apiBase}/api/v1/clients/${clientSlug}/activity`, {
          headers,
        });
        if (!res.ok) {
          const t = await res.text();
          if (!cancelled) setErr(t.slice(0, 200));
          return;
        }
        const json = (await res.json()) as ActivityPayload;
        if (!cancelled) setData(json);
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
  }, [clientSlug, orgSlug, disabled]);

  if (disabled || !clientSlug.trim()) {
    return null;
  }

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
  const topViews = normalizeTopList(wb?.top_by_views);
  const topLikes = normalizeTopList(wb?.top_by_likes);
  const topComments = normalizeTopList(wb?.top_by_comments);

  const quietGrowth = !(data?.own_reel_growth?.length ?? 0);

  return (
    <section className="mb-8">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-app-fg">What happened</h2>
        <SectionSyncButton
          mode="both"
          clientSlug={clientSlug}
          orgSlug={orgSlug}
          disabled={disabled}
          disabledHint={disabledHint}
        />
      </div>
      <p className="mb-1 text-[11px] text-app-fg-subtle">{formatWindowHint(wb)}</p>
      <p className="mb-4 text-[11px] leading-relaxed text-app-fg-muted">
        Top 3 competitor breakouts per type (views / likes / comments vs that account&apos;s average). Sync to refresh
        numbers.
      </p>

      <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
        <WeeklyBreakoutColumn
          title="Most views"
          reels={topViews}
          highlight="views"
          clientSlug={clientSlug}
          orgSlug={orgSlug}
        />
        <WeeklyBreakoutColumn
          title="Most likes"
          reels={topLikes}
          highlight="likes"
          clientSlug={clientSlug}
          orgSlug={orgSlug}
        />
        <WeeklyBreakoutColumn
          title="Most comments"
          reels={topComments}
          highlight="comments"
          clientSlug={clientSlug}
          orgSlug={orgSlug}
        />
      </div>

      {!quietGrowth ? (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-app-fg-subtle">
            Your reels gaining traction
          </p>
          <p className="mb-3 text-[11px] text-app-fg-muted">View growth on your reels since you last opened the app.</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {data!.own_reel_growth!.map((g) => (
              <div
                key={g.reel_id}
                className="flex gap-3 rounded-xl border border-zinc-200/90 bg-zinc-50/95 p-3 dark:border-white/10 dark:bg-zinc-950/75"
              >
                <ReelThumbnail src={g.thumbnail_url} alt="Your reel" href={g.post_url} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    +{g.views_gained.toLocaleString()} views since last visit
                  </p>
                  <p className="mt-0.5 text-[10px] text-app-fg-subtle">{g.views_now.toLocaleString()} views now</p>
                  <p className="mt-1 line-clamp-2 text-xs text-app-fg-muted">{g.hook_text || g.caption || "—"}</p>
                  <ReelEngagementInline className="mt-2" views={g.views_now} likes={g.likes} comments={g.comments} />
                  {g.post_url ? (
                    <a
                      href={g.post_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-[10px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
                    >
                      Open ↗
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
