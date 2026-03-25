"use client";

import { useState } from "react";
import { AddCompetitorButton } from "./add-competitor-button";
import { AnalyzeReelTrigger } from "./analyze-reel-trigger";
import { SyncAllButton } from "./sync-all-button";

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
};

export function IntelligenceToolbar({ clientSlug, orgSlug, disabled, disabledHint }: Props) {
  const [toolbarMessage, setToolbarMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-2">
      <div
        className="inline-flex items-center gap-1 rounded-2xl border border-zinc-200/90 bg-zinc-50/95 p-1 shadow-sm dark:border-white/10 dark:bg-zinc-950/70"
        role="toolbar"
        aria-label="Intelligence actions"
      >
        <SyncAllButton
          clientSlug={clientSlug}
          orgSlug={orgSlug}
          disabled={disabled}
          disabledHint={disabledHint}
          compact
          onStatusChange={setToolbarMessage}
        />
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
