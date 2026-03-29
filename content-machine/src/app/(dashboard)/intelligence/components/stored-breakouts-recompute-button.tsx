"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { clientApiHeaders, contentApiFetch, getContentApiBase } from "@/lib/api-client";
import { INTELLIGENCE_SECTION_SYNC_ICON_CLASS } from "./intelligence-toolbar-styles";

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
  ariaLabel?: string;
  titleOverride?: string;
  /** Run after successful recompute (e.g. refetch client-side activity). */
  onAfterSuccess?: () => void;
};

/**
 * POST /recompute-breakouts only — updates flags from scraped_reels in DB (no Apify).
 */
export function StoredBreakoutsRecomputeButton({
  clientSlug,
  orgSlug,
  disabled,
  disabledHint,
  ariaLabel,
  titleOverride,
  onAfterSuccess,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [tone, setTone] = useState<"neutral" | "success" | "error">("neutral");

  async function runRecompute() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) return;
    setBusy(true);
    setStatus(null);
    setTone("neutral");
    try {
      const apiBase = getContentApiBase();
      const headers = await clientApiHeaders({ orgSlug });
      const res = await contentApiFetch(
        `${apiBase}/api/v1/clients/${encodeURIComponent(clientSlug)}/recompute-breakouts`,
        { method: "POST", headers },
      );
      if (!res.ok) {
        const t = await res.text();
        setTone("error");
        setStatus(t ? t.slice(0, 180) : "Could not recalculate.");
        return;
      }
      const json = (await res.json()) as {
        reels_updated?: number;
        competitors_updated?: number;
        threshold?: number;
      };
      setTone("success");
      const ru = json.reels_updated ?? 0;
      const cu = json.competitors_updated ?? 0;
      setStatus(
        `Updated ${ru} reel(s) across ${cu} competitor account(s) (threshold ${json.threshold ?? 5}×).`,
      );
      onAfterSuccess?.();
      router.refresh();
    } catch {
      setTone("error");
      setStatus("Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  const title =
    titleOverride?.trim() ||
    disabledHint?.trim() ||
    "Refresh breakout flags from stored competitor reels (no live Instagram fetch).";

  const label = ariaLabel ?? "Refresh from stored data";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy || disabled}
        title={title}
        aria-label={label}
        onClick={() => void runRecompute()}
        className={INTELLIGENCE_SECTION_SYNC_ICON_CLASS}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="h-4 w-4" aria-hidden />
        )}
      </button>
      {status ? (
        <p
          className={
            tone === "error"
              ? "max-w-[min(22rem,92vw)] text-right text-[10px] text-red-600 dark:text-red-400"
              : tone === "success"
                ? "max-w-[min(22rem,92vw)] text-right text-[10px] text-emerald-700 dark:text-emerald-400"
                : "max-w-[min(22rem,92vw)] text-right text-[10px] text-app-fg-muted"
          }
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}
