/**
 * AiContextSection — collapsible "What the AI is working with" accordion.
 *
 * Surfaces the alternate hooks (and any other AI context) the model considered.
 * Lives at the bottom of every editor flow so users can verify the model has
 * what it needs without polluting the main edit surface.
 *
 * Pure leaf (props in / events out). The host owns the regeneration call.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { RegenInline } from "./RegenInline";

type Props = {
  hooks: Array<{ text?: string }>;
  scriptForTalkingHead?: string | null;
  regenHooks: (feedback: string) => Promise<boolean>;
  busy: boolean;
  /** Optional per-hook controls (e.g. thumbs up / down for the learning loop). */
  hookActions?: (text: string) => ReactNode;
};

export function AiContextSection({ hooks, scriptForTalkingHead, regenHooks, busy, hookActions }: Props) {
  const [open, setOpen] = useState(false);
  if (!hooks.length && !scriptForTalkingHead) return null;

  return (
    <div className="glass rounded-2xl border border-app-divider/60 p-4 md:p-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-app-fg-muted hover:text-app-fg"
      >
        <span>What the AI is working with</span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {hooks.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-app-fg-subtle">
                  Alternative hooks ({hooks.length})
                </p>
                <RegenInline
                  scope="hooks"
                  busy={busy}
                  onRegen={async (_s, fb) => regenHooks(fb)}
                  placeholder="More direct, shorter, …"
                />
              </div>
              <ul className="space-y-1.5">
                {hooks.map((h, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-lg border border-app-divider/50 bg-app-chip-bg/30 px-3 py-2 text-xs leading-relaxed text-app-fg"
                  >
                    <span className="min-w-0 flex-1">{h?.text || "—"}</span>
                    {hookActions && h?.text ? hookActions(h.text) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
