"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { AddCompetitorModal } from "./add-competitor-modal";
import { INTELLIGENCE_TOOLBAR_ICON_CLASS } from "./intelligence-toolbar-styles";

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
  onToolbarMessage?: (msg: string | null) => void;
};

export function AddCompetitorButton({
  clientSlug,
  orgSlug,
  disabled,
  disabledHint,
  onToolbarMessage,
}: Props) {
  const [open, setOpen] = useState(false);

  const title =
    disabledHint?.trim() ||
    "Add a competitor by @handle or profile URL. Optionally scrape their reels right after (Apify).";

  return (
    <>
      <button
        type="button"
        disabled={disabled || !clientSlug.trim() || !orgSlug.trim()}
        title={title}
        aria-label="Add competitor"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={INTELLIGENCE_TOOLBAR_ICON_CLASS}
      >
        <UserPlus className="h-5 w-5" aria-hidden />
      </button>
      <AddCompetitorModal
        open={open}
        onClose={() => setOpen(false)}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
        disabled={disabled}
        disabledHint={disabledHint}
        onToolbarMessage={onToolbarMessage}
      />
    </>
  );
}
