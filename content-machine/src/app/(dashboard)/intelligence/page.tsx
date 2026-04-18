import Link from "next/link";
import {
  fetchBaseline,
  fetchCompetitors,
  fetchOutlierCount,
  getCachedServerApiContext,
} from "@/lib/api";
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

export default async function IntelligencePage() {
  const { user, tenancy, clientSlug, orgSlug } = await getCachedServerApiContext();

  // fetchOutlierCount is a single COUNT query — replaces the previous full reels fetch
  const [compRes, outlierRes, baselineRes] = await Promise.all([
    fetchCompetitors(),
    fetchOutlierCount(),
    fetchBaseline(),
  ]);

  const competitors = compRes.ok ? compRes.data : [];
  const nOutliers = outlierRes.ok ? outlierRes.count : 0;
  const lastSyncedAt = baselineRes.ok && baselineRes.data ? baselineRes.data.scraped_at : null;

  const clientLabel = formatClientLabel(clientSlug);
  const syncDisabled = !clientSlug.trim() || !orgSlug.trim();
  const syncDisabledHint =
    user && !tenancy
      ? "No workspace for this login — see the alert above."
      : !orgSlug.trim()
        ? "Missing organization — refresh the page or sign in again."
        : !clientSlug.trim()
          ? "Pick a creator in the top bar or finish onboarding."
          : null;
  const loadError = !compRes.ok;
  const loadErrorDetails = [
    compRes.ok ? null : compRes.error,
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
            Your account isn&apos;t linked to a workspace yet. If you&apos;re new here, create one below. If you already
            set one up, try signing out and back in, or contact support if it keeps happening.
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
          lastSyncedAt={lastSyncedAt}
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
              We couldn&apos;t authorize this request. Try refreshing the page. If you just signed up, finish onboarding
              first. Still stuck? Contact support — they can verify your workspace setup.
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
        <nav
          className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-zinc-200/60 bg-zinc-50/40 px-4 py-2.5 text-xs dark:border-white/[0.08] dark:bg-white/[0.02]"
          aria-label="Intelligence quick links"
        >
          <Link
            href="/intelligence/breakouts"
            className="group inline-flex items-center gap-1.5 font-medium text-app-fg-secondary transition-colors hover:text-amber-700 dark:hover:text-amber-400"
          >
            <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-zinc-700 dark:bg-white/12 dark:text-app-fg-muted">
              {outlierRes.ok ? nOutliers : "—"}
            </span>
            <span>competitor breakouts</span>
            <span aria-hidden className="text-app-fg-muted transition-transform group-hover:translate-x-0.5 group-hover:text-amber-600 dark:group-hover:text-amber-400">
              →
            </span>
          </Link>
          <span className="text-app-fg-muted" aria-hidden>·</span>
          <Link
            href="/intelligence/competitors"
            className="group inline-flex items-center gap-1.5 font-medium text-app-fg-secondary transition-colors hover:text-amber-700 dark:hover:text-amber-400"
          >
            <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-zinc-700 dark:bg-white/12 dark:text-app-fg-muted">
              {compRes.ok ? competitors.length : "—"}
            </span>
            <span>competitors tracked</span>
            <span aria-hidden className="text-app-fg-muted transition-transform group-hover:translate-x-0.5 group-hover:text-amber-600 dark:group-hover:text-amber-400">
              →
            </span>
          </Link>
        </nav>
      ) : null}
    </main>
  );
}
