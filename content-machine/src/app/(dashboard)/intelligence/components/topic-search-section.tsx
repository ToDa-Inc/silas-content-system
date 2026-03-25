"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { clientApiHeaders, contentApiFetch, formatFastApiError, getContentApiBase } from "@/lib/api-client";

type AccountRow = {
  username: string;
  reel_count: number;
  sample_urls: string[];
};

type Props = {
  clientSlug: string;
  orgSlug: string;
  suggestedKeywords: string[];
  disabled?: boolean;
};

export function TopicSearchSection({ clientSlug, orgSlug, suggestedKeywords, disabled }: Props) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [totalItems, setTotalItems] = useState<number | null>(null);

  async function runSearch() {
    const keyword = q.trim();
    if (keyword.length < 2 || disabled || !clientSlug.trim() || !orgSlug.trim()) return;
    setBusy(true);
    setErr(null);
    setAccounts([]);
    setTotalItems(null);
    const apiBase = getContentApiBase();
    const headers = await clientApiHeaders({ orgSlug });
    try {
      const res = await contentApiFetch(`${apiBase}/api/v1/clients/${clientSlug}/search/topics`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, max_items: 80 }),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(formatFastApiError(raw, "Search failed"));
        return;
      }
      const data = raw as { accounts?: AccountRow[]; total_items?: number };
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
      setTotalItems(typeof data.total_items === "number" ? data.total_items : null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-12">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-app-fg">Search by topic</h2>
        <p className="mt-1 text-xs text-app-fg-subtle">
          Find accounts posting reels about a topic — add the best ones as competitors to sync full metrics.
        </p>
      </div>
      <div className="glass rounded-xl border border-zinc-200/60 p-4 dark:border-white/[0.08]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="topic-q" className="mb-1 block text-[11px] font-medium text-app-fg-muted">
              Topic keyword
            </label>
            <input
              id="topic-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch();
              }}
              placeholder="e.g. toxic workplace, leadership tips"
              disabled={disabled || busy}
              className="glass-inset w-full rounded-lg px-3 py-2 text-sm text-app-fg placeholder:text-app-fg-faint disabled:opacity-50"
            />
          </div>
          <button
            type="button"
            disabled={disabled || busy || q.trim().length < 2}
            onClick={() => void runSearch()}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
            Search
          </button>
        </div>
        {suggestedKeywords.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="text-[10px] uppercase tracking-wider text-app-fg-faint">Suggestions:</span>
            {suggestedKeywords.map((kw) => (
              <button
                key={kw}
                type="button"
                disabled={disabled || busy}
                onClick={() => {
                  setQ(kw);
                }}
                className="rounded-full bg-zinc-200/80 px-2 py-0.5 text-[11px] text-zinc-700 transition-colors hover:bg-zinc-300 dark:bg-white/10 dark:text-app-fg-muted dark:hover:bg-white/15"
              >
                {kw}
              </button>
            ))}
          </div>
        ) : null}
        {err ? <p className="mt-3 text-xs text-red-600 dark:text-red-400">{err}</p> : null}
        {totalItems != null ? (
          <p className="mt-3 text-[11px] text-app-fg-subtle">{totalItems.toLocaleString()} reel URLs from Instagram search.</p>
        ) : null}
        {accounts.length > 0 ? (
          <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto text-sm">
            {accounts.slice(0, 40).map((a) => (
              <li
                key={a.username}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-100/80 px-3 py-2 dark:bg-white/[0.06]"
              >
                <span className="font-medium text-app-fg">@{a.username}</span>
                <span className="text-xs text-app-fg-muted">{a.reel_count} reels on this topic</span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-4 text-[11px] text-app-fg-muted">
          No engagement data here — use <strong>Add competitor</strong> with a handle to sync full metrics and breakouts.
        </p>
      </div>
    </section>
  );
}
