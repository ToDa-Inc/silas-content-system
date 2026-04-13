import Link from "next/link";
import {
  fetchCompetitors,
  fetchScrapedReels,
  getCachedServerApiContext,
  type ScrapedReelRow,
} from "@/lib/api";
import { BreakoutsTeaserCard } from "./components/breakouts-teaser-card";
import { CompetitorsTeaserCard } from "./components/competitors-teaser-card";
import { IntelligenceToolbar } from "./components/intelligence-toolbar";
import { WhatHappenedSection } from "./components/what-happened-section";

function formatClientLabel(slug: string): string {
  if (!slug.trim()) return "";
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function outlierCount(reels: ScrapedReelRow[]): number {
  return reels.filter((r) => r.is_outlier === true && r.competitor_id).length;
}

export default async function IntelligencePage() {
  const { user, tenancy, clientSlug, orgSlug } = await getCachedServerApiContext();

  const [compRes, reelsRes] = await Promise.all([
    fetchCompetitors(),
    fetchScrapedReels(false, true),
  ]);

  const competitors = compRes.ok ? compRes.data : [];
  const allReels = reelsRes.ok && Array.isArray(reelsRes.data) ? reelsRes.data : [];
  const nOutliers = reelsRes.ok ? outlierCount(allReels) : 0;

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
  const loadErrorDetails = [
    compRes.ok ? null : compRes.error,
    reelsRes.ok ? null : reelsRes.error,
  ]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(" · ");

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
        <div className="mb-6 space-y-2">
          <p className="text-sm text-app-fg-muted">
            Some data couldn&apos;t be loaded. Try refreshing in a moment.
          </p>
          {loadErrorDetails ? (
            <p className="text-xs leading-relaxed text-app-fg-subtle">
              <span className="font-medium text-app-fg-secondary">Details: </span>
              <span className="break-words font-mono">{loadErrorDetails}</span>
            </p>
          ) : null}
          {loadErrorDetails.includes("401") ||
          loadErrorDetails.toLowerCase().includes("missing api key") ? (
            <p className="text-xs leading-relaxed text-app-fg-muted">
              The server must send your profile API key to FastAPI. Ensure{" "}
              <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">SUPABASE_SERVICE_ROLE_KEY</code> is set
              in the repo <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">.env</code> (Next loads it via{" "}
              <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">next.config</code>), and that your user has
              a row in <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">profiles</code> with{" "}
              <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">api_key</code> (onboarding creates it).
            </p>
          ) : null}
        </div>
      ) : null}

      {clientSlug.trim() && orgSlug.trim() ? (
        <WhatHappenedSection
          clientSlug={clientSlug}
          orgSlug={orgSlug}
          disabled={syncDisabled}
          disabledHint={syncDisabledHint}
        />
      ) : null}

      {clientSlug.trim() && orgSlug.trim() ? (
        <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3">
          <BreakoutsTeaserCard count={reelsRes.ok ? nOutliers : "—"} />
          <CompetitorsTeaserCard count={compRes.ok ? competitors.length : "—"} />
        </div>
      ) : null}
    </main>
  );
}
