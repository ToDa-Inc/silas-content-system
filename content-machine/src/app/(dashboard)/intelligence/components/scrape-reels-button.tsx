"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Film, Loader2 } from "lucide-react";
import { clientApiHeaders, getContentApiBase } from "@/lib/api-client";

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
  /** When false, discovery has not produced competitors yet. */
  hasCompetitors: boolean;
};

type ScrapeResult = {
  competitors_scraped?: number;
  reels_processed?: number;
  skipped_fresh?: number;
  skipped_duplicate?: number;
  competitors_considered?: number;
};

export function ScrapeReelsButton({
  clientSlug,
  orgSlug,
  disabled,
  disabledHint,
  hasCompetitors,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const noCompetitorsHint = !hasCompetitors
    ? "Add competitors first (run Discover) before scraping reels."
    : null;

  async function runScrape() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      setStatus(
        disabledHint?.trim() ||
          (!orgSlug.trim()
            ? "No organization context — refresh the page or sign in again."
            : "Add or select a creator (client) in the header first."),
      );
      return;
    }
    if (!hasCompetitors) {
      setStatus(noCompetitorsHint ?? "No competitors to scrape.");
      return;
    }
    setBusy(true);
    setStatus("Scraping stale competitor profiles (this can take a few minutes)…");
    const apiBase = getContentApiBase();
    const headersBase = await clientApiHeaders({ orgSlug });

    try {
      const s = await fetch(`${apiBase}/api/v1/clients/${clientSlug}/reels/scrape`, {
        method: "POST",
        headers: headersBase,
      });
      if (!s.ok) {
        const err = await s.text();
        setStatus(err ? `Error: ${err.slice(0, 200)}` : "Something went wrong — try again.");
        return;
      }
      const json = (await s.json()) as ScrapeResult;
      const scraped = json.competitors_scraped ?? 0;
      const reels = json.reels_processed ?? 0;
      const fresh = json.skipped_fresh ?? 0;
      const dup = json.skipped_duplicate ?? 0;

      if (scraped === 0) {
        setStatus(
          `Nothing stale to scrape (${fresh} fresh, ${dup} skipped duplicate jobs). Run Discover or wait for cooldown.`,
        );
      } else {
        setStatus(
          `Done — ${scraped} competitor${scraped === 1 ? "" : "s"} scraped, ${reels} reel${reels === 1 ? "" : "s"} processed.`,
        );
      }
      router.refresh();
    } catch {
      setStatus("Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  const effectivelyDisabled = disabled || !hasCompetitors;
  const title = effectivelyDisabled ? noCompetitorsHint ?? disabledHint ?? undefined : undefined;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy || effectivelyDisabled || !clientSlug.trim() || !orgSlug.trim()}
        title={title}
        onClick={() => void runScrape()}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-500/45 bg-amber-500/14 px-4 py-2 text-sm font-semibold text-amber-100 transition-colors hover:bg-amber-500/24 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Film className="h-4 w-4" aria-hidden />}
        {busy ? "Scraping…" : "Scrape reels"}
      </button>
      <p className="text-[11px] leading-snug text-app-fg-subtle">
        Pull latest reels from competitors that are due (tier + last scraped).
      </p>
      {status ? (
        <p className="max-w-[280px] text-[11px] text-app-fg-muted">{status}</p>
      ) : null}
    </div>
  );
}
