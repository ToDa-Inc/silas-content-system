"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { SyncDataModal } from "./sync-data-modal";

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
  /** ISO timestamp of the last successful baseline sync, or null if never synced. */
  lastSyncedAt?: string | null;
};

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function formatRelativeAgo(iso: string, now: number): string | null {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  const diffMs = now - ts;
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function IntelligenceToolbar({
  clientSlug,
  orgSlug,
  disabled,
  disabledHint,
  lastSyncedAt,
}: Props) {
  const [open, setOpen] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  // Resolved on the client to avoid SSR/CSR drift, then re-ticked every minute so the
  // "X min ago" label stays honest while the page is open.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const tsParsed = lastSyncedAt ? Date.parse(lastSyncedAt) : NaN;
  const ago = lastSyncedAt && now != null ? formatRelativeAgo(lastSyncedAt, now) : null;
  const stale =
    Number.isFinite(tsParsed) && now != null ? now - tsParsed > STALE_AFTER_MS : false;

  const buttonTitle =
    disabledHint?.trim() ||
    "Pull fresh metrics for this creator and every tracked competitor.";

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        disabled={disabled || !clientSlug.trim() || !orgSlug.trim()}
        title={buttonTitle}
        aria-label="Sync data"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 min-w-[6.5rem] items-center justify-center gap-2 rounded-xl border border-amber-500/50 bg-white px-4 text-sm font-semibold text-amber-800 shadow-sm outline-none transition-colors hover:border-amber-500/70 hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:bg-zinc-900/90 dark:text-amber-300 dark:hover:bg-amber-500/10 dark:focus-visible:ring-offset-zinc-950 disabled:pointer-events-none disabled:opacity-45"
      >
        <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
        Sync
      </button>
      {ago ? (
        <p
          className={
            stale
              ? "text-[10px] leading-snug text-amber-700 dark:text-amber-400"
              : "text-[10px] leading-snug text-app-fg-muted"
          }
          aria-label={`Last synced ${ago}`}
        >
          {stale ? `Last synced ${ago} — out of date` : `Last synced ${ago}`}
        </p>
      ) : !disabled && clientSlug.trim() ? (
        <p className="text-[10px] leading-snug text-app-fg-muted">Never synced</p>
      ) : null}
      {statusMsg ? (
        <p
          className="max-w-[min(100%,22rem)] text-right text-[10px] leading-snug text-app-fg-muted"
          role="status"
        >
          {statusMsg}
        </p>
      ) : null}
      <SyncDataModal
        open={open}
        onClose={() => setOpen(false)}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
        disabled={disabled}
        disabledHint={disabledHint}
        onSyncMessage={setStatusMsg}
      />
    </div>
  );
}
