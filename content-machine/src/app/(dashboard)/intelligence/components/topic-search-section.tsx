"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { clientApiHeaders, contentApiFetch, formatFastApiError, getContentApiBase } from "@/lib/api-client";
import { INTELLIGENCE_PRIMARY_BUTTON_CLASS, INTELLIGENCE_SECTION_CARD_CLASS } from "./intelligence-toolbar-styles";

const SECTION_TITLE = "text-sm font-semibold tracking-tight text-app-fg";
const SECTION_DESC = "mt-1.5 text-xs leading-relaxed text-app-fg-subtle";

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
  /** Nested inside Add competitors (lighter chrome, no page-level margin). */
  embedded?: boolean;
};

export function TopicSearchSection({
  clientSlug,
  orgSlug,
  suggestedKeywords,
  disabled,
  embedded,
}: Props) {
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

  const inputId = embedded ? "topic-q-embedded" : "topic-q-page";

  const formBlock = (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-app-fg-muted">
            Topic keyword
          </label>
          <input
            id={inputId}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch();
            }}
            placeholder="e.g. toxic workplace, leadership tips"
            disabled={disabled || busy}
            className="glass-inset w-full rounded-lg border border-zinc-200/50 px-3 py-2.5 text-sm text-app-fg shadow-sm placeholder:text-app-fg-faint focus:border-amber-500/45 focus:outline-none focus:ring-2 focus:ring-amber-500/25 disabled:opacity-50 dark:border-white/[0.08]"
          />
        </div>
        <button
          type="button"
          disabled={disabled || busy || q.trim().length < 2}
          onClick={() => void runSearch()}
          className={`shrink-0 self-stretch sm:self-auto ${INTELLIGENCE_PRIMARY_BUTTON_CLASS}`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
          Search
        </button>
      </div>
      {suggestedKeywords.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-app-fg-faint">Suggestions</span>
          {suggestedKeywords.map((kw) => (
            <button
              key={kw}
              type="button"
              disabled={disabled || busy}
              onClick={() => {
                setQ(kw);
              }}
              className="rounded-full border border-zinc-200/80 bg-white/90 px-2.5 py-1 text-xs text-zinc-700 transition-colors hover:border-amber-500/40 hover:bg-amber-500/10 disabled:opacity-50 dark:border-white/12 dark:bg-white/[0.06] dark:text-app-fg-muted dark:hover:border-amber-500/35 dark:hover:bg-amber-500/10"
            >
              {kw}
            </button>
          ))}
        </div>
      ) : null}
      {err ? <p className="mt-3 text-xs text-red-600 dark:text-red-400">{err}</p> : null}
      {totalItems != null ? (
        <p className="mt-3 text-xs text-app-fg-subtle">{totalItems.toLocaleString()} reel URLs from Instagram search.</p>
      ) : null}
      {accounts.length > 0 ? (
        <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto text-sm">
          {accounts.slice(0, 40).map((a) => (
            <li
              key={a.username}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200/50 bg-white/70 px-3 py-2.5 dark:border-white/[0.08] dark:bg-white/[0.05]"
            >
              <span className="font-medium text-app-fg">@{a.username}</span>
              <span className="text-xs text-app-fg-muted">{a.reel_count} reels on this topic</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4 rounded-lg border border-zinc-200/50 bg-white/60 px-3 py-2.5 text-xs leading-relaxed text-app-fg-muted dark:border-white/[0.08] dark:bg-white/[0.03]">
        {embedded ? (
          <>
            No engagement data here — use <strong className="text-app-fg-secondary">Add manually</strong> above with a handle to sync full metrics and breakouts.
          </>
        ) : (
          <>
            No engagement data here — use <strong className="text-app-fg-secondary">Add competitor</strong> with a handle to sync full metrics and breakouts.
          </>
        )}
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className={INTELLIGENCE_SECTION_CARD_CLASS}>
        <p className={SECTION_TITLE}>Search by topic</p>
        <p className={SECTION_DESC}>
          Find accounts posting reels about a topic — add the best ones as competitors to sync full metrics.
        </p>
        <div className="mt-4">{formBlock}</div>
      </div>
    );
  }

  return (
    <section className="mb-12">
      <div className={INTELLIGENCE_SECTION_CARD_CLASS}>
        <h2 className={SECTION_TITLE}>Search by topic</h2>
        <p className={SECTION_DESC}>
          Find accounts posting reels about a topic — add the best ones as competitors to sync full metrics.
        </p>
        <div className="mt-4">{formBlock}</div>
      </div>
    </section>
  );
}
