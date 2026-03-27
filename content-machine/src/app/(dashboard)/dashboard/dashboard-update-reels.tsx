"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { SyncDataModal } from "@/app/(dashboard)/intelligence/components/sync-data-modal";

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
};

/** Same update flow as Intelligence toolbar — exposed on the dashboard. */
export function DashboardUpdateReels({ clientSlug, orgSlug, disabled, disabledHint }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  return (
    <div className="flex w-full flex-col gap-1 sm:w-auto sm:items-end">
      <SyncDataModal
        open={open}
        onClose={() => setOpen(false)}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
        disabled={disabled}
        disabledHint={disabledHint}
        onSyncMessage={setStatus}
      />
      <button
        type="button"
        disabled={disabled || !clientSlug.trim() || !orgSlug.trim()}
        title={
          disabledHint?.trim() ??
          "Pull your latest reels from Instagram and optionally refresh tracked creators."
        }
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-app-card-border bg-app-chip-bg px-4 py-2.5 text-xs font-semibold text-app-fg shadow-sm transition-colors hover:bg-app-chip-bg-hover sm:w-auto"
      >
        <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Update my reels
      </button>
      {status ? (
        <p className="text-right text-[10px] leading-snug text-app-fg-muted sm:max-w-[14rem]" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
