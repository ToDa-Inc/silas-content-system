import Link from "next/link";
import { fetchScrapedReels, getCachedServerApiContext, type ScrapedReelRow } from "@/lib/api";
import { BreakoutsReelsGrid } from "../components/breakouts-reels-grid";
import { SectionSyncButton } from "../components/section-sync-button";

function maxBreakoutStrength(r: ScrapedReelRow): number {
  const nums = [
    r.outlier_views_ratio != null ? Number(r.outlier_views_ratio) : null,
    r.outlier_likes_ratio != null ? Number(r.outlier_likes_ratio) : null,
    r.outlier_comments_ratio != null ? Number(r.outlier_comments_ratio) : null,
    r.outlier_ratio != null ? Number(r.outlier_ratio) : null,
  ].filter((n): n is number => n != null && !Number.isNaN(n));
  if (nums.length === 0) return 0;
  return Math.max(...nums);
}

function allOutlierReels(reels: ScrapedReelRow[]): ScrapedReelRow[] {
  return reels
    .filter((r) => r.is_outlier === true && r.competitor_id)
    .sort((a, b) => maxBreakoutStrength(b) - maxBreakoutStrength(a));
}

export default async function IntelligenceBreakoutsPage() {
  const { user, tenancy, clientSlug, orgSlug } = await getCachedServerApiContext();
  const reelsRes = await fetchScrapedReels(false, true);
  const allReels = reelsRes.ok && Array.isArray(reelsRes.data) ? reelsRes.data : [];
  const outliers = allOutlierReels(allReels);

  const syncDisabled = !clientSlug.trim() || !orgSlug.trim();
  const syncDisabledHint =
    user && !tenancy
      ? "No workspace membership visible for this login — see the alert above."
      : !orgSlug.trim()
        ? "Missing organization slug — refresh or check Supabase session."
        : !clientSlug.trim()
          ? "Pick a creator in the top bar or finish onboarding."
          : null;

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-8 md:px-8">
      {user && !tenancy ? (
        <div className="glass mb-8 rounded-xl px-5 py-4 text-sm text-app-fg-secondary">
          <p className="font-medium text-app-fg">We can&apos;t see a workspace for this login</p>
          <p className="mt-1 text-xs text-app-fg-subtle">
            The app did not find an <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">organization_members</code>{" "}
            row for your user. If you never onboarded here, start below.
          </p>
          <Link
            href="/onboarding"
            className="mt-3 inline-flex rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-zinc-950"
          >
            Create workspace
          </Link>
        </div>
      ) : null}

      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href="/intelligence"
            className="font-medium text-app-fg-muted transition-colors hover:text-amber-400"
          >
            ← Intelligence
          </Link>
          <span className="text-zinc-400 dark:text-zinc-600">|</span>
          <h1 className="text-lg font-semibold text-app-fg">Competitor breakouts</h1>
        </div>
        {clientSlug.trim() && orgSlug.trim() ? (
          <SectionSyncButton
            mode="competitors"
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            disabled={syncDisabled}
            disabledHint={syncDisabledHint}
          />
        ) : null}
      </header>

      <p className="mb-6 text-xs text-app-fg-muted">
        {reelsRes.ok ? (
          <>
            <span className="font-semibold text-app-fg-secondary">{outliers.length}</span> breakout
            {outliers.length === 1 ? "" : "s"} — all types together, sorted by strongest ratio.
          </>
        ) : (
          <span>Couldn&apos;t load reels. Try refreshing.</span>
        )}
      </p>

      {clientSlug.trim() && orgSlug.trim() ? (
        <BreakoutsReelsGrid reels={outliers} clientSlug={clientSlug} orgSlug={orgSlug} />
      ) : null}
    </main>
  );
}
