"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { clientApiHeaders, contentApiFetch, getContentApiBase } from "@/lib/api-client";
import { INTELLIGENCE_SECTION_SYNC_ICON_CLASS } from "./intelligence-toolbar-styles";

export type SectionSyncMode = "own" | "competitors" | "both";

type Props = {
  mode: SectionSyncMode;
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
};

export function SectionSyncButton({ mode, clientSlug, orgSlug, disabled, disabledHint }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function runSync() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      setStatus(
        disabledHint?.trim() ||
          (!orgSlug.trim()
            ? "No organization context — refresh the page or sign in again."
            : "Add or select a creator in the header first."),
      );
      return;
    }
    setBusy(true);
    setStatus(null);
    const apiBase = getContentApiBase();
    const headersBase = await clientApiHeaders({ orgSlug });

    try {
      if (mode === "own" || mode === "both") {
        setStatus(mode === "both" ? "Syncing your reels…" : "Syncing…");
        const res = await contentApiFetch(`${apiBase}/api/v1/clients/${clientSlug}/sync/own`, {
          method: "POST",
          headers: headersBase,
        });
        if (res.status === 409) {
          setStatus("A sync for your reels is already running — please wait.");
          return;
        }
        if (!res.ok) {
          const err = await res.text();
          setStatus(err ? `Error: ${err.slice(0, 160)}` : "Sync failed.");
          return;
        }
        const json = (await res.json().catch(() => ({}))) as { result?: { reels_analyzed?: number } };
        const n = json.result?.reels_analyzed;
        if (mode === "own") {
          setStatus(n != null ? `Done — ${n} reels synced.` : "Done.");
          router.refresh();
          return;
        }
      }

      if (mode === "competitors" || mode === "both") {
        setStatus(mode === "both" ? "Syncing competitor reels…" : "Syncing…");
        const res = await contentApiFetch(`${apiBase}/api/v1/clients/${clientSlug}/sync/competitors`, {
          method: "POST",
          headers: headersBase,
        });
        if (!res.ok) {
          const err = await res.text();
          setStatus(err ? `Error: ${err.slice(0, 160)}` : "Sync failed.");
          return;
        }
        const json = (await res.json()) as { reels_processed?: number; competitors_attempted?: number };
        const br = json.reels_processed ?? 0;
        const nc = json.competitors_attempted ?? 0;
        setStatus(
          mode === "both"
            ? `Done — competitor reels updated (${br} reels, ${nc} accounts).`
            : `Done — ${br} reels (${nc} accounts).`,
        );
        router.refresh();
        return;
      }
    } catch {
      setStatus("Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  const title =
    disabledHint?.trim() ||
    (mode === "own"
      ? "Sync only your Instagram reels."
      : mode === "competitors"
        ? "Sync reels for every competitor."
        : "Sync your reels, then every competitor’s reels.");

  const label =
    mode === "own" ? "Sync your reels" : mode === "competitors" ? "Sync competitor reels" : "Sync your reels and competitors";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy || disabled || !clientSlug.trim() || !orgSlug.trim()}
        title={title}
        aria-label={label}
        onClick={() => void runSync()}
        className={INTELLIGENCE_SECTION_SYNC_ICON_CLASS}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
      </button>
      {status ? (
        <p className="max-w-[14rem] text-right text-[10px] leading-snug text-app-fg-muted" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
