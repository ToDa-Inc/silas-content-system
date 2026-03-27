import Link from "next/link";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import { ReelEngagementInline } from "./components/reel-engagement-inline";
import {
  fetchBaseline,
  fetchClient,
  fetchCompetitors,
  fetchIntelligenceStats,
  fetchOwnReels,
  fetchScrapedReels,
  getCachedServerApiContext,
  type BaselineRow,
  type ScrapedReelRow,
} from "@/lib/api";
import { topicKeywordSuggestionsFromNicheConfig } from "@/lib/niche-keywords";
import { CompetitorsList } from "./components/competitors-list";
import { DiscoverInline } from "./components/discover-inline";
import { IntelligenceToolbar } from "./components/intelligence-toolbar";
import { ReelCardWithAnalysis } from "./components/reel-card-with-analysis";
import { TopicSearchSection } from "./components/topic-search-section";
import { WhatHappenedSection } from "./components/what-happened-section";

function formatClientLabel(slug: string): string {
  if (!slug.trim()) return "";
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const ms = Date.now() - d.getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function topOutlierReels(reels: ScrapedReelRow[]): ScrapedReelRow[] {
  return reels
    .filter((r) => r.is_outlier === true && r.competitor_id)
    .sort((a, b) => (Number(b.outlier_ratio) || 0) - (Number(a.outlier_ratio) || 0))
    .slice(0, 6);
}

function outlierCount(reels: ScrapedReelRow[]): number {
  return reels.filter((r) => r.is_outlier === true && r.competitor_id).length;
}

export default async function IntelligencePage() {
  const { user, tenancy, clientSlug, orgSlug } = await getCachedServerApiContext();

  const [compRes, baseRes, reelsRes, ownReelsRes, clientRes, statsRes] = await Promise.all([
    fetchCompetitors(),
    fetchBaseline(),
    fetchScrapedReels(false, true),
    fetchOwnReels(),
    fetchClient(),
    fetchIntelligenceStats(),
  ]);

  const competitors = compRes.ok ? compRes.data : [];
  const baseline: BaselineRow | null = baseRes.ok ? baseRes.data : null;
  const stats = statsRes.ok ? statsRes.data : null;
  const allReels = reelsRes.ok && Array.isArray(reelsRes.data) ? reelsRes.data : [];
  const outliers = topOutlierReels(allReels);
  const nOutliers = reelsRes.ok ? outlierCount(allReels) : 0;
  const ownReels = ownReelsRes.ok ? ownReelsRes.data : [];
  const topOwn = ownReels.slice(0, 6);

  const suggestedKeywords =
    clientRes.ok && clientRes.data
      ? topicKeywordSuggestionsFromNicheConfig(clientRes.data.niche_config)
      : [];

  const clientLabel = formatClientLabel(clientSlug);
  const syncDisabled = !clientSlug.trim() || !orgSlug.trim();
  const syncDisabledHint =
    user && !tenancy
      ? "No workspace membership visible for this login — see the alert above."
      : !orgSlug.trim()
        ? "Missing organization slug — refresh or check Supabase session."
        : !clientSlug.trim()
          ? "Pick a creator in the top bar or finish onboarding."
          : null;
  const loadError = !compRes.ok || !reelsRes.ok;
  const baselineUpdated = formatRelativeTime(baseline?.scraped_at);

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-8 md:px-8">
      {user && !tenancy ? (
        <div className="glass mb-8 rounded-xl px-5 py-4 text-sm text-app-fg-secondary">
          <p className="font-medium text-app-fg">
            We can&apos;t see a workspace for this login
          </p>
          <p className="mt-1 text-xs text-app-fg-subtle">
            The app did not find an <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">organization_members</code>{" "}
            row for your user (Supabase RLS + session). If you never onboarded here, start below. If you already did,
            confirm this project&apos;s Supabase URL/keys match the project where onboarding ran, and that your user has
            a membership row.
          </p>
          <Link
            href="/onboarding"
            className="mt-3 inline-flex rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-zinc-950"
          >
            Create workspace
          </Link>
        </div>
      ) : null}

      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-app-fg">Intelligence</h1>
          {clientLabel ? (
            <p className="mt-1 text-xs text-app-fg-subtle">{clientLabel}</p>
          ) : null}
        </div>
        <IntelligenceToolbar
          clientSlug={clientSlug}
          orgSlug={orgSlug}
          disabled={syncDisabled}
          disabledHint={syncDisabledHint}
        />
      </header>

      {loadError ? (
        <p className="mb-6 text-sm text-app-fg-muted">
          Some data couldn&apos;t be loaded. Try refreshing in a moment.
        </p>
      ) : null}

      {clientSlug.trim() && orgSlug.trim() ? (
        <WhatHappenedSection clientSlug={clientSlug} orgSlug={orgSlug} disabled={syncDisabled} />
      ) : null}

      <section className="mb-8 flex flex-wrap gap-3">
        <div className="glass rounded-lg px-4 py-2 text-xs text-app-fg-secondary">
          <span className="text-app-fg-subtle">Avg views (last 30 reels) · </span>
          {stats?.average_views_last_30_reels != null
            ? stats.average_views_last_30_reels.toLocaleString()
            : "—"}
        </div>
        <div className="glass rounded-lg px-4 py-2 text-xs text-app-fg-secondary">
          <span className="text-app-fg-subtle">Avg likes (last 30 reels) · </span>
          {stats?.average_likes_last_30_reels != null
            ? stats.average_likes_last_30_reels.toLocaleString()
            : "—"}
        </div>
        <div className="glass rounded-lg px-4 py-2 text-xs text-app-fg-secondary">
          <span className="text-app-fg-subtle">Competitors · </span>
          {compRes.ok ? competitors.length : "—"}
        </div>
        <div className="glass rounded-lg px-4 py-2 text-xs text-app-fg-secondary">
          <span className="text-app-fg-subtle">Breakout reels · </span>
          {reelsRes.ok ? nOutliers : "—"}
        </div>
        <div className="glass rounded-lg px-4 py-2 text-xs text-app-fg-secondary">
          <span className="text-app-fg-subtle">Your reels stored · </span>
          {stats?.total_own_reels != null ? stats.total_own_reels : ownReelsRes.ok ? ownReels.length : "—"}
        </div>
        {baselineUpdated ? (
          <div className="glass rounded-lg px-4 py-2 text-xs text-app-fg-secondary">
            <span className="text-app-fg-subtle">Last synced · </span>
            {baselineUpdated}
          </div>
        ) : null}
      </section>

      <section className="mb-12">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 className="text-sm font-semibold text-app-fg">Your reels</h2>
          <div className="flex flex-wrap items-center gap-2">
            {baselineUpdated ? (
              <span className="text-[11px] text-app-fg-subtle">Last synced {baselineUpdated}</span>
            ) : null}
            <span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-700 dark:bg-white/12 dark:text-app-fg-muted">
              {ownReelsRes.ok ? ownReels.length : "—"}
            </span>
          </div>
        </div>
        {!ownReelsRes.ok ? (
          <p className="text-xs text-app-fg-subtle">
            Couldn&apos;t load your reels. Use <strong>Update data</strong> in the toolbar.
          </p>
        ) : topOwn.length === 0 ? (
          <p className="text-sm text-app-fg-muted">
            No reels stored yet. Use <strong>Update data</strong> in the toolbar to pull your latest reels
            from Instagram.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {topOwn.map((row) => (
              <ReelCardWithAnalysis
                key={row.id}
                row={row}
                clientSlug={clientSlug}
                orgSlug={orgSlug}
              >
                <ReelThumbnail
                  src={row.thumbnail_url}
                  alt={`@${row.account_username} reel`}
                  href={row.post_url}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-zinc-900 dark:text-app-fg">
                    @{row.account_username}
                  </p>
                  <ReelEngagementInline className="mt-1" views={row.views} likes={row.likes} comments={row.comments} />
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-app-fg-muted">
                    {row.hook_text || row.caption || "—"}
                  </p>
                  {row.post_url ? (
                    <a
                      href={row.post_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-[10px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
                    >
                      Open ↗
                    </a>
                  ) : null}
                </div>
              </ReelCardWithAnalysis>
            ))}
          </div>
        )}
      </section>

      <section className="mb-12">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-app-fg">Competitors</h2>
          <span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-700 dark:bg-white/12 dark:text-app-fg-muted">
            {compRes.ok ? competitors.length : "—"}
          </span>
        </div>
        {clientSlug.trim() && orgSlug.trim() ? (
          <div className="mb-4">
            <DiscoverInline
              clientSlug={clientSlug}
              orgSlug={orgSlug}
              disabled={syncDisabled}
              disabledHint={syncDisabledHint}
            />
          </div>
        ) : null}
        {!compRes.ok ? (
          <div className="glass rounded-xl px-6 py-10 text-center text-sm text-app-fg-muted">
            Couldn&apos;t load competitors. Try again in a moment.
          </div>
        ) : (
          <CompetitorsList
            competitors={competitors}
            baseline={baseline}
            scrapedReels={allReels}
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            syncDisabled={syncDisabled}
          />
        )}
      </section>

      {clientSlug.trim() && orgSlug.trim() ? (
        <TopicSearchSection
          clientSlug={clientSlug}
          orgSlug={orgSlug}
          suggestedKeywords={suggestedKeywords}
          disabled={syncDisabled}
        />
      ) : null}

      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-app-fg">Competitor breakouts</h2>
          <Link
            href="/intelligence/reels?outliers=1"
            className="text-xs font-medium text-amber-400 hover:underline sm:whitespace-nowrap"
          >
            All breakouts →
          </Link>
        </div>

        {outliers.length === 0 ? (
          <div className="glass rounded-xl px-6 py-10 text-center">
            <p className="text-sm text-app-fg-muted">
              No breakout reels yet. Add competitors and sync — a breakout is when a reel clearly beats that
              account&apos;s usual performance (your threshold in settings). Use <strong>Sync all</strong> or{" "}
              <strong>Sync reels</strong> on a competitor row (or use <strong>Sync all</strong>).
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {outliers.map((row) => (
              <ReelCardWithAnalysis
                key={row.id}
                row={row}
                clientSlug={clientSlug}
                orgSlug={orgSlug}
              >
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
                  <p className="text-xs font-semibold text-zinc-900 dark:text-app-fg">
                    @{row.account_username}
                  </p>
                  <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                    {row.outlier_ratio != null
                      ? `${Number(row.outlier_ratio).toFixed(1)}× their usual performance`
                      : "—"}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-app-fg-muted">
                    {row.hook_text || row.caption || "—"}
                  </p>
                  <ReelEngagementInline className="mt-2" views={row.views} likes={row.likes} comments={row.comments} />
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
                  </div>
                </div>
              </ReelCardWithAnalysis>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
