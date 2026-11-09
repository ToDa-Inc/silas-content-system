/**
 * RegenInline — inline regenerate control replacing the old global "Refine" panel.
 *
 * Lives next to the section it regenerates and posts back to the same
 * `/regenerate` endpoint with a per-section `scope`. Optional one-line feedback
 * is forwarded to the LLM.
 *
 * Pure leaf (props in / events out). The host owns the regeneration API call
 * and reports back via the `onRegen` callback (returns `true` on success so the
 * input can clear and the popover can close).
 */

import { useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";

export type RegenScope = "hooks" | "script" | "caption" | "story" | "text_blocks";

type Props = {
  scope: RegenScope;
  busy: boolean;
  onRegen: (scope: RegenScope, feedback: string) => Promise<boolean>;
  placeholder?: string;
};

export function RegenInline({
  scope,
  busy,
  onRegen,
  placeholder = "How should this change? (optional)",
}: Props) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-app-divider px-2 py-1 text-[11px] font-semibold text-app-fg-muted hover:text-app-fg disabled:opacity-40"
      >
        <RefreshCw className="h-3 w-3" /> Regenerate
      </button>
    );
  }

  return (
    <div className="flex flex-1 items-center gap-1.5 sm:max-w-md">
      <input
        type="text"
        autoFocus
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key !== "Enter" || busy) return;
          e.preventDefault();
          const ok = await onRegen(scope, feedback.trim());
          if (ok) {
            setFeedback("");
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className="glass-inset min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-[11px] text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-1 focus:ring-amber-500/35"
      />
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          const ok = await onRegen(scope, feedback.trim());
          if (ok) {
            setFeedback("");
            setOpen(false);
          }
        }}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-amber-500/15 px-2.5 py-1.5 text-[11px] font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        Run
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setFeedback("");
        }}
        className="rounded-lg p-1 text-app-fg-subtle hover:text-app-fg"
        aria-label="Cancel"
      >
        ✕
      </button>
    </div>
  );
}
