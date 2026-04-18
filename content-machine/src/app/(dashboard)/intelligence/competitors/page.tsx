import Link from "next/link";
import {
  fetchBaseline,
  fetchClient,
  fetchCompetitors,
  fetchScrapedReels,
  getCachedServerApiContext,
  type BaselineRow,
} from "@/lib/api";
import { topicKeywordSuggestionsFromNicheConfig } from "@/lib/niche-keywords";
import { CompetitorsList } from "../components/competitors-list";
import { DiscoverInline } from "../components/discover-inline";
import { SectionSyncButton } from "../components/section-sync-button";

export default async function IntelligenceCompetitorsPage() {
  const { user, tenancy, clientSlug, orgSlug } = await getCachedServerApiContext();

  const [compRes, baseRes, reelsRes, clientRes] = await Promise.all([
    fetchCompetitors(),
    fetchBaseline(),
    fetchScrapedReels(false, true),
    fetchClient(),
  ]);

  const suggestedKeywords =
    clientRes.ok && clientRes.data
      ? topicKeywordSuggestionsFromNicheConfig(clientRes.data.niche_config)
      : [];

  const competitors = compRes.ok ? compRes.data : [];
  const baseline: BaselineRow | null = baseRes.ok ? baseRes.data : null;
  const allReels = reelsRes.ok && Array.isArray(reelsRes.data) ? reelsRes.data : [];

  const syncDisabled = !clientSlug.trim() || !orgSlug.trim();
  const syncDisabledHint =
    user && !tenancy
      ? "No workspace for this login — see the alert above."
      : !orgSlug.trim()
        ? "Missing organization — refresh the page or sign in again."
        : !clientSlug.trim()
          ? "Pick a creator in the top bar or finish onboarding."
          : null;

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-8 md:px-8">
      {user && !tenancy ? (
        <div className="glass mb-8 rounded-xl px-5 py-4 text-sm text-app-fg-secondary">
          <p className="font-medium text-app-fg">We can&apos;t see a workspace for this login</p>
          <p className="mt-1 text-xs text-app-fg-subtle">
            Your account isn&apos;t linked to a workspace yet. Create one below, or sign out and back in if you already
            did.
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
          <h1 className="text-lg font-semibold text-app-fg">Competitors</h1>
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

      {clientSlug.trim() && orgSlug.trim() ? (
        <div className="mb-6">
          <DiscoverInline
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            suggestedKeywords={suggestedKeywords}
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
    </main>
  );
}
