"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Link2, Loader2, Unlink } from "lucide-react";
import {
  fetchOwnReelsForLinking,
  fetchPublishedReel,
  setPublishedReel,
  type OwnReelForLinking,
  type PublishedReelSummary,
} from "@/lib/api-client";

/** Same status style as the dashboard: coloured dot + plain words. */
const BUCKET: Record<string, { label: string; dot: string; text: string }> = {
  scale: { label: "Winner", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  adjust_hook: { label: "Weak start", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  adjust_cta: { label: "Few comments", dot: "bg-sky-500", text: "text-sky-600 dark:text-sky-400" },
  retire: { label: "Didn't work", dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
  keep: { label: "Normal", dot: "bg-zinc-400", text: "text-app-fg-muted" },
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/** First caption line, trimmed to fit a dropdown row. */
function firstLine(caption: string): string {
  const line = (caption.split("\n").find((l) => l.trim()) ?? "").trim();
  return line.length > 48 ? `${line.slice(0, 47)}…` : line;
}

function fmtNum(n: number | null | undefined): string {
  return typeof n === "number" ? n.toLocaleString() : "—";
}

/**
 * Which published reel this post became. Linked automatically on a strong caption match;
 * otherwise Silas picks the reel here. The linked reel's numbers feed the learning loop.
 */
export function PublishedReelSection({
  clientSlug,
  orgSlug,
  sessionId,
  sessionCreatedAt,
  onError,
}: {
  clientSlug: string;
  orgSlug: string;
  sessionId: string;
  sessionCreatedAt: string | null | undefined;
  onError: (message: string) => void;
}) {
  const [summary, setSummary] = useState<PublishedReelSummary | null>(null);
  const [reels, setReels] = useState<OwnReelForLinking[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetchPublishedReel(clientSlug, orgSlug, sessionId);
    if (res.ok) setSummary(res.data);
    else onError(res.error);
  }, [clientSlug, orgSlug, sessionId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const openPicker = async () => {
    setPicking(true);
    const res = await fetchOwnReelsForLinking(clientSlug, orgSlug, sessionCreatedAt ?? null);
    if (res.ok) setReels(res.data);
    else onError(res.error);
  };

  const save = async (reelId: string | null) => {
    setBusy(true);
    try {
      const res = await setPublishedReel(clientSlug, orgSlug, sessionId, reelId);
      if (!res.ok) {
        onError(res.error);
        return;
      }
      setSummary(res.data);
      setPicking(false);
      setChoice("");
    } finally {
      setBusy(false);
    }
  };

  const reel = summary?.linked ? summary.reel : null;
  const diag = summary?.diagnostic ?? null;
  const bucket = diag && !diag.excluded ? diag.override_bucket ?? diag.rule_bucket : null;
  const snaps = summary?.snapshots ?? [];
  const firstViews = snaps.find((s) => typeof s.views === "number")?.views ?? null;

  return (
    <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold text-app-fg">Published reel</h2>
        {reel ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(null)}
            className="inline-flex items-center gap-1 rounded-lg border border-app-divider px-2 py-1 text-[11px] font-semibold text-app-fg-muted hover:text-app-fg disabled:opacity-40"
          >
            <Unlink className="h-3 w-3" /> Unlink
          </button>
        ) : !picking ? (
          <button
            type="button"
            onClick={() => void openPicker()}
            className="inline-flex items-center gap-1 rounded-lg bg-app-icon-btn-bg px-2.5 py-1 text-[11px] font-bold text-app-icon-btn-fg"
          >
            <Link2 className="h-3 w-3" /> Pick a reel
          </button>
        ) : null}
      </div>

      {summary === null ? (
        <p className="text-xs text-app-fg-subtle">Loading…</p>
      ) : reel ? (
        <div className="space-y-1.5 text-xs text-app-fg">
          <p>
            Posted {fmtDate(reel.posted_at)} · <strong>{fmtNum(reel.views)}</strong> views ·{" "}
            {fmtNum(reel.likes)} {reel.likes === 1 ? "like" : "likes"} · {fmtNum(reel.comments)}{" "}
            {reel.comments === 1 ? "comment" : "comments"}
            {bucket && BUCKET[bucket] ? (
              <span className={`ml-2 inline-flex items-center gap-1.5 font-semibold ${BUCKET[bucket].text}`}>
                <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${BUCKET[bucket].dot}`} />
                {BUCKET[bucket].label}
              </span>
            ) : null}
          </p>
          {diag?.reason ? <p className="text-app-fg-muted">{diag.reason}</p> : null}
          <p className="text-[11px] text-app-fg-subtle">
            {summary.link_source === "auto" ? "Linked automatically (caption match)" : "Linked by hand"} · updated{" "}
            {fmtDate(reel.last_updated_at)}
            {snaps.length > 1 && firstViews !== null ? ` · ${fmtNum(firstViews)} → ${fmtNum(reel.views)} views over ${snaps.length} checks` : ""}
            {" · "}
            <a href={reel.post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">
              Open <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
      ) : picking ? (
        <div className="flex flex-wrap items-center gap-2">
          {reels === null ? (
            <p className="text-xs text-app-fg-subtle">Loading reels…</p>
          ) : reels.length === 0 ? (
            <p className="text-xs text-app-fg-subtle">No own reels published after this post was created yet.</p>
          ) : (
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              aria-label="Published reel"
              className="glass-inset min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs text-app-fg"
            >
              <option value="">Choose the reel this post became…</option>
              {reels.map((r) => (
                <option key={r.id} value={r.id} disabled={Boolean(r.linked_session_id && r.linked_session_id !== sessionId)}>
                  {fmtDate(r.posted_at)} · {fmtNum(r.views)} views · {firstLine(r.caption) || r.post_url}
                  {r.linked_session_id && r.linked_session_id !== sessionId ? " (linked to another post)" : ""}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            disabled={!choice || busy}
            onClick={() => void save(choice)}
            className="inline-flex items-center gap-1 rounded-lg bg-violet-500/20 px-2.5 py-1 text-[11px] font-bold text-violet-700 dark:text-violet-200 hover:bg-violet-500/30 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Link
          </button>
          <button
            type="button"
            onClick={() => setPicking(false)}
            className="rounded-lg p-1 text-app-fg-subtle hover:text-app-fg"
            aria-label="Cancel"
          >
            ✕
          </button>
        </div>
      ) : (
        <p className="text-xs text-app-fg-subtle">
          Not linked yet — links itself when the published caption matches, or pick the reel.
        </p>
      )}
    </div>
  );
}
