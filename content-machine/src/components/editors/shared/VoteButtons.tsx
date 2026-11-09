"use client";

import { useCallback, useEffect, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { fetchVotes, putVote } from "@/lib/api-client";

export function voteTextKey(text: string): string {
  return text.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

/** Client-wide hook/angle votes, keyed by kind + normalised text (same key as the API). */
export function useVotes(clientSlug: string, orgSlug: string, sessionId: string | null | undefined) {
  const [votes, setVotes] = useState<Record<string, number>>({});

  useEffect(() => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!cs || !os) return;
    let cancelled = false;
    void fetchVotes(cs, os).then((res) => {
      if (cancelled || !res.ok) return;
      const next: Record<string, number> = {};
      for (const v of res.data) next[`${v.kind}:${v.text_key}`] = v.vote;
      setVotes(next);
    });
    return () => {
      cancelled = true;
    };
  }, [clientSlug, orgSlug]);

  const vote = useCallback(
    async (kind: "hook" | "angle", text: string, value: -1 | 1): Promise<string | null> => {
      const key = `${kind}:${voteTextKey(text)}`;
      const next = votes[key] === value ? 0 : value;
      const res = await putVote(clientSlug.trim(), orgSlug.trim(), { session_id: sessionId ?? null, kind, text, vote: next });
      if (!res.ok) return res.error;
      setVotes((prev) => {
        const copy = { ...prev };
        if (next === 0) delete copy[key];
        else copy[key] = next;
        return copy;
      });
      return null;
    },
    [clientSlug, orgSlug, sessionId, votes],
  );

  const current = useCallback(
    (kind: "hook" | "angle", text: string) => votes[`${kind}:${voteTextKey(text)}`] ?? 0,
    [votes],
  );

  return { vote, current };
}

/** Thumbs up / down; clicking the active one clears the vote. */
export function VoteButtons({
  value,
  onVote,
  label,
}: {
  value: number;
  onVote: (v: -1 | 1) => void;
  label: string;
}) {
  const base = "rounded-md p-1 transition hover:bg-app-chip-bg/60";
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        aria-pressed={value === 1}
        aria-label={`Like ${label}`}
        title="Good — learn from this"
        onClick={() => onVote(1)}
        className={`${base} ${value === 1 ? "text-emerald-600 dark:text-emerald-400" : "text-app-fg-subtle"}`}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-pressed={value === -1}
        aria-label={`Dislike ${label}`}
        title="Not for this client — avoid similar"
        onClick={() => onVote(-1)}
        className={`${base} ${value === -1 ? "text-rose-600 dark:text-rose-400" : "text-app-fg-subtle"}`}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
