"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Radar } from "lucide-react";
import {
  clientApiHeaders,
  contentApiFetch,
  formatFastApiError,
  getContentApiBase,
} from "@/lib/api-client";
import { INTELLIGENCE_TOOLBAR_ICON_CLASS } from "./intelligence-toolbar-styles";

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
  onMessage?: (message: string, tone: "neutral" | "success" | "error") => void;
};

type JobRow = {
  status?: string;
  error_message?: string | null;
  result?: { reels_upserted?: number; phase?: string; enriched_count?: number };
};

const POLL_MS = 4000;
const MAX_POLLS = 180;

/** Queue niche keyword reel scrape (parallel to competitors); worker fills scraped_reels. */
export function NicheReelScrapeButton({
  clientSlug,
  orgSlug,
  disabled,
  disabledHint,
  onMessage,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const title =
    disabledHint?.trim() ||
    "Find reels that match your niche keywords on Instagram and save them to Intelligence. Runs in the background and can take several minutes.";

  async function run() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      onMessage?.(
        disabledHint?.trim() ||
          (!orgSlug.trim()
            ? "No organization context — refresh the page."
            : "Select a creator in the header first."),
        "error",
      );
      return;
    }
    setBusy(true);
    onMessage?.("Queuing niche reel scrape…", "neutral");
    try {
      const apiBase = getContentApiBase();
      const headers = await clientApiHeaders({ orgSlug });
      const postRes = await contentApiFetch(
        `${apiBase}/api/v1/clients/${encodeURIComponent(clientSlug)}/niche-reels/scrape`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const postJson = (await postRes.json().catch(() => ({}))) as {
        job_id?: string;
        detail?: unknown;
      };

      if (postRes.status === 409) {
        onMessage?.("A niche scrape is already running — wait for it to finish.", "error");
        setBusy(false);
        return;
      }
      if (postRes.status === 503) {
        onMessage?.("Keyword search isn’t available on the server right now — contact support.", "error");
        setBusy(false);
        return;
      }
      if (!postRes.ok) {
        onMessage?.(formatFastApiError(postJson as Record<string, unknown>, "Request failed"), "error");
        setBusy(false);
        return;
      }

      const jobId = postJson.job_id;
      if (!jobId) {
        onMessage?.("No job_id returned from server.", "error");
        setBusy(false);
        return;
      }

      onMessage?.("Niche scrape running — searching keywords and fetching reels…", "neutral");

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const jRes = await contentApiFetch(`${apiBase}/api/v1/jobs/${encodeURIComponent(jobId)}`, {
          headers,
        });
        const job = (await jRes.json().catch(() => ({}))) as JobRow;

        if (!jRes.ok) {
          onMessage?.(
            formatFastApiError(job as unknown as Record<string, unknown>, "Could not load job status"),
            "error",
          );
          setBusy(false);
          return;
        }

        if (job.status === "failed") {
          onMessage?.(job.error_message || "Niche reel scrape failed.", "error");
          setBusy(false);
          return;
        }

        if (job.status === "completed") {
          const n = job.result?.reels_upserted;
          onMessage?.(
            typeof n === "number"
              ? `Niche scrape done — ${n} reel(s) saved. Refreshing…`
              : "Niche scrape done. Refreshing…",
            "success",
          );
          router.refresh();
          setBusy(false);
          return;
        }
      }

      onMessage?.(
        "Still running in the background (polling timed out). Refresh Intelligence in a few minutes.",
        "neutral",
      );
      setBusy(false);
    } catch {
      onMessage?.("Something went wrong — try again.", "error");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={disabled || !clientSlug.trim() || !orgSlug.trim() || busy}
      title={title}
      aria-label="Scrape niche reels from keywords"
      onClick={() => void run()}
      className={INTELLIGENCE_TOOLBAR_ICON_CLASS}
    >
      {busy ? (
        <Loader2 className="h-5 w-5 animate-spin shrink-0" aria-hidden />
      ) : (
        <Radar className="h-5 w-5 shrink-0" aria-hidden />
      )}
    </button>
  );
}
