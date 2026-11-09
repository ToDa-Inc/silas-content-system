"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

type TraceReel = { reel_id: string; post_url?: string | null; hook?: string | null; reason?: string | null };
type Trace = {
  winners?: TraceReel[];
  avoid?: TraceReel[];
  weak_hooks?: number;
  weak_ctas?: number;
  liked?: number;
  rejected?: number;
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Learned from: 4 winners · 2 avoid · 18 votes" — expandable to the exact reels used. */
export function LearningTraceLine({ trace }: { trace: Record<string, unknown> | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!trace) return null;
  const t = trace as Trace;
  const winners = t.winners ?? [];
  const avoid = t.avoid ?? [];
  const votes = (t.liked ?? 0) + (t.rejected ?? 0);
  const weak = (t.weak_hooks ?? 0) + (t.weak_ctas ?? 0);
  const parts = [
    winners.length ? plural(winners.length, "winner", "winners") : "",
    weak ? plural(weak, "reel to improve", "reels to improve") : "",
    avoid.length ? plural(avoid.length, "reel that didn't work", "reels that didn't work") : "",
    votes ? plural(votes, "thumbs vote", "thumbs votes") : "",
  ].filter(Boolean);
  if (!parts.length) return null;

  const list = (title: string, rows: TraceReel[]) =>
    rows.length ? (
      <div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-app-fg-subtle">{title}</p>
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.reel_id} className="text-[11px] text-app-fg">
              {r.post_url ? (
                <a href={r.post_url} target="_blank" rel="noreferrer" className="underline">
                  {r.hook || r.post_url}
                </a>
              ) : (
                r.hook
              )}
              {r.reason ? <span className="text-app-fg-muted"> · {r.reason}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <div className="rounded-xl border border-app-divider/60 px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left text-[11px] text-app-fg-muted hover:text-app-fg"
      >
        <span>
          <span className="font-semibold">Learned from:</span> {parts.join(" · ")}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {list("✅ Winners — copied what works", winners)}
          {list("⛔ Didn't work — avoided", avoid)}
        </div>
      ) : null}
    </div>
  );
}
