"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import {
  clientApiHeaders,
  contentApiFetch,
  formatFastApiError,
  getContentApiBase,
} from "@/lib/api-client";
import { AnalyzeReelTrigger } from "./analyze-reel-trigger";
import { NicheReelScrapeButton } from "./niche-reel-scrape-button";
import {
  INTELLIGENCE_TOOLBAR_ICON_CLASS,
  INTELLIGENCE_TOOLBAR_SYNC_LABELED_CLASS,
} from "./intelligence-toolbar-styles";

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
  /** Icon + “Sync” label (e.g. Intelligence → Reels). */
  showSyncLabel?: boolean;
};

type SyncAllJson = {
  baseline?: { error?: string } | Record<string, unknown>;
  competitors_attempted?: number;
  competitor_reels_processed?: number | null;
  competitor_sync_mode?: string;
  competitor_sync_message?: string;
};

function apifyErrorHint(baselineErr: string): string {
  const t = baselineErr.toLowerCase();
  if (t.includes("403") || t.includes("forbidden")) {
    return " Check APIFY_API_TOKEN on the API server (Apify → Settings → Integrations) and that your Apify account has credits.";
  }
  if (t.includes("401") || t.includes("unauthorized")) {
    return " Check APIFY_API_TOKEN — it may be invalid or revoked.";
  }
  return "";
}

export function IntelligenceToolbar({
  clientSlug,
  orgSlug,
  disabled,
  disabledHint,
  showSyncLabel = false,
}: Props) {
  const router = useRouter();
  const [toolbarMessage, setToolbarMessage] = useState<string | null>(null);
  const [toolbarTone, setToolbarTone] = useState<"neutral" | "success" | "error">("neutral");
  const [syncing, setSyncing] = useState(false);

  const syncTitle =
    disabledHint?.trim() ||
    "Full sync: your Instagram reels plus every tracked competitor (Apify). Competitor scrapes run in the background on the API.";

  async function runFullSync() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      setToolbarTone("error");
      setToolbarMessage(
        disabledHint?.trim() ||
          (!orgSlug.trim()
            ? "No organization context — refresh the page."
            : "Select a creator in the header first."),
      );
      return;
    }
    setSyncing(true);
    setToolbarTone("neutral");
    setToolbarMessage("Syncing your reels and all competitors…");
    try {
      const apiBase = getContentApiBase();
      const headers = await clientApiHeaders({ orgSlug });
      const res = await contentApiFetch(
        `${apiBase}/api/v1/clients/${encodeURIComponent(clientSlug)}/sync`,
        { method: "POST", headers },
      );
      if (res.status === 409) {
        setToolbarTone("error");
        setToolbarMessage("A sync is already running — wait and try again.");
        return;
      }
      if (res.status === 503) {
        const t = await res.text();
        setToolbarTone("error");
        setToolbarMessage(
          t.toLowerCase().includes("apify")
            ? "Apify is not configured on the API."
            : t.slice(0, 200),
        );
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "Sync failed");
        let json: { detail?: unknown } = {};
        try {
          json = JSON.parse(text) as { detail?: unknown };
        } catch {
          /* plain text error */
        }
        setToolbarTone("error");
        setToolbarMessage(formatFastApiError(json, text.slice(0, 200)));
        return;
      }
      const json = (await res.json()) as SyncAllJson;
      const parts: string[] = [];
      const baselineErr =
        json.baseline && typeof json.baseline === "object" && "error" in json.baseline
          ? String((json.baseline as { error?: string }).error || "").trim()
          : "";
      if (baselineErr) {
        parts.push(
          `Your reels: ${baselineErr.slice(0, 220)}${apifyErrorHint(baselineErr)}`,
        );
      } else {
        parts.push("Your reels were refreshed.");
      }

      const mode = json.competitor_sync_mode;
      const n = json.competitors_attempted ?? 0;
      const apiMsg =
        typeof json.competitor_sync_message === "string" ? json.competitor_sync_message.trim() : "";

      if (mode === "skipped_locked") {
        parts.push("Competitors: a bulk sync was already running — skipped duplicate start.");
      } else if (mode === "background") {
        if (n > 0) {
          parts.push(
            `Competitor scrapes started in the background (${n} accounts). Refresh in a few minutes for new metrics.`,
          );
        } else {
          parts.push(apiMsg || "No competitors to sync.");
        }
      } else if (mode === "queued") {
        parts.push("Competitor jobs were queued — ensure the worker is running.");
      } else {
        parts.push(apiMsg || "Competitor sync finished.");
      }

      const apifyAuthFail =
        !!baselineErr && /403|401|forbidden|unauthorized/i.test(baselineErr);
      setToolbarTone(baselineErr ? (apifyAuthFail ? "error" : "neutral") : "success");
      setToolbarMessage(parts.join(" "));
      router.refresh();
    } catch {
      setToolbarTone("error");
      setToolbarMessage("Something went wrong — try again.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div
        className="inline-flex items-center gap-1 rounded-2xl border border-zinc-200/90 bg-zinc-50/95 p-1 shadow-sm dark:border-white/10 dark:bg-zinc-950/70"
        role="toolbar"
        aria-label="Intelligence actions"
      >
        <button
          type="button"
          disabled={disabled || !clientSlug.trim() || !orgSlug.trim() || syncing}
          title={syncTitle}
          aria-label={showSyncLabel ? "Sync — your reels and all competitors" : "Full sync — your reels and all competitors"}
          onClick={() => void runFullSync()}
          className={showSyncLabel ? INTELLIGENCE_TOOLBAR_SYNC_LABELED_CLASS : INTELLIGENCE_TOOLBAR_ICON_CLASS}
        >
          {syncing ? (
            <Loader2 className="h-5 w-5 animate-spin shrink-0" aria-hidden />
          ) : (
            <RefreshCw className="h-5 w-5 shrink-0" aria-hidden />
          )}
          {showSyncLabel ? <span>Sync</span> : null}
        </button>
        <NicheReelScrapeButton
          clientSlug={clientSlug}
          orgSlug={orgSlug}
          disabled={disabled}
          disabledHint={disabledHint}
          onMessage={(msg, tone) => {
            setToolbarMessage(msg);
            setToolbarTone(tone);
          }}
        />
        <AnalyzeReelTrigger
          clientSlug={clientSlug}
          orgSlug={orgSlug}
          disabled={disabled}
          disabledHint={disabledHint}
        />
      </div>
      {toolbarMessage ? (
        <p
          className={
            toolbarTone === "error"
              ? "max-w-[min(100%,22rem)] text-right text-[10px] leading-snug text-red-600 dark:text-red-400"
              : toolbarTone === "success"
                ? "max-w-[min(100%,22rem)] text-right text-[10px] leading-snug text-emerald-700 dark:text-emerald-400"
                : "max-w-[min(100%,22rem)] text-right text-[10px] leading-snug text-zinc-600 dark:text-app-fg-muted"
          }
          role="status"
        >
          {toolbarMessage}
        </p>
      ) : null}
    </div>
  );
}
