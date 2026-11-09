import { useEffect, useState, type ReactNode } from "react";
import { Copy, Loader2 } from "lucide-react";

/**
 * IG Story teaser lines for the post. Each line is editable and copyable on its own.
 * Pure leaf: the host saves edits (`onSave`) and wires `regenInline` to
 * `<RegenInline scope="story">`, same as CaptionSection.
 */
/** Grow a textarea to fit its text so no line is cut off (narrow screens wrap more). */
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 2}px`;
}

export function StorySection({
  stories,
  onCopy,
  onSave,
  regenInline,
}: {
  stories: string[];
  onCopy: (text: string) => void;
  onSave: (next: string[]) => Promise<boolean>;
  regenInline: ReactNode;
}) {
  const [draft, setDraft] = useState<string[]>(stories);
  const [saving, setSaving] = useState(false);
  // Keyed on content, not array identity: other saves on the Create screen replace the session
  // object but leave the stories as they are, so unsaved edits survive them. The key only
  // changes when the stories themselves change (saved or regenerated) — then the draft follows.
  const storiesKey = JSON.stringify(stories);

  const dirty = draft.length !== stories.length || draft.some((s, i) => s !== stories[i]);

  useEffect(() => {
    setDraft(JSON.parse(storiesKey) as string[]);
  }, [storiesKey]);

  return (
    <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold text-app-fg">IG Story texts</h2>
        {regenInline}
        {dirty ? (
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(draft.map((s) => s.trim()).filter(Boolean));
              } finally {
                setSaving(false);
              }
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-violet-500/20 px-2.5 py-1 text-[11px] font-bold text-violet-700 dark:text-violet-200 hover:bg-violet-500/30 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Save
          </button>
        ) : null}
      </div>
      {draft.length === 0 ? (
        <p className="text-xs text-app-fg-subtle">No story texts yet. Use Regenerate to create them.</p>
      ) : (
        <ul className="space-y-2">
          {draft.map((text, i) => (
            <li key={i} className="flex items-start gap-2">
              <textarea
                value={text}
                rows={2}
                ref={(el) => autoGrow(el)}
                onInput={(e) => autoGrow(e.currentTarget)}
                aria-label={`Story text ${i + 1}`}
                onChange={(e) =>
                  setDraft((prev) => prev.map((s, j) => (j === i ? e.target.value : s)))
                }
                className="glass-inset min-w-0 flex-1 resize-none overflow-hidden rounded-lg px-2.5 py-1.5 text-sm text-app-fg focus:outline-none focus:ring-1 focus:ring-amber-500/35"
              />
              <button
                type="button"
                onClick={() => onCopy(text)}
                aria-label={`Copy story text ${i + 1}`}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-app-icon-btn-bg px-2.5 py-1 text-[11px] font-bold text-app-icon-btn-fg"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
