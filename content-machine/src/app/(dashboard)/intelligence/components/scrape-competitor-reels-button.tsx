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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-end gap-1.5 text-[10px] text-app-fg-subtle">
        <AppSelect
          label="Reels"
          value={String(limit)}
          onChange={(v) => setLimit(Number(v))}
          options={LIMIT_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
          disabled={busy || disabled}
          triggerClassName="min-w-[56px] py-1 text-[10px]"
        />
      </div>
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => void run()}
        className="inline-flex items-center gap-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400"
        title={`Sync up to ${limit} reels from @${username}`}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        Sync reels
      </button>
      {error ? <span className="text-[10px] text-amber-600 dark:text-amber-400">{error}</span> : null}
    </div>
  );
}
