import {
  fetchIntelligenceActivity,
  fetchIntelligenceStats,
  getCachedServerApiContext,
} from "@/lib/api";
import { DashboardHotReels } from "./dashboard-hot-reels";
import { DashboardKpiStrip } from "./dashboard-kpi-strip";
import { DashboardUpdateReels } from "./dashboard-update-reels";
import { OwnReelMetricsDashboard } from "./own-reel-metrics-dashboard";

export default async function DashboardPage() {
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

  const [statsRes, activityRes] = await Promise.all([
    fetchIntelligenceStats(),
    fetchIntelligenceActivity(),
  ]);

  const stats = statsRes.ok ? statsRes.data : null;
  const hotGrowth =
    activityRes.ok && activityRes.data ? activityRes.data.own_reel_growth : [];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:px-6">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-lg font-semibold text-app-fg">Dashboard</h1>
          <p className="max-w-xl text-xs text-app-fg-muted">
            Headline numbers for your reels, what&apos;s heating up, and trends after each pull from
            Instagram.
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
          <OwnReelMetricsDashboard clientSlug={clientSlug} orgSlug={orgSlug} />
        </div>
        <div className="lg:col-span-1">
          <DashboardHotReels items={hotGrowth} />
        </div>
      </div>
    </main>
  );
}
