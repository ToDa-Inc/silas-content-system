"use client";

/** Shared progress UI — reels bulk analysis, sync modal, etc. */
export function IntelligenceProgressBar({
  label,
  percent,
  status,
  staleHint,
  onDismissStale,
}: {
  label: string;
  percent: number;
  status: "running" | "queued" | "completed" | "failed" | null;
  staleHint?: boolean;
  onDismissStale?: () => void;
}) {
  const barPct = Math.min(100, Math.max(0, percent));
  const pulse =
    status === "running" || status === "queued" || (status === null && barPct > 0 && barPct < 100);

  return (
    <div
      className="rounded-lg border border-zinc-200/90 bg-white/90 px-3 py-2.5 dark:border-white/10 dark:bg-zinc-900/70"
      role="status"
      aria-live="polite"
    >
      {staleHint && onDismissStale ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-amber-800 dark:text-amber-200/90">
          <span>
            This run is taking unusually long — it may have stalled. You can dismiss and refresh
            later.
          </span>
          <button
            type="button"
            onClick={onDismissStale}
            className="font-semibold text-amber-700 underline hover:no-underline dark:text-amber-300"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-zinc-600 dark:text-app-fg-muted">
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 tabular-nums text-zinc-500 dark:text-app-fg-faint">
          {Math.round(barPct)}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-200/90 dark:bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-200 ease-out ${
            status === "failed"
              ? "bg-red-500/90"
              : status === "completed"
                ? "bg-emerald-500"
                : "bg-amber-500"
          } ${pulse ? "animate-pulse" : ""}`}
          style={{ width: `${barPct}%` }}
        />
      </div>
    </div>
  );
}
