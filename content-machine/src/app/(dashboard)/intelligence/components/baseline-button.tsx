"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { clientApiHeaders, contentApiFetch, getContentApiBase } from "@/lib/api-client";

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
  /** Icon-only square toolbar style — tooltip carries the description. */
  compact?: boolean;
};

type BaselineRefreshResult = {
  job_id?: string;
  status?: string;
  result?: {
    reels_analyzed?: number;
    median_views?: number;
    avg_views?: number;
  };
};

export function BaselineButton({ clientSlug, orgSlug, disabled, disabledHint, compact }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function runBaseline() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      setStatus(
        disabledHint?.trim() ||
          (!orgSlug.trim()
            ? "No organization context — refresh the page or sign in again."
            : "Add or select a creator (client) in the header first."),
      );
      return;
    }
    setBusy(true);
    setStatus("Scraping your Instagram reels…");
    const apiBase = getContentApiBase();
    const headersBase = await clientApiHeaders({ orgSlug });

    try {
      const b = await contentApiFetch(`${apiBase}/api/v1/clients/${clientSlug}/baseline/refresh`, {
        method: "POST",
        headers: headersBase,
      });
      if (b.status === 409) {
        setStatus("An update is already running — please wait.");
        return;
      }
      if (!b.ok) {
        const err = await b.text();
        setStatus(err ? `Error: ${err.slice(0, 200)}` : "Something went wrong — try again.");
        return;
      }
      const json = (await b.json()) as BaselineRefreshResult;
      const r = json.result;
      const median = r?.median_views;
      const reels = r?.reels_analyzed;
      setStatus(
        median != null && reels != null
          ? `Done — ${reels} reels analyzed, ${median.toLocaleString()} median views.`
          : "Your reels are up to date.",
      );
      router.refresh();
    } catch {
      setStatus("Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  const label = busy ? "Refreshing…" : "Refresh my reels";

  if (compact) {
    return (
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          disabled={busy || disabled || !clientSlug.trim() || !orgSlug.trim()}
          title={
            disabledHint ??
            "Pull your latest reels from Instagram and refresh your stats (averages, medians)."
          }
          aria-label={label}
          onClick={() => void runBaseline()}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-app-secondary-btn-border bg-app-secondary-btn-bg text-app-secondary-btn-fg transition-colors hover:bg-zinc-200 dark:hover:bg-white/[0.14] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <BarChart3 className="h-5 w-5" aria-hidden />}
        </button>
        {status ? (
          <p className="max-w-[140px] text-center text-[10px] text-app-fg-muted">{status}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy || disabled || !clientSlug.trim() || !orgSlug.trim()}
        title={disabledHint ?? undefined}
        onClick={() => void runBaseline()}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-app-secondary-btn-border bg-app-secondary-btn-bg px-4 py-2 text-sm font-semibold text-app-secondary-btn-fg transition-colors hover:bg-zinc-200 dark:hover:bg-white/[0.14] disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BarChart3 className="h-4 w-4" aria-hidden />}
        {busy ? "Refreshing…" : "Refresh my reels"}
      </button>
      <p className="text-[11px] leading-snug text-app-fg-subtle">
        Pull your own reels from Instagram and refresh performance numbers.
      </p>
      {status ? (
        <p className="max-w-[260px] text-[11px] text-app-fg-muted">{status}</p>
      ) : null}
    </div>
  );
}
