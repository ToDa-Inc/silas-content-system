"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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

function useFakeProgress(active: boolean, fromPct: number, toPct: number) {
  const [pct, setPct] = useState(fromPct);
  useEffect(() => {
    if (!active) {
      setPct(fromPct);
      return;
    }
    setPct(fromPct);
    const start = Date.now();
    const span = toPct - fromPct;
    const iv = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / 12000);
      const eased = 1 - Math.exp(-3 * t);
      setPct(fromPct + span * eased);
    }, 160);
    return () => clearInterval(iv);
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
  const [mode, setMode] = useState<SyncMode>("own");
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

  useEffect(() => {
    if (!busy) return;
    if (progressPhase === "own") setProgressPct(animOwn);
    else if (progressPhase === "competitors") setProgressPct(animComp);
    else setProgressPct(0);
  }, [busy, progressPhase, animOwn, animComp]);

  useEffect(() => {
    if (!open && !busy) {
      setError(null);
      setProgressLabel("");
      setProgressPct(0);
      setProgressStatus(null);
      setProgressPhase("idle");
      setMode("own");
    }
  }, [open, busy]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, busy, onClose]);

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

  async function runCompetitors(): Promise<boolean> {
    const apiBase = getContentApiBase();
    const headers = await clientApiHeaders({ orgSlug });
    const res = await contentApiFetch(
      `${apiBase}/api/v1/clients/${encodeURIComponent(clientSlug)}/sync/competitors`,
      { method: "POST", headers },
    );
    if (res.status === 409) {
      setError("A competitor sync is already running — please wait.");
      return false;
    }
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { detail?: unknown };
      setError(formatFastApiError(json, await res.text().catch(() => "Sync failed")));
      return false;
    }
    return true;
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

    const finishOk = () => {
      setProgressPct(100);
      setProgressStatus("completed");
      router.refresh();
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
        setProgressLabel("Pulling your latest reels from Instagram…");
        const ok = await runOwn();
        if (!ok) {
          setProgressStatus("failed");
          setBusy(false);
          setProgressPhase("idle");
          return;
        }
        setProgressLabel("Done — your reels are up to date.");
        onSyncMessage?.("Your reels were refreshed.");
        finishOk();
        return;
      }

      if (mode === "competitors") {
        setProgressPhase("competitors");
        setProgressPct(0);
        setProgressLabel("Syncing all tracked creators…");
        const ok = await runCompetitors();
        if (!ok) {
          setProgressStatus("failed");
          setBusy(false);
          setProgressPhase("idle");
          return;
        }
        setProgressLabel("Done — competitor reels updated.");
        onSyncMessage?.("Tracked creators’ reels were refreshed.");
        finishOk();
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
      setProgressLabel("Step 2 of 2 — all tracked creators…");
      const compOk = await runCompetitors();
      if (!compOk) {
        setProgressStatus("failed");
        setBusy(false);
        setProgressPhase("idle");
        return;
      }
      setProgressLabel("Done — your reels and all creators are up to date.");
      onSyncMessage?.("Full update finished (your reels + all creators).");
      finishOk();
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
      onClick={() => !busy && onClose()}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-zinc-200/90 bg-zinc-50 p-5 shadow-2xl dark:border-white/12 dark:bg-zinc-950/95"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h2 id="sync-data-title" className="text-sm font-semibold text-zinc-900 dark:text-app-fg">
              Update data
            </h2>
            <p className="mt-1 text-[11px] text-zinc-600 dark:text-app-fg-subtle">
              Refresh metrics for the creator selected in the sidebar. This uses your Instagram handle
              and tracked accounts — it can take from under a minute to several minutes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose()}
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
              percent={progressPct}
              status={progressStatus}
            />
          </div>
        ) : (
          <fieldset className="mb-4 space-y-3" disabled={busy}>
            <legend className="sr-only">What to sync</legend>
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
                  Pull your latest posts from Instagram so the dashboard and charts stay current.
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
                  Update reels for every competitor you follow (does not refresh your own profile).
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer gap-3 rounded-xl border border-zinc-200/90 p-3 dark:border-white/10 dark:hover:bg-white/[0.03]">
              <input
                type="radio"
                name="sync-mode"
                checked={mode === "both"}
                onChange={() => setMode("both")}
                className="mt-1 border-zinc-300 text-amber-600 dark:border-white/20"
              />
              <span>
                <span className="text-sm font-semibold text-zinc-900 dark:text-app-fg">
                  Both
                </span>
                <span className="mt-0.5 block text-[11px] text-zinc-600 dark:text-app-fg-muted">
                  Your reels first, then all tracked creators (longest run).
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
              Start update
            </button>
            <button
              type="button"
              onClick={() => onClose()}
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
