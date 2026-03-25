"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { clientApiHeaders, contentApiFetch, getContentApiBase } from "@/lib/api-client";
import { INTELLIGENCE_TOOLBAR_ICON_CLASS } from "./intelligence-toolbar-styles";

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
  compact?: boolean;
  /** When set, status text is shown by the parent (toolbar) so the button row stays aligned. */
  onStatusChange?: (msg: string | null) => void;
};

type SyncResult = {
  baseline?: {
    job_id?: string;
    result?: { reels_analyzed?: number };
    error?: string;
  } | null;
  competitor_reels_processed?: number;
  competitors_attempted?: number;
};

export function SyncAllButton({
  clientSlug,
  orgSlug,
  disabled,
  disabledHint,
  compact,
  onStatusChange,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  async function runSync() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      const m =
        disabledHint?.trim() ||
        (!orgSlug.trim()
          ? "No organization context — refresh the page or sign in again."
          : "Add or select a creator in the header first.");
      setStatus(m);
      return;
    }
    setBusy(true);
    setStatus("Syncing your reels and competitors…");
    const apiBase = getContentApiBase();
    const headersBase = await clientApiHeaders({ orgSlug });

    try {
      const res = await contentApiFetch(`${apiBase}/api/v1/clients/${clientSlug}/sync`, {
        method: "POST",
        headers: headersBase,
      });
      if (res.status === 409) {
        setStatus("A sync is already running — please wait.");
        return;
      }
      if (!res.ok) {
        const err = await res.text();
        setStatus(err ? `Error: ${err.slice(0, 200)}` : "Something went wrong — try again.");
        return;
      }
      const json = (await res.json()) as SyncResult;
      const br = json.competitor_reels_processed ?? 0;
      const nComp = json.competitors_attempted ?? 0;
      const b = json.baseline;
      const baseErr = b?.error ?? null;
      const reelsOwn = b?.result?.reels_analyzed ?? null;
      if (baseErr) {
        setStatus(
          `Competitors updated (${br} reels across ${nComp}). Your reels: ${baseErr.slice(0, 120)}`,
        );
      } else {
        setStatus(
          reelsOwn != null
            ? `Done — ${reelsOwn} of your reels, ${br} competitor reels (${nComp} accounts).`
            : `Done — ${br} competitor reels (${nComp} accounts).`,
        );
      }
      router.refresh();
    } catch {
      setStatus("Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  const title =
    disabledHint?.trim() ||
    "Sync your reels and every competitor’s reels (can take a few minutes).";

  const label = busy ? "Syncing…" : "Sync all";

  if (compact) {
    return (
      <button
        type="button"
        disabled={busy || disabled || !clientSlug.trim() || !orgSlug.trim()}
        title={title}
        aria-label={label}
        onClick={() => void runSync()}
        className={INTELLIGENCE_TOOLBAR_ICON_CLASS}
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <RefreshCw className="h-5 w-5" aria-hidden />}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy || disabled || !clientSlug.trim() || !orgSlug.trim()}
        title={disabledHint ?? undefined}
        onClick={() => void runSync()}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
        {label}
      </button>
      {status && !onStatusChange ? <p className="max-w-[280px] text-[11px] text-app-fg-muted">{status}</p> : null}
    </div>
  );
}
