"use client";

import Link from "next/link";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Loader2, Sparkles, UserPlus } from "lucide-react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import type { ScrapedReelRow, WeekBreakoutsPayload } from "@/lib/api";
import {
  fetchClientRowClient,
  fetchDashboardFreshNicheClient,
  fetchOwnReelsClient,
  fetchReelsListClient,
} from "@/lib/api-client";
import { cn } from "@/lib/cn";
import {
  formatNicheMatchPercent,
  getReelProvenance,
  NICHE_SIMILARITY_SCORE_TOOLTIP,
} from "@/lib/reel-provenance";
import { Tooltip } from "@/components/ui/tooltip";
import { AppSelect } from "@/components/ui/app-select";
import { ReplicateSection } from "./replicate-section";
import { ReelCardWithAnalysis } from "./reel-card-with-analysis";
import { RecreateReelModal } from "./recreate-reel-modal";
import {
  ActivityLaneBlock,
  formatWindowHint,
  WeeklyMomentumGrid,
  WEEKLY_METRIC_OPTIONS,
} from "./intelligence-momentum-panels";

export type HomeOverviewTab = "today" | "yours" | "niche" | "hot" | "steady" | "saved";

export type IntelligenceOverviewMomentumProps = {
  activityLoading: boolean;
  activityErr: string | null;
  trendingReels: ScrapedReelRow[];
  provenReels: ScrapedReelRow[];
  weeklySlots: (ScrapedReelRow | null)[];
  wb: WeekBreakoutsPayload | undefined;
  weeklyMetric: "views" | "likes" | "comments";
  onWeeklyMetricChange: (m: "views" | "likes" | "comments") => void;
  trendHours: number;
  trendFloor: number;
  provenDays: number;
  weeklyMomentumBadge: string;
  onOpenReelHub: (reel: ScrapedReelRow) => void;
};

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
  momentum: IntelligenceOverviewMomentumProps;
};

/** `group` steps in display order — dividers between groups (hierarchy: act → your channel → market → library). */
const HOME_TABS: {
  id: HomeOverviewTab;
  label: string;
  hint: string;
  group: number;
}[] = [
  {
    id: "today",
    label: "Adapt today",
    group: 1,
    hint: "Fresh posts from tracked competitors that are beating their usual reach — strong candidates to adapt first.",
  },
  {
    id: "yours",
    label: "Your reels",
    group: 2,
    hint: "Reels from this creator’s connected Instagram only (baseline sync — source client_baseline, matching handle).",
  },
  {
    id: "niche",
    label: "Niche finds",
    group: 3,
    hint: "Accounts surfaced by your daily keyword scan — possible leads until you add them as competitors.",
  },
  {
    id: "hot",
    label: "Hot now",
    group: 3,
    hint: "Competitor reels from roughly the last day or two that are already outpacing that account’s usual reach.",
  },
  {
    id: "steady",
    label: "Still winning",
    group: 3,
    hint: "Older competitor posts that kept gaining, plus weekly momentum in your synced catalog.",
  },
  {
    id: "saved",
    label: "Saved",
    group: 4,
    hint: "URLs you pasted or analyzed manually — your library for scripts and remakes.",
  },
];

function ProvenanceChip({ row }: { row: ScrapedReelRow }) {
  const p = getReelProvenance(row);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <span className="rounded-md bg-zinc-200/90 px-1.5 py-px text-[9px] font-semibold text-zinc-800 dark:bg-white/12 dark:text-app-fg-muted">
        {p.sourceLabel}
      </span>
      <span className="text-[9px] leading-tight text-app-fg-muted">{p.reason}</span>
    </div>
  );
}

export function IntelligenceOverviewSections({
  clientSlug,
  orgSlug,
  disabled,
  disabledHint,
  momentum,
}: Props) {
  const [tab, setTab] = useState<HomeOverviewTab>("today");
  const [niche, setNiche] = useState<ScrapedReelRow[]>([]);
  const [own, setOwn] = useState<ScrapedReelRow[]>([]);
  const [saved, setSaved] = useState<ScrapedReelRow[]>([]);
  const [loadingNiche, setLoadingNiche] = useState(true);
  const [loadingOwn, setLoadingOwn] = useState(true);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [errNiche, setErrNiche] = useState<string | null>(null);
  const [modalReel, setModalReel] = useState<ScrapedReelRow | null>(null);
  const [creatorInstagram, setCreatorInstagram] = useState<string | null>(null);

  const canFetch = Boolean(!disabled && clientSlug.trim() && orgSlug.trim());
  const activeHint = HOME_TABS.find((t) => t.id === tab)?.hint ?? "";

  useEffect(() => {
    if (!canFetch) {
      setLoadingNiche(false);
      setLoadingOwn(false);
      setLoadingSaved(false);
      return;
    }
    let cancelled = false;
    setLoadingNiche(true);
    setErrNiche(null);
    void fetchDashboardFreshNicheClient(clientSlug, orgSlug, 5, 8).then((res) => {
      if (cancelled) return;
      setLoadingNiche(false);
      if (res.ok) setNiche(res.data.slice(0, 8));
      else setErrNiche(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [canFetch, clientSlug, orgSlug]);

  useEffect(() => {
    if (!canFetch) {
      setLoadingOwn(false);
      return;
    }
    let cancelled = false;
    setLoadingOwn(true);
    void fetchOwnReelsClient(clientSlug, orgSlug, 12).then((res) => {
      if (cancelled) return;
      setLoadingOwn(false);
      if (res.ok) setOwn(res.data.slice(0, 8));
      else setOwn([]);
    });
    return () => {
      cancelled = true;
    };
  }, [canFetch, clientSlug, orgSlug]);

  useEffect(() => {
    if (!canFetch) {
      setLoadingSaved(false);
      return;
    }
    let cancelled = false;
    setLoadingSaved(true);
    void fetchReelsListClient(clientSlug, orgSlug, {
      source: "url_paste",
      limit: 12,
      sortBy: "posted_at",
      sortDir: "desc",
      includeAnalysis: true,
    }).then((res) => {
      if (cancelled) return;
      setLoadingSaved(false);
      if (res.ok) setSaved(res.data.slice(0, 8));
      else setSaved([]);
    });
    return () => {
      cancelled = true;
    };
  }, [canFetch, clientSlug, orgSlug]);

  useEffect(() => {
    if (!canFetch) {
      setCreatorInstagram(null);
      return;
    }
    let cancelled = false;
    void fetchClientRowClient(clientSlug, orgSlug).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        const h = (res.data.instagram_handle ?? "").replace("@", "").trim();
        setCreatorInstagram(h || null);
      } else {
        setCreatorInstagram(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [canFetch, clientSlug, orgSlug]);

  const panelToday = (
    <div>
      <ReplicateSection
        clientSlug={clientSlug}
        orgSlug={orgSlug}
        disabled={disabled}
        disabledHint={disabledHint}
      />
    </div>
  );

  const panelNiche = (
    <>
      {loadingNiche ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-app-fg-subtle" />
        </div>
      ) : errNiche ? (
        <p className="text-xs text-red-400/90">{errNiche}</p>
      ) : niche.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300/60 px-4 py-6 text-center text-xs text-app-fg-muted dark:border-white/10">
          No niche matches yet. Tomorrow&apos;s keyword run may surface new accounts.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {niche.map((reel) => {
            const match = formatNicheMatchPercent(reel.similarity_score ?? null);
            return (
              <ReelCardWithAnalysis key={reel.id} row={reel} clientSlug={clientSlug} orgSlug={orgSlug} compact>
                <div className="group/thumb relative shrink-0 overflow-hidden rounded">
                  <ReelThumbnail
                    src={reel.thumbnail_url}
                    alt={`@${reel.account_username} reel`}
                    href={reel.post_url}
                    size="sm"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold leading-tight text-app-fg">@{reel.account_username}</p>
                  <ProvenanceChip row={reel} />
                  <p className="mt-0.5 line-clamp-2 text-[10px] text-app-fg-muted">
                    {reel.hook_text || reel.caption || "—"}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {match ? (
                      <Tooltip content={NICHE_SIMILARITY_SCORE_TOOLTIP} side="top">
                        <span className="inline-flex cursor-help rounded-md bg-purple-500/15 px-1.5 py-0.5 text-[9px] font-bold text-purple-700 dark:text-purple-300">
                          {match}
                        </span>
                      </Tooltip>
                    ) : null}
                    <Link
                      href="/intelligence/competitors"
                      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-semibold text-sky-700 hover:bg-sky-500/10 dark:text-sky-400"
                    >
                      <UserPlus className="h-2.5 w-2.5" aria-hidden />
                      Add as competitor
                    </Link>
                  </div>
                </div>
              </ReelCardWithAnalysis>
            );
          })}
        </div>
      )}
      <div className="mt-2 text-right">
        <Link
          href="/intelligence/reels?source=keyword_similarity"
          className="text-[11px] font-semibold text-amber-700 hover:underline dark:text-amber-400"
        >
          All niche finds →
        </Link>
      </div>
    </>
  );

  const panelYours = (
    <>
      <p className="mb-3 text-[11px] leading-relaxed text-app-fg-muted">
        {creatorInstagram ? (
          <>
            Baseline reels for{" "}
            <strong className="font-semibold text-app-fg-secondary">@{creatorInstagram}</strong> (this
            creator&apos;s Instagram on file). Pulled from sync only — not keyword discovery or pasted links.
          </>
        ) : (
          <>
            Baseline reels use the Instagram handle saved on this creator.{" "}
            <strong className="text-app-fg-secondary">Add a handle</strong> in client settings, then sync, to pull
            your reels.
          </>
        )}
      </p>
      {loadingOwn ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-app-fg-subtle" />
        </div>
      ) : own.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300/60 px-4 py-6 text-center text-xs text-app-fg-muted dark:border-white/10">
          {creatorInstagram ? (
            <>
              No baseline reels stored yet for <strong className="text-app-fg-secondary">@{creatorInstagram}</strong>.
              Use <strong>Sync</strong> in the header so the worker can scrape your profile reels.
            </>
          ) : (
            <>
              No baseline reels yet — set this creator&apos;s Instagram handle and run <strong>Sync</strong> so we can
              store reels from that account only.
            </>
          )}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {own.map((reel) => {
            const gv = reel.growth_views != null ? Number(reel.growth_views) : null;
            const badge =
              gv != null && gv > 0
                ? `+${gv >= 1000 ? `${(gv / 1000).toFixed(1)}K` : Math.round(gv)} views since last snapshot`
                : null;
            return (
              <ReelCardWithAnalysis key={reel.id} row={reel} clientSlug={clientSlug} orgSlug={orgSlug} compact>
                <div className="group/thumb relative shrink-0 overflow-hidden rounded">
                  <ReelThumbnail
                    src={reel.thumbnail_url}
                    alt={`@${reel.account_username} reel`}
                    href={reel.post_url}
                    size="sm"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold leading-tight text-app-fg">@{reel.account_username}</p>
                  <ProvenanceChip row={reel} />
                  <p className="mt-0.5 line-clamp-2 text-[10px] text-app-fg-muted">
                    {reel.hook_text || reel.caption || "—"}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {badge ? (
                      <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-800 dark:text-emerald-300">
                        {badge}
                      </span>
                    ) : (
                      <span className="text-[9px] text-app-fg-muted">Synced from Instagram</span>
                    )}
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setModalReel(reel)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-semibold text-amber-700 hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-400"
                    >
                      <Sparkles className="h-2.5 w-2.5" aria-hidden />
                      Analyze what worked
                    </button>
                  </div>
                </div>
              </ReelCardWithAnalysis>
            );
          })}
        </div>
      )}
      <div className="mt-2 text-right">
        <Link
          href="/intelligence/reels?own=1"
          className="text-[11px] font-semibold text-amber-700 hover:underline dark:text-amber-400"
        >
          All your reels →
        </Link>
      </div>
    </>
  );

  const panelSaved = (
    <>
      {loadingSaved ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-app-fg-subtle" />
        </div>
      ) : saved.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300/60 px-4 py-6 text-center text-xs text-app-fg-muted dark:border-white/10">
          Nothing saved yet. Paste a reel URL from{" "}
          <Link href="/generate" className="font-semibold text-amber-700 hover:underline dark:text-amber-400">
            Generate
          </Link>{" "}
          or run <strong>Analyze a reel</strong> below.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {saved.map((reel) => (
            <ReelCardWithAnalysis key={reel.id} row={reel} clientSlug={clientSlug} orgSlug={orgSlug} compact>
              <div className="group/thumb relative shrink-0 overflow-hidden rounded">
                <ReelThumbnail
                  src={reel.thumbnail_url}
                  alt={`@${reel.account_username} reel`}
                  href={reel.post_url}
                  size="sm"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold leading-tight text-app-fg">@{reel.account_username}</p>
                <ProvenanceChip row={reel} />
                <p className="mt-0.5 line-clamp-2 text-[10px] text-app-fg-muted">
                  {reel.hook_text || reel.caption || "—"}
                </p>
                <div className="mt-1.5">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setModalReel(reel)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-semibold text-amber-700 hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-400"
                  >
                    <Sparkles className="h-2.5 w-2.5" aria-hidden />
                    Open / recreate
                  </button>
                </div>
              </div>
            </ReelCardWithAnalysis>
          ))}
        </div>
      )}
      <div className="mt-2 text-right">
        <Link
          href="/intelligence/reels?source=url_paste"
          className="text-[11px] font-semibold text-amber-700 hover:underline dark:text-amber-400"
        >
          All saved analyses →
        </Link>
      </div>
    </>
  );

  const panelHot = (
    <>
      {momentum.activityLoading ? (
        <div className="glass animate-pulse rounded-xl px-5 py-8 text-xs text-app-fg-muted">Loading…</div>
      ) : momentum.activityErr ? (
        <p className="text-xs text-app-fg-muted">{momentum.activityErr}</p>
      ) : momentum.trendingReels.length > 0 ? (
        <ActivityLaneBlock
          title="Trending now"
          subtitle={`Competitor reels posted in about the last ${momentum.trendHours}h with views at least ${Math.round(momentum.trendFloor * 100)}% of that account’s usual reach. Ranked strongest first.`}
          reels={momentum.trendingReels}
          clientSlug={clientSlug}
          orgSlug={orgSlug}
          lane="trending"
          onOpenReel={momentum.onOpenReelHub}
        />
      ) : (
        <p className="rounded-xl border border-dashed border-zinc-300/60 px-4 py-8 text-center text-xs text-app-fg-muted dark:border-white/10">
          No extra trending lane yet — run a sync, or use <strong>Adapt today</strong> for fresh competitor breakouts.
        </p>
      )}
    </>
  );

  const panelSteady = (
    <>
      {momentum.activityLoading ? (
        <div className="glass animate-pulse rounded-xl px-5 py-8 text-xs text-app-fg-muted">Loading…</div>
      ) : momentum.activityErr ? (
        <p className="text-xs text-app-fg-muted">{momentum.activityErr}</p>
      ) : (
        <>
          <ActivityLaneBlock
            title="Still gaining after weeks"
            subtitle={`Top competitor posts at least ${momentum.provenDays} days old, ranked by growth after publish. If history is thin, we fall back to strongest totals in your catalog.`}
            reels={momentum.provenReels}
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            lane="proven"
            maxReels={5}
            onOpenReel={momentum.onOpenReelHub}
          />
          <div className="mt-6 border-t border-zinc-200/50 pt-5 dark:border-white/[0.08]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-app-fg">Weekly momentum</p>
                <p className="text-[11px] text-app-fg-subtle">{formatWindowHint(momentum.wb)}</p>
              </div>
              <AppSelect
                label="Growth signal"
                value={momentum.weeklyMetric}
                onChange={(v) => momentum.onWeeklyMetricChange(v as "views" | "likes" | "comments")}
                options={WEEKLY_METRIC_OPTIONS}
                dense
                triggerClassName="min-w-[10.5rem] px-2.5 py-1.5 text-xs"
                menuAbove
              />
            </div>
            <p className="mb-4 text-[11px] leading-relaxed text-app-fg-muted">
              Top 3 reels by growth in the selected metric. Hover a thumbnail for the delta badge.
            </p>
            <WeeklyMomentumGrid
              slots={momentum.weeklySlots}
              clientSlug={clientSlug}
              orgSlug={orgSlug}
              highlight={momentum.weeklyMetric}
              weeklyMomentumBadge={momentum.weeklyMomentumBadge}
              onOpenReel={momentum.onOpenReelHub}
            />
          </div>
        </>
      )}
    </>
  );

  let body: ReactNode = null;
  switch (tab) {
    case "today":
      body = panelToday;
      break;
    case "niche":
      body = panelNiche;
      break;
    case "yours":
      body = panelYours;
      break;
    case "hot":
      body = panelHot;
      break;
    case "steady":
      body = panelSteady;
      break;
    case "saved":
      body = panelSaved;
      break;
    default:
      body = null;
  }

  return (
    <div className="mb-8">
      <header
        className="relative left-1/2 z-[1] mb-5 w-screen max-w-[100vw] -translate-x-1/2 border-b border-zinc-200/90 bg-zinc-50/95 shadow-sm backdrop-blur-md dark:border-white/[0.08] dark:bg-zinc-950/95"
        role="banner"
      >
        <div className="mx-auto max-w-[1100px] px-4 pb-3 pt-3 md:px-8">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-app-fg-muted">
            Intelligence
          </p>
          <nav
            className="flex w-full min-w-0 flex-wrap items-stretch gap-y-2 sm:flex-nowrap"
            aria-label="Intelligence sections"
            role="tablist"
          >
            {HOME_TABS.map((t, i) => {
              const prev = i > 0 ? HOME_TABS[i - 1] : null;
              const showDivider = prev != null && t.group !== prev.group;
              const selected = tab === t.id;
              return (
                <Fragment key={t.id}>
                  {showDivider ? (
                    <div
                      className="mx-0.5 hidden h-8 w-px shrink-0 self-center bg-zinc-300/90 dark:bg-white/15 sm:block"
                      aria-hidden
                    />
                  ) : null}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    id={`intel-tab-${t.id}`}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "min-h-[2.5rem] min-w-0 flex-1 basis-[calc(50%-0.25rem)] rounded-lg px-2 py-2 text-center text-[11px] font-semibold leading-tight transition-colors sm:basis-0 sm:px-3 sm:text-xs",
                      selected
                        ? "bg-amber-500/20 text-amber-950 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.35)] ring-2 ring-amber-500/30 dark:bg-amber-500/15 dark:text-amber-50 dark:shadow-[inset_0_0_0_1px_rgba(251,191,36,0.25)] dark:ring-amber-400/25"
                        : "text-app-fg-muted hover:bg-zinc-200/80 hover:text-app-fg dark:hover:bg-white/[0.06]",
                    )}
                  >
                    <span className="block truncate">{t.label}</span>
                  </button>
                </Fragment>
              );
            })}
          </nav>
          <p
            className="mt-3 border-t border-zinc-200/60 pt-3 text-[11px] leading-relaxed text-app-fg-muted dark:border-white/[0.06]"
            role="tabpanel"
            id={`intel-tabpanel-${tab}`}
            aria-labelledby={`intel-tab-${tab}`}
          >
            {activeHint}
          </p>
        </div>
      </header>

      <div className="min-h-[120px]">{body}</div>

      <RecreateReelModal
        open={modalReel != null}
        onClose={() => setModalReel(null)}
        reel={modalReel}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
        disabled={disabled}
        disabledHint={disabledHint}
      />
    </div>
  );
}
