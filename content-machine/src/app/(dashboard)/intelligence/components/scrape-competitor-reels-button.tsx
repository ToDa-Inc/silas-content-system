"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { AppSelect } from "@/components/ui/app-select";
import { clientApiHeaders, contentApiFetch, formatFastApiError, getContentApiBase } from "@/lib/api-client";

const LIMIT_OPTIONS = [5, 10, 15, 20, 30] as const;

type Props = {
  clientSlug: string;
  orgSlug: string;
  competitorId: string;
  username: string;
  disabled?: boolean;
};

export function ScrapeCompetitorReelsButton({
  clientSlug,
  orgSlug,
  competitorId,
  username,
  disabled,
}: Props) {
  const router = useRouter();
  const [limit, setLimit] = useState<number>(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) return;
    setBusy(true);
    setError(null);
    const apiBase = getContentApiBase();
    const headers = await clientApiHeaders({ orgSlug });
    try {
      const res = await contentApiFetch(
        `${apiBase}/api/v1/clients/${clientSlug}/competitors/${competitorId}/scrape-reels`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ limit }),
        },
      );
      const json = (await res.json()) as { detail?: unknown; reels_processed?: number };
      if (!res.ok) {
        setError(formatFastApiError(json, "Sync failed"));
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  const sectionLabelClass =
    "text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-app-fg-subtle";

  return (
    <div className="min-w-0">
      <div className="flex flex-col gap-1.5">
        <span className={sectionLabelClass}>Reels</span>
        <div className="flex flex-wrap items-center gap-2">
          <AppSelect
            ariaLabel="How many reels to sync"
            value={String(limit)}
            onChange={(v) => setLimit(Number(v))}
            options={LIMIT_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
            disabled={busy || disabled}
            menuAbove
            dense
            className="shrink-0"
            triggerClassName="h-8 min-w-[3.25rem] justify-center gap-1 rounded-md px-2 text-[11px] font-medium tabular-nums leading-none"
          />
          <button
            type="button"
            disabled={busy || disabled}
            onClick={() => void run()}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 text-[11px] font-semibold leading-none text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400"
            title={`Sync up to ${limit} reels from @${username}`}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Sync reels
          </button>
        </div>
        {error ? (
          <p className="text-[10px] leading-snug text-amber-600 dark:text-amber-400">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
