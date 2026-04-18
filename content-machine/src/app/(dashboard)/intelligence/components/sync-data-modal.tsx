"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import {
  clientApiHeaders,
  contentApiFetch,
  formatFastApiError,
  getContentApiBase,
} from "@/lib/api-client";
import { IntelligenceProgressBar } from "./intelligence-progress-bar";

type SyncMode = "own" | "competitors" | "both";

type Props = {
  open: boolean;
  onClose: () => void;
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
  onSyncMessage?: (msg: string | null) => void;
};

/**
 * Window-level event fired after any successful sync (incl. recompute).
 * Listened to by `WhatHappenedSection` so its 3-min cache invalidates
 * immediately — no more stale activity after the user clicks Sync.
 */
export const SYNC_COMPLETED_EVENT = "silas:intelligence-synced";

function dispatchSyncCompleted() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SYNC_COMPLETED_EVENT, { detail: { ts: Date.now() } }));
}

/** Always run after a successful sync — re-flags outliers from stored data. Silent. */
async function runRecomputeBreakouts(clientSlug: string, orgSlug: string): Promise<void> {
  try {
    const apiBase = getContentApiBase();
    const headers = await clientApiHeaders({ orgSlug });
    await contentApiFetch(
      `${apiBase}/api/v1/clients/${encodeURIComponent(clientSlug)}/recompute-breakouts`,
      { method: "POST", headers },
    );
  } catch {
    /* recompute is a best-effort cleanup step — silent on failure */
  }
}

/** Optional add-on: kick off a niche keyword scrape in the background. */
async function startNicheScrape(clientSlug: string, orgSlug: string): Promise<boolean> {
  try {
    const apiBase = getContentApiBase();
    const headers = await clientApiHeaders({ orgSlug });
    const res = await contentApiFetch(
      `${apiBase}/api/v1/clients/${encodeURIComponent(clientSlug)}/niche-reels/scrape`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

function useFakeProgress(active: boolean, fromPct: number, toPct: number) {
  const [pct, setPct] = useState(fromPct);
  useEffect(() => {
    if (!active) {
      return;
    }
    const start = Date.now();
    const span = toPct - fromPct;
    let raf = 0;
    const iv = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / 12000);
      const eased = 1 - Math.exp(-3 * t);
      setPct(fromPct + span * eased);
    }, 160);
    raf = requestAnimationFrame(() => setPct(fromPct));
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(iv);
    };
  }, [active, fromPct, toPct]);
  return active ? Math.min(toPct, pct) : fromPct;
}

export function SyncDataModal({
  open,
  onClose,
  clientSlug,
  orgSlug,
  disabled,
  disabledHint,
  onSyncMessage,
}: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<SyncMode>("both");
  const [includeNiche, setIncludeNiche] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState("");
  const [progressPct, setProgressPct] = useState(0);
  const [progressStatus, setProgressStatus] = useState<
    "running" | "completed" | "failed" | null
  >(null);
  const [progressPhase, setProgressPhase] = useState<"idle" | "own" | "competitors">("idle");

  const animOwn = useFakeProgress(busy && progressPhase === "own", 0, 42);
  const animComp = useFakeProgress(busy && progressPhase === "competitors", 45, 93);

  const barPercent =
    busy && progressPhase === "own"
      ? animOwn
      : busy && progressPhase === "competitors"
        ? animComp
        : progressPct;

  const closeModal = useCallback(() => {
    if (busy) return;
    setError(null);
    setProgressLabel("");
    setProgressPct(0);
    setProgressStatus(null);
    setProgressPhase("idle");
    setMode("both");
    setIncludeNiche(false);
    onClose();
  }, [busy, onClose]);

  useEffect(() => {
    if (open || busy) return;
    const raf = requestAnimationFrame(() => {
      setError(null);
      setProgressLabel("");
      setProgressPct(0);
      setProgressStatus(null);
      setProgressPhase("idle");
      setMode("both");
      setIncludeNiche(false);
    });
    return () => cancelAnimationFrame(raf);
  }, [open, busy]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) closeModal();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, busy, closeModal]);

  async function runOwn(): Promise<boolean> {
    const apiBase = getContentApiBase();
    const headers = await clientApiHeaders({ orgSlug });
    const res = await contentApiFetch(
      `${apiBase}/api/v1/clients/${encodeURIComponent(clientSlug)}/sync/own`,
      { method: "POST", headers },
    );
    if (res.status === 409) {
      setError("A sync for your reels is already running — please wait.");
      return false;
    }
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { detail?: unknown };
      setError(formatFastApiError(json, await res.text().catch(() => "Sync failed")));
      return false;
    }
    return true;
  }

  async function runCompetitors(): Promise<{
    ok: boolean;
    queued?: boolean;
    background?: boolean;
  }> {
    const apiBase = getContentApiBase();
    const headers = await clientApiHeaders({ orgSlug });
    const res = await contentApiFetch(
      `${apiBase}/api/v1/clients/${encodeURIComponent(clientSlug)}/sync/competitors`,
      { method: "POST", headers },
    );
    if (res.status === 409) {
      setError("A competitor sync is already running — wait a few minutes and try again.");
      return { ok: false };
    }
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { detail?: unknown };
      setError(formatFastApiError(json, await res.text().catch(() => "Sync failed")));
      return { ok: false };
    }
    const json = (await res.json().catch(() => ({}))) as { mode?: string };
    return {
      ok: true,
      queued: json.mode === "queued",
      background: json.mode === "background",
    };
  }

  async function startSync() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      setError(
        disabledHint?.trim() ||
          (!orgSlug.trim()
            ? "No organization context — refresh the page or sign in again."
            : "Select a creator in the header first."),
      );
      return;
    }
    setBusy(true);
    setError(null);
    setProgressStatus("running");
    onSyncMessage?.(null);

    const finishOk = async (extraNote?: string) => {
      setProgressPct(96);
      // Always refresh outlier flags from the freshly-synced rows. Silent + fast.
      await runRecomputeBreakouts(clientSlug, orgSlug);
      // Optional add-on. Fire-and-forget; the user already knows it runs in background.
      if (includeNiche) {
        void startNicheScrape(clientSlug, orgSlug);
      }
      setProgressPct(100);
      setProgressStatus("completed");
      // Tell every interested client component that fresh data is live — invalidates
      // the 3-min activity cache in WhatHappenedSection so the UI updates immediately.
      dispatchSyncCompleted();
      router.refresh();
      if (extraNote) onSyncMessage?.(extraNote);
      setTimeout(() => {
        onClose();
        setBusy(false);
        setProgressStatus(null);
        setProgressPhase("idle");
      }, 850);
    };

    try {
      if (mode === "own") {
        setProgressPhase("own");
        setProgressLabel("Refreshing your reels…");
        const ok = await runOwn();
        if (!ok) {
          setProgressStatus("failed");
          setBusy(false);
          setProgressPhase("idle");
          return;
        }
        setProgressLabel("Done — your reels are up to date.");
        onSyncMessage?.("Your reels were refreshed.");
        await finishOk();
        return;
      }

      if (mode === "competitors") {
        setProgressPhase("competitors");
        setProgressPct(0);
        setProgressLabel("Refreshing tracked creators…");
        const comp = await runCompetitors();
        if (!comp.ok) {
          setProgressStatus("failed");
          setBusy(false);
          setProgressPhase("idle");
          return;
        }
        if (comp.background) {
          setProgressLabel("Refresh started — running in the background.");
          onSyncMessage?.(
            "Tracked creators continue refreshing — check back in a few minutes for new reels.",
          );
        } else if (comp.queued) {
          setProgressLabel("Refresh queued.");
          onSyncMessage?.("Tracked creator refresh was queued.");
        } else {
          setProgressLabel("Done — tracked creators are up to date.");
          onSyncMessage?.("Tracked creators were refreshed.");
        }
        await finishOk();
        return;
      }

      /* both */
      setProgressPhase("own");
      setProgressLabel("Step 1 of 2 — your reels…");
      const ownOk = await runOwn();
      if (!ownOk) {
        setProgressStatus("failed");
        setBusy(false);
        setProgressPhase("idle");
        return;
      }
      setProgressPct(45);
      setProgressPhase("competitors");
      setProgressLabel("Step 2 of 2 — tracked creators…");
      const comp = await runCompetitors();
      if (!comp.ok) {
        setProgressStatus("failed");
        setBusy(false);
        setProgressPhase("idle");
        return;
      }
      if (comp.background) {
        setProgressLabel("Done — your reels are fresh. Tracked creators continue in the background.");
        onSyncMessage?.(
          "Your reels are up to date. Tracked creators continue refreshing — check back in a few minutes.",
        );
      } else if (comp.queued) {
        setProgressLabel("Done — your reels are fresh. Refresh queued for tracked creators.");
        onSyncMessage?.("Your reels are up to date. Tracked creator refresh was queued.");
      } else {
        setProgressLabel("Done — everything is up to date.");
        onSyncMessage?.("Your reels and tracked creators are up to date.");
      }
      await finishOk();
    } catch {
      setError("Something went wrong — try again.");
      setProgressStatus("failed");
      setBusy(false);
      setProgressPhase("idle");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm dark:bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-data-title"
      onClick={() => closeModal()}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-zinc-200/90 bg-zinc-50 p-5 shadow-2xl dark:border-white/12 dark:bg-zinc-950/95"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h2 id="sync-data-title" className="text-sm font-semibold text-zinc-900 dark:text-app-fg">
              Sync
            </h2>
            <p className="mt-1 text-[11px] text-zinc-600 dark:text-app-fg-subtle">
              Pull fresh metrics for the active creator. Takes anywhere from a minute to several.
            </p>
          </div>
          <button
            type="button"
            onClick={() => closeModal()}
            disabled={busy}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-200/80 disabled:opacity-40 dark:text-app-fg-subtle dark:hover:bg-white/10"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {busy ? (
          <div className="mb-4">
            <IntelligenceProgressBar
              label={progressLabel}
              percent={barPercent}
              status={progressStatus}
            />
          </div>
        ) : (
          <fieldset className="mb-4 space-y-3" disabled={busy}>
            <legend className="sr-only">What to sync</legend>
            <label
              className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${
                mode === "both"
                  ? "border-amber-500/60 bg-amber-500/5 dark:border-amber-500/40 dark:bg-amber-500/[0.04]"
                  : "border-zinc-200/90 dark:border-white/10 dark:hover:bg-white/[0.03]"
              }`}
            >
              <input
                type="radio"
                name="sync-mode"
                checked={mode === "both"}
                onChange={() => setMode("both")}
                className="mt-1 border-zinc-300 text-amber-600 dark:border-white/20"
              />
              <span>
                <span className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-app-fg">
                  Everything
                  <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                    Recommended
                  </span>
                </span>
                <span className="mt-0.5 block text-[11px] text-zinc-600 dark:text-app-fg-muted">
                  Your reels and every tracked creator. Longest, but full picture.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer gap-3 rounded-xl border border-zinc-200/90 p-3 dark:border-white/10 dark:hover:bg-white/[0.03]">
              <input
                type="radio"
                name="sync-mode"
                checked={mode === "own"}
                onChange={() => setMode("own")}
                className="mt-1 border-zinc-300 text-amber-600 dark:border-white/20"
              />
              <span>
                <span className="text-sm font-semibold text-zinc-900 dark:text-app-fg">
                  My reels only
                </span>
                <span className="mt-0.5 block text-[11px] text-zinc-600 dark:text-app-fg-muted">
                  Just refresh the active creator&apos;s own reels.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer gap-3 rounded-xl border border-zinc-200/90 p-3 dark:border-white/10 dark:hover:bg-white/[0.03]">
              <input
                type="radio"
                name="sync-mode"
                checked={mode === "competitors"}
                onChange={() => setMode("competitors")}
                className="mt-1 border-zinc-300 text-amber-600 dark:border-white/20"
              />
              <span>
                <span className="text-sm font-semibold text-zinc-900 dark:text-app-fg">
                  Tracked creators only
                </span>
                <span className="mt-0.5 block text-[11px] text-zinc-600 dark:text-app-fg-muted">
                  Just refresh the competitors you follow.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-dashed border-zinc-300/80 px-3 py-2.5 dark:border-white/12">
              <input
                type="checkbox"
                checked={includeNiche}
                onChange={(e) => setIncludeNiche(e.target.checked)}
                className="mt-1 rounded border-zinc-300 text-amber-600 dark:border-white/20"
              />
              <span>
                <span className="text-[12px] font-semibold text-zinc-900 dark:text-app-fg">
                  Also pull niche keyword reels
                </span>
                <span className="mt-0.5 block text-[11px] text-zinc-600 dark:text-app-fg-muted">
                  Search Instagram for trending posts matching this creator&apos;s niche. Heavier — runs in the background.
                </span>
              </span>
            </label>
          </fieldset>
        )}

        {error ? (
          <p className="mb-3 text-xs text-amber-800 dark:text-amber-200/90" role="alert">
            {error}
          </p>
        ) : null}

        {!busy ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => void startSync()}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-zinc-950 disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Sync now
            </button>
            <button
              type="button"
              onClick={() => closeModal()}
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200/90 px-4 py-2.5 text-xs font-semibold text-zinc-800 dark:border-white/15 dark:text-app-fg dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        ) : progressStatus === "failed" ? (
          <button
            type="button"
            onClick={() => {
              setBusy(false);
              setProgressStatus(null);
              setProgressPhase("idle");
            }}
            className="w-full rounded-xl border border-zinc-200/90 py-2.5 text-xs font-semibold dark:border-white/15"
          >
            Back
          </button>
        ) : progressStatus === "completed" ? (
          <div className="flex items-center justify-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Closing…
          </div>
        ) : null}
      </div>
    </div>
  );
}
