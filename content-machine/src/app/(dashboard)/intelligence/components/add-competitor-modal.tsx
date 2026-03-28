"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, UserPlus, X } from "lucide-react";
import {
  clientApiHeaders,
  contentApiFetch,
  formatFastApiError,
  getContentApiBase,
} from "@/lib/api-client";

type Props = {
  open: boolean;
  onClose: () => void;
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
  /** Surface messages (e.g. sync) in parent toolbar */
  onToolbarMessage?: (msg: string | null) => void;
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

export function AddCompetitorModal({
  open,
  onClose,
  clientSlug,
  orgSlug,
  disabled,
  disabledHint,
  onToolbarMessage,
}: Props) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [addedBy, setAddedBy] = useState("");
  const [scrapeAfter, setScrapeAfter] = useState(true);
  const [busy, setBusy] = useState<"preview" | "save" | "scrape" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewJson | null>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setInput("");
      setAddedBy("");
      setScrapeAfter(true);
      setError(null);
      setPreview(null);
      setBusy(null);
    }
  }, [open]);

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
      const res = await contentApiFetch(`${apiBase}/api/v1/clients/${clientSlug}/competitors/preview`, {
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
      const res = await contentApiFetch(`${apiBase}/api/v1/clients/${clientSlug}/competitors/add`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          input: input.trim(),
          added_by: addedBy.trim() || null,
        }),
      });
      const json = (await res.json()) as PreviewJson & {
        detail?: unknown;
        saved?: boolean;
        competitor_id?: string;
      };
      if (!res.ok) {
        setError(formatFastApiError(json, "Could not add account"));
        return;
      }
      if (json.already_tracked) {
        setPreview(json);
        return;
      }
      const cid = json.competitor_id;
      const un = json.username ?? input.trim().replace(/^@/, "");

      if (scrapeAfter && cid) {
        setBusy("scrape");
        onToolbarMessage?.(`Fetching reels for @${un}…`);
        const scrapeRes = await contentApiFetch(
          `${apiBase}/api/v1/clients/${clientSlug}/competitors/${encodeURIComponent(cid)}/scrape-reels`,
          {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ limit: 30 }),
          },
        );
        const sj = (await scrapeRes.json().catch(() => ({}))) as {
          detail?: unknown;
          reels_processed?: number;
        };
        if (!scrapeRes.ok) {
          onToolbarMessage?.(formatFastApiError(sj as Record<string, unknown>, "Sync failed"));
        } else {
          const n = sj.reels_processed ?? 0;
          onToolbarMessage?.(`@${un}: stored ${n} reels.`);
        }
        setTimeout(() => onToolbarMessage?.(null), 8000);
      } else {
        onToolbarMessage?.(`Added @${un} — scrape from their row or use Sync on Intelligence.`);
        setTimeout(() => onToolbarMessage?.(null), 6000);
      }
      onClose();
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm dark:bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-competitor-title"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-zinc-200/90 bg-zinc-50 p-5 shadow-2xl dark:border-white/12 dark:bg-zinc-950/95"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h2 id="add-competitor-title" className="text-sm font-semibold text-zinc-900 dark:text-app-fg">
              Add competitor
            </h2>
            <p className="mt-1 text-[11px] text-zinc-600 dark:text-app-fg-subtle">
              @handle or profile URL (not a reel link). Optional: fetch their latest reels right after saving.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-200/80 dark:text-app-fg-subtle dark:hover:bg-white/10"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setPreview(null);
          }}
          placeholder="@username or instagram.com/…"
          disabled={busy !== null}
          className="mb-2 w-full rounded-xl border border-zinc-200/90 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 disabled:opacity-60 dark:border-white/10 dark:bg-zinc-900/80 dark:text-app-fg dark:placeholder:text-app-fg-faint"
        />
        <input
          type="text"
          value={addedBy}
          onChange={(e) => setAddedBy(e.target.value)}
          placeholder="Who is adding? (optional)"
          disabled={busy !== null}
          className="mb-3 w-full rounded-xl border border-zinc-200/90 bg-white px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 disabled:opacity-60 dark:border-white/10 dark:bg-zinc-900/80 dark:text-app-fg"
        />

        <label className="mb-4 flex cursor-pointer items-start gap-2 text-[11px] text-zinc-700 dark:text-app-fg-muted">
          <input
            type="checkbox"
            checked={scrapeAfter}
            onChange={(e) => setScrapeAfter(e.target.checked)}
            disabled={busy !== null}
            className="mt-0.5 rounded border-zinc-300 text-amber-600 focus:ring-amber-500/40 dark:border-white/20"
          />
          <span>
            <strong className="font-semibold text-zinc-900 dark:text-app-fg">Sync reels after adding</strong>
            <span className="block text-zinc-500 dark:text-app-fg-faint">
              Pulls recent posts via Apify (~30s–2 min). Turn off to only save the account.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null || !input.trim()}
            onClick={() => void runAdd()}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-zinc-950 disabled:opacity-50"
          >
            {busy === "save" || busy === "scrape" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
            )}
            {busy === "scrape" ? "Scraping…" : "Add & continue"}
          </button>
          <button
            type="button"
            disabled={busy !== null || !input.trim()}
            onClick={() => void runPreview()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200/90 bg-white px-3 py-2.5 text-xs font-semibold text-zinc-800 dark:border-white/15 dark:bg-zinc-900/80 dark:text-app-fg dark:hover:bg-zinc-800"
          >
            {busy === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Preview only
          </button>
        </div>

        {error ? (
          <p className="mt-3 text-xs text-amber-800 dark:text-amber-200/90" role="alert">
            {error}
          </p>
        ) : null}
        {preview ? (
          <div className="mt-5 border-t border-zinc-200/90 pt-4 dark:border-white/10">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-app-fg-subtle">
              Preview
            </p>
            <div className="rounded-xl border border-zinc-200/80 bg-zinc-100/80 p-3 text-xs dark:border-white/10 dark:bg-white/5">
              {preview.already_tracked ? (
                <p className="text-zinc-800 dark:text-app-fg-secondary">{preview.message ?? "Already tracked."}</p>
              ) : (
                <>
                  <p className="font-semibold text-zinc-900 dark:text-app-fg">@{preview.username}</p>
                  <p className="mt-1 text-zinc-600 dark:text-app-fg-muted">
                    {preview.followers != null ? `${preview.followers.toLocaleString()} followers · ` : ""}
                    {preview.avg_views != null ? `~${preview.avg_views.toLocaleString()} avg views` : "—"}
                  </p>
                  {preview.relevance_score != null ? (
                    <p className="mt-2 text-zinc-700 dark:text-app-fg-secondary">
                      Similarity: <strong>{preview.relevance_score}</strong>/100
                      {preview.composite_score != null ? ` · composite ${preview.composite_score}` : ""}
                    </p>
                  ) : null}
                  {preview.reasoning ? (
                    <p className="mt-2 line-clamp-4 text-[11px] text-zinc-500 dark:text-app-fg-subtle">
                      {preview.reasoning}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
