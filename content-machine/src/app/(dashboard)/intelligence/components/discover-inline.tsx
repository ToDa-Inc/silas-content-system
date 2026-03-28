"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Search, UserPlus } from "lucide-react";
import { clientApiHeaders, contentApiFetch, getContentApiBase } from "@/lib/api-client";
import { AddCompetitorModal } from "./add-competitor-modal";
import { INTELLIGENCE_PRIMARY_BUTTON_CLASS, INTELLIGENCE_SECTION_CARD_CLASS } from "./intelligence-toolbar-styles";
import { TopicSearchSection } from "./topic-search-section";

const SECTION_TITLE = "text-sm font-semibold tracking-tight text-app-fg";
const SECTION_DESC = "mt-1.5 text-xs leading-relaxed text-app-fg-subtle";

type Props = {
  clientSlug: string;
  orgSlug: string;
  suggestedKeywords: string[];
  disabled?: boolean;
  disabledHint?: string | null;
};

type DiscoverResult = {
  job_id?: string;
  status?: string;
  result?: {
    keywords_planned?: string[];
    competitors_saved?: number;
    evaluated?: number;
    accounts_discovered?: number;
    message?: string;
  };
};

export function DiscoverInline({ clientSlug, orgSlug, suggestedKeywords, disabled, disabledHint }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discoverStatus, setDiscoverStatus] = useState<string | null>(null);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualMessage, setManualMessage] = useState<string | null>(null);

  async function runDiscover() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      setDiscoverStatus(
        disabledHint?.trim() ||
          (!orgSlug.trim()
            ? "No organization context — refresh the page or sign in again."
            : "Add or select a creator in the header first."),
      );
      return;
    }
    setBusy(true);
    setDiscoverStatus("Searching…");
    const apiBase = getContentApiBase();
    const headersBase = await clientApiHeaders({ orgSlug });

    try {
      const d = await contentApiFetch(`${apiBase}/api/v1/clients/${clientSlug}/competitors/discover`, {
        method: "POST",
        headers: { ...headersBase, "Content-Type": "application/json" },
        body: JSON.stringify({ keyword_mode: "all" }),
      });
      if (d.status === 409) {
        setDiscoverStatus("Discovery already running — please wait.");
        return;
      }
      if (!d.ok) {
        const err = await d.text();
        setDiscoverStatus(err ? `Error: ${err.slice(0, 200)}` : "Something went wrong — try again.");
        return;
      }
      const json = (await d.json()) as DiscoverResult;
      const planned = json.result?.keywords_planned;
      const kwPrefix = planned?.length ? `Searched: ${planned.join(", ")}. ` : "";
      const saved = json.result?.competitors_saved ?? 0;
      const evaluated = json.result?.evaluated ?? 0;
      const discovered = json.result?.accounts_discovered;
      const msg = json.result?.message;
      if (msg) {
        setDiscoverStatus(`${kwPrefix}${msg}`);
      } else {
        const bits = [
          `${saved} competitor${saved === 1 ? "" : "s"} saved`,
          evaluated != null && evaluated > 0 ? `${evaluated} evaluated` : null,
          discovered != null ? `${discovered} accounts found` : null,
        ].filter(Boolean);
        setDiscoverStatus(`${kwPrefix}Done — ${bits.join(", ")}.`);
      }
      router.refresh();
    } catch {
      setDiscoverStatus("Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  const title =
    disabledHint?.trim() ||
    "Add a competitor by @handle or profile URL. Optionally scrape their reels right after (Apify).";

  return (
    <div className="glass overflow-hidden rounded-xl border border-zinc-200/60 dark:border-white/[0.08]">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3.5 text-left text-sm font-semibold text-app-fg transition-colors hover:bg-zinc-100/60 dark:hover:bg-white/[0.04]"
      >
        <span className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300">
            <UserPlus className="h-4 w-4" aria-hidden />
          </span>
          Add competitors
        </span>
        {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-app-fg-subtle" /> : <ChevronDown className="h-4 w-4 shrink-0 text-app-fg-subtle" />}
      </button>
      {expanded ? (
        <div className="space-y-4 border-t border-zinc-200/60 px-4 pb-5 pt-4 dark:border-white/[0.06]">
          <div className={INTELLIGENCE_SECTION_CARD_CLASS}>
            <p className={SECTION_TITLE}>Add manually</p>
            <p className={SECTION_DESC}>
              Enter an @handle or profile URL. You can fetch their latest reels after saving.
            </p>
            <button
              type="button"
              disabled={disabled || !clientSlug.trim() || !orgSlug.trim()}
              title={title}
              onClick={() => setManualModalOpen(true)}
              className={`mt-4 ${INTELLIGENCE_PRIMARY_BUTTON_CLASS}`}
            >
              <UserPlus className="h-4 w-4" aria-hidden />
              Add manually
            </button>
            {manualMessage ? (
              <p className="mt-3 text-xs text-app-fg-muted" role="status">
                {manualMessage}
              </p>
            ) : null}
          </div>

          <div className={INTELLIGENCE_SECTION_CARD_CLASS}>
            <p className={SECTION_TITLE}>Find competitors</p>
            <p className={SECTION_DESC}>
              Uses identity keywords from your niche profile (
              <a href="/settings" className="font-medium text-amber-600 underline-offset-2 hover:underline dark:text-amber-400">
                Settings → Niche profile
              </a>
              ). Sync your reels first so keywords are filled in.
            </p>
            <button
              type="button"
              disabled={busy || disabled || !clientSlug.trim() || !orgSlug.trim()}
              title={disabledHint ?? undefined}
              onClick={() => void runDiscover()}
              className={`mt-4 ${INTELLIGENCE_PRIMARY_BUTTON_CLASS}`}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
              {busy ? "Searching…" : "Find competitors"}
            </button>
            {discoverStatus ? (
              <p className="mt-3 text-xs text-app-fg-muted" role="status">
                {discoverStatus}
              </p>
            ) : null}
          </div>

          <TopicSearchSection
            clientSlug={clientSlug}
            orgSlug={orgSlug}
            suggestedKeywords={suggestedKeywords}
            disabled={disabled}
            embedded
          />
        </div>
      ) : null}

      <AddCompetitorModal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
        disabled={disabled}
        disabledHint={disabledHint}
        onToolbarMessage={setManualMessage}
      />
    </div>
  );
}
