"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, UserPlus, X } from "lucide-react";
import { clientApiHeaders, formatFastApiError, getContentApiBase } from "@/lib/api-client";

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
};

type PreviewJson = {
  already_tracked?: boolean;
  message?: string;
  username?: string;
  added_by?: string | null;
  profile_url?: string | null;
  followers?: number | null;
  avg_views?: number | null;
  relevance_score?: number | null;
  reasoning?: string | null;
  composite_score?: number | null;
  tier_label?: string | null;
};

export function AddCompetitorButton({ clientSlug, orgSlug, disabled, disabledHint }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [addedBy, setAddedBy] = useState("");
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewJson | null>(null);

  function close() {
    setOpen(false);
    setInput("");
    setAddedBy("");
    setError(null);
    setPreview(null);
  }

  async function runPreview() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      setError(disabledHint?.trim() || "Select a workspace and client first.");
      return;
    }
    setBusy("preview");
    setError(null);
    setPreview(null);
    const apiBase = getContentApiBase();
    const headers = await clientApiHeaders({ orgSlug });
    try {
      const res = await fetch(`${apiBase}/api/v1/clients/${clientSlug}/competitors/preview`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ input: input.trim() }),
      });
      const json = (await res.json()) as PreviewJson & { detail?: unknown };
      if (!res.ok) {
        setError(formatFastApiError(json, "Preview failed"));
        return;
      }
      setPreview(json);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function runAdd() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      setError(disabledHint?.trim() || "Select a workspace and client first.");
      return;
    }
    if (!input.trim()) {
      setError("Paste an @handle or Instagram profile URL.");
      return;
    }
    setBusy("save");
    setError(null);
    const apiBase = getContentApiBase();
    const headers = await clientApiHeaders({ orgSlug });
    try {
      const res = await fetch(`${apiBase}/api/v1/clients/${clientSlug}/competitors/add`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          input: input.trim(),
          added_by: addedBy.trim() || null,
        }),
      });
      const json = (await res.json()) as PreviewJson & { detail?: unknown; saved?: boolean };
      if (!res.ok) {
        setError(formatFastApiError(json, "Could not add account"));
        return;
      }
      if (json.already_tracked) {
        setPreview(json);
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {!open ? (
        <button
          type="button"
          disabled={disabled || !clientSlug.trim() || !orgSlug.trim()}
          title={disabledHint ?? undefined}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-transparent px-4 py-2 text-sm font-semibold text-app-fg hover:bg-zinc-100 dark:border-white/20 dark:hover:bg-white/10 disabled:opacity-50"
        >
          <UserPlus className="h-4 w-4" aria-hidden />
          Add competitor
        </button>
      ) : (
        <div className="glass w-full max-w-md rounded-xl border border-zinc-200/80 p-4 dark:border-white/10">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-app-fg">Add competitor</span>
            <button
              type="button"
              onClick={close}
              className="rounded p-1 text-app-fg-subtle hover:bg-zinc-200/80 dark:hover:bg-white/10"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mb-2 text-[11px] text-app-fg-subtle">
            Paste an @handle or profile URL (not a reel link). Add saves immediately; Preview only shows stats + similarity.
          </p>
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setPreview(null);
            }}
            placeholder="@username or instagram.com/…"
            className="glass-inset mb-2 w-full rounded-lg px-3 py-2 text-sm text-app-fg placeholder:text-app-fg-faint"
          />
          <input
            type="text"
            value={addedBy}
            onChange={(e) => setAddedBy(e.target.value)}
            placeholder="Who is adding? (optional, e.g. Silas)"
            className="glass-inset mb-3 w-full rounded-lg px-3 py-2 text-xs text-app-fg placeholder:text-app-fg-faint"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null || !input.trim()}
              onClick={() => void runAdd()}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-950"
            >
              {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Add to tracking
            </button>
            <button
              type="button"
              disabled={busy !== null || !input.trim()}
              onClick={() => void runPreview()}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-200 px-3 py-1.5 text-xs font-bold text-zinc-900 dark:bg-white/15 dark:text-app-fg"
            >
              {busy === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Preview
            </button>
          </div>
          {error ? <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{error}</p> : null}
          {preview ? (
            <div className="mt-3 rounded-lg bg-zinc-100/80 p-3 text-xs dark:bg-white/8">
              {preview.already_tracked ? (
                <p className="text-app-fg-secondary">{preview.message ?? "Already tracked."}</p>
              ) : (
                <>
                  <p className="font-semibold text-app-fg">@{preview.username}</p>
                  <p className="mt-1 text-app-fg-muted">
                    {preview.followers != null ? `${preview.followers.toLocaleString()} followers · ` : ""}
                    {preview.avg_views != null ? `~${preview.avg_views.toLocaleString()} avg views` : "—"}
                  </p>
                  {preview.relevance_score != null ? (
                    <p className="mt-2 text-app-fg-secondary">
                      Similarity score: <strong>{preview.relevance_score}</strong>/100
                      {preview.composite_score != null ? ` · composite ${preview.composite_score}` : ""}
                    </p>
                  ) : null}
                  {preview.reasoning ? (
                    <p className="mt-2 line-clamp-4 text-[11px] text-app-fg-subtle">{preview.reasoning}</p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
