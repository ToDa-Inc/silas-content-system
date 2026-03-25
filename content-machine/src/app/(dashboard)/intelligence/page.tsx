import Link from "next/link";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import {
  fetchBaseline,
  fetchCompetitors,
  fetchOwnReels,
  fetchScrapedReels,
  getCachedServerApiContext,
  type BaselineRow,
  type ScrapedReelRow,
} from "@/lib/api";
import { AddUrlInput } from "./components/add-url-input";
import { AutoProfileButton } from "./components/auto-profile-button";
import { BaselineButton } from "./components/baseline-button";
import { CompetitorsList } from "./components/competitors-list";
import { AddCompetitorButton } from "./components/add-competitor-button";
import { DiscoverButton } from "./components/discover-button";
import { ScrapeReelsButton } from "./components/scrape-reels-button";

function formatClientLabel(slug: string): string {
  if (!slug.trim()) return "";
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
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

  const [compRes, baseRes, reelsRes, ownReelsRes] = await Promise.all([
    fetchCompetitors(),
    fetchBaseline(),
    fetchScrapedReels(false),
    fetchOwnReels(),
  ]);

  const competitors = compRes.ok ? compRes.data : [];
  const baseline: BaselineRow | null = baseRes.ok ? baseRes.data : null;
  const allReels = reelsRes.ok ? reelsRes.data : [];
  const outliers = topOutlierReels(allReels);
  const nOutliers = reelsRes.ok ? outlierCount(allReels) : 0;
  const ownReels = ownReelsRes.ok ? ownReelsRes.data : [];
  const topOwn = ownReels.slice(0, 6);

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
  const loadError = !compRes.ok || !baseRes.ok || !reelsRes.ok;

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

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-app-fg">Intelligence</h1>
          {clientLabel ? (
            <p className="mt-1 text-xs text-app-fg-subtle">{clientLabel}</p>
          ) : null}
        </div>
        <div className="flex max-w-full flex-col gap-4 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-6">
          <BaselineButton
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            disabled={syncDisabled}
            disabledHint={syncDisabledHint}
          />
          <AutoProfileButton
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            disabled={syncDisabled}
            disabledHint={syncDisabledHint}
          />
          <AddCompetitorButton
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            disabled={syncDisabled}
            disabledHint={syncDisabledHint}
          />
          <DiscoverButton
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            disabled={syncDisabled}
            disabledHint={syncDisabledHint}
          />
          <ScrapeReelsButton
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            disabled={syncDisabled}
            disabledHint={syncDisabledHint}
            hasCompetitors={competitors.length > 0}
          />
        </div>
      </header>

      {loadError ? (
        <p className="mb-6 text-sm text-app-fg-muted">
          Some data couldn&apos;t be loaded. Try the actions again in a moment.
        </p>
      ) : null}

      <section className="mb-10 flex flex-wrap gap-3">
        <div className="glass rounded-lg px-4 py-2 text-xs text-app-fg-secondary">
          <span className="text-app-fg-subtle">Baseline · </span>
          {!baseRes.ok
            ? "—"
            : baseline?.median_views != null
              ? `${baseline.median_views.toLocaleString()} median views`
              : "Not set"}
        </div>
        <div className="glass rounded-lg px-4 py-2 text-xs text-app-fg-secondary">
          <span className="text-app-fg-subtle">Competitors · </span>
          {compRes.ok ? competitors.length : "—"}
        </div>
        <div className="glass rounded-lg px-4 py-2 text-xs text-app-fg-secondary">
          <span className="text-app-fg-subtle">Outliers · </span>
          {reelsRes.ok ? nOutliers : "—"}
        </div>
        <div className="glass rounded-lg px-4 py-2 text-xs text-app-fg-secondary">
          <span className="text-app-fg-subtle">Your reels · </span>
          {ownReelsRes.ok ? ownReels.length : "—"}
        </div>
      </section>

      <section className="mb-12">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-app-fg">Your reels</h2>
          <span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-700 dark:bg-white/12 dark:text-app-fg-muted">
            {ownReelsRes.ok ? ownReels.length : "—"}
          </span>
        </div>
        {!ownReelsRes.ok ? (
          <p className="text-xs text-app-fg-subtle">
            Couldn&apos;t load your reels. Run <strong>Refresh baseline</strong> to scrape and store them.
          </p>
        ) : topOwn.length === 0 ? (
          <p className="text-sm text-app-fg-muted">
            No own reels stored yet. <strong>Refresh baseline</strong> saves your last 30 reels here.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {topOwn.map((row) => (
              <div key={row.id} className="glass flex gap-3 rounded-xl p-3">
                <ReelThumbnail
                  src={row.thumbnail_url}
                  alt={`@${row.account_username} reel`}
                  href={row.post_url}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-app-fg">
                    @{row.account_username}
                  </p>
                  <p className="text-sm font-bold text-zinc-800 dark:text-app-fg-secondary">
                    {row.views != null ? `${row.views.toLocaleString()} views` : "—"}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-app-fg-muted">
                    {row.hook_text || row.caption || "—"}
                  </p>
                  {row.post_url ? (
                    <a
                      href={row.post_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-[10px] font-semibold text-amber-400 hover:underline"
                    >
                      Open ↗
                    </a>
                  ) : null}
                </div>
              </div>
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
        {!compRes.ok ? (
          <div className="glass rounded-xl px-6 py-10 text-center text-sm text-app-fg-muted">
            Couldn&apos;t load competitors. Try Discover again in a moment.
          </div>
        ) : (
          <CompetitorsList competitors={competitors} baseline={baseline} />
        )}
      </section>

      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-app-fg">
            Competitor outliers
          </h2>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-4">
            {clientSlug ? <AddUrlInput clientSlug={clientSlug} orgSlug={orgSlug} /> : null}
            <Link
              href="/intelligence/reels"
              className="text-xs font-medium text-amber-400 hover:underline sm:whitespace-nowrap"
            >
              View all reels →
            </Link>
          </div>
        </div>

        {outliers.length === 0 ? (
          <div className="glass rounded-xl px-6 py-10 text-center">
            <p className="text-sm text-app-fg-muted">
              No outlier reels yet. Scrape competitor reels after you have competitors and a baseline.
            </p>
            <div className="mt-4 flex justify-center">
              <ScrapeReelsButton
                clientSlug={clientSlug}
                orgSlug={orgSlug}
                disabled={syncDisabled}
                disabledHint={syncDisabledHint}
                hasCompetitors={competitors.length > 0}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {outliers.map((row) => (
              <div key={row.id} className="glass flex gap-3 rounded-xl p-3">
                <ReelThumbnail
                  src={row.thumbnail_url}
                  alt={`@${row.account_username} reel`}
                  href={row.post_url}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-app-fg">
                    @{row.account_username}
                  </p>
                  <p className="text-sm font-bold text-amber-400">
                    {row.outlier_ratio != null ? `${Number(row.outlier_ratio).toFixed(1)}× your baseline` : "—"}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-app-fg-muted">
                    {row.hook_text || row.caption || "—"}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-app-fg-subtle">
                    <span>{row.views != null ? `${row.views.toLocaleString()} views` : "—"}</span>
                    {row.post_url ? (
                      <a
                        href={row.post_url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-amber-400 hover:underline"
                      >
                        Open ↗
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
