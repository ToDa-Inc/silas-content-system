import {
  fetchDashboardCompetitorWins,
  fetchDashboardFreshNiche,
  fetchIntelligenceStats,
  getCachedServerApiContext,
} from "@/lib/api";
import { CompetitorWins, FreshFromNiche } from "./dashboard-daily-lane";
import { DashboardKpiStrip } from "./dashboard-kpi-strip";
import { DashboardUpdateReels } from "./dashboard-update-reels";
import { OwnReelMetricsDashboard } from "./own-reel-metrics-dashboard";

type DashboardSearchParams = { focusReel?: string | string[] };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<DashboardSearchParams>;
}) {
  const sp = searchParams ? await searchParams : {};
  const rawFocus = sp.focusReel;
  const focusReel =
    typeof rawFocus === "string" ? rawFocus.trim() : Array.isArray(rawFocus) ? String(rawFocus[0] ?? "").trim() : "";

  const { clientSlug, orgSlug, user, tenancy } = await getCachedServerApiContext();
  const syncDisabled = !clientSlug.trim() || !orgSlug.trim();
  const syncDisabledHint =
    user && !tenancy
      ? "No workspace membership visible for this login — refresh or check your account."
      : !orgSlug.trim()
        ? "Missing organization — refresh the page or sign in again."
        : !clientSlug.trim()
          ? "Pick a creator in the top bar or finish onboarding."
          : null;

  const [statsRes, freshRes, winsRes] = await Promise.all([
    fetchIntelligenceStats(),
    fetchDashboardFreshNiche(),
    fetchDashboardCompetitorWins(),
  ]);

  const stats = statsRes.ok ? statsRes.data : null;
  const freshNicheReels = freshRes.ok ? freshRes.data : [];
  const competitorWinReels = winsRes.ok ? winsRes.data : [];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:px-6">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-lg font-semibold text-app-fg">Dashboard</h1>
          <p className="max-w-xl text-xs text-app-fg-muted">
            Headline numbers for your reels, fresh niche finds, and competitor breakouts worth recreating —
            refreshed every day.
          </p>
        </div>
        <DashboardUpdateReels
          clientSlug={clientSlug}
          orgSlug={orgSlug}
          disabled={syncDisabled}
          disabledHint={syncDisabledHint}
        />
      </header>

      <DashboardKpiStrip stats={stats} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <OwnReelMetricsDashboard
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            focusReelId={focusReel || undefined}
          />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-1">
          <FreshFromNiche
            reels={freshNicheReels}
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            disabled={syncDisabled}
            disabledHint={syncDisabledHint}
          />
          <CompetitorWins
            reels={competitorWinReels}
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            disabled={syncDisabled}
            disabledHint={syncDisabledHint}
          />
        </div>
      </div>
    </main>
  );
}
