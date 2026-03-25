"use client";

import { useToast } from "@/components/ui/toast-provider";

export function DashboardExportLogsButton() {
  const { show } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        show("Activity log export queued — you’ll get a CSV when the pipeline supports it.", "success")
      }
      className="text-sm font-semibold text-app-accent transition-colors hover:text-app-accent-bright"
    >
      Export logs
    </button>
  );
}

export function DashboardViewConflictButton() {
  const { show } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        show("Resolve the brand vs. request conflict in Settings → guidelines, then retry generation.")
      }
      className="ml-auto text-[10px] font-bold uppercase tracking-wide text-app-accent underline-offset-2 hover:underline"
    >
      View conflict
    </button>
  );
}

export function DashboardContextRefreshButton() {
  const { show } = useToast();
  return (
    <button
      type="button"
      onClick={() => show("Context library sync started — new clusters appear after the next ingest job.", "success")}
      className="w-full rounded-xl border border-app-card-border bg-app-chip-bg py-3 text-sm font-semibold text-app-fg transition-colors hover:bg-app-chip-bg-hover"
    >
      Update context library
    </button>
  );
}

export function DashboardUpgradeCta() {
  const { show } = useToast();
  return (
    <button
      type="button"
      onClick={() => show("Billing isn’t wired yet — we’ll notify you when advanced models are available.")}
      className="rounded-lg bg-white/20 px-4 py-2 text-xs font-bold backdrop-blur-md transition-all hover:bg-white/30 active:scale-[0.98]"
    >
      Upgrade now
    </button>
  );
}
