"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { AnalyzeReelModal } from "./analyze-reel-modal";
import { INTELLIGENCE_TOOLBAR_ICON_ACCENT_CLASS } from "./intelligence-toolbar-styles";

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
};

/** Toolbar icon — opens analyze-by-URL modal. */
export function AnalyzeReelTrigger({ clientSlug, orgSlug, disabled, disabledHint }: Props) {
  const [open, setOpen] = useState(false);

  const title =
    disabledHint?.trim() ||
    "Analyze one public reel by URL — fetches the video and returns a Silas score in about a minute.";

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        title={title}
        aria-label="Analyze a reel by URL"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={INTELLIGENCE_TOOLBAR_ICON_ACCENT_CLASS}
      >
        <Link2 className="h-5 w-5" aria-hidden />
      </button>
      <AnalyzeReelModal
        open={open}
        onClose={() => setOpen(false)}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
        disabled={disabled}
        disabledHint={disabledHint}
      />
    </>
  );
}
