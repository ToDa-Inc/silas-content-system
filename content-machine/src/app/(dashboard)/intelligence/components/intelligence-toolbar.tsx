"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { AddCompetitorButton } from "./add-competitor-button";
import { AnalyzeReelTrigger } from "./analyze-reel-trigger";
import { INTELLIGENCE_TOOLBAR_ICON_CLASS } from "./intelligence-toolbar-styles";
import { SyncDataModal } from "./sync-data-modal";

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
};

export function IntelligenceToolbar({ clientSlug, orgSlug, disabled, disabledHint }: Props) {
  const [toolbarMessage, setToolbarMessage] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);

  const syncTitle =
    disabledHint?.trim() ||
    "Update reels and metrics for the creator selected in the header (choose scope in the dialog).";

  return (
    <div className="flex flex-col items-end gap-2">
      <SyncDataModal
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
        disabled={disabled}
        disabledHint={disabledHint}
        onSyncMessage={setToolbarMessage}
      />
      <div
        className="inline-flex items-center gap-1 rounded-2xl border border-zinc-200/90 bg-zinc-50/95 p-1 shadow-sm dark:border-white/10 dark:bg-zinc-950/70"
        role="toolbar"
        aria-label="Intelligence actions"
      >
        <button
          type="button"
          disabled={disabled || !clientSlug.trim() || !orgSlug.trim()}
          title={syncTitle}
          aria-label="Update data"
          onClick={() => setSyncOpen(true)}
          className={INTELLIGENCE_TOOLBAR_ICON_CLASS}
        >
          <RefreshCw className="h-5 w-5" aria-hidden />
        </button>
        <AddCompetitorButton
          clientSlug={clientSlug}
          orgSlug={orgSlug}
          disabled={disabled}
          disabledHint={disabledHint}
          onToolbarMessage={setToolbarMessage}
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
          className="max-w-[min(100%,22rem)] text-right text-[10px] leading-snug text-zinc-600 dark:text-app-fg-muted"
          role="status"
        >
          {toolbarMessage}
        </p>
      ) : null}
    </div>
  );
}
