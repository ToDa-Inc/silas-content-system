"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Search } from "lucide-react";
import { clientApiHeaders, contentApiFetch, getContentApiBase } from "@/lib/api-client";

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
};

type DiscoverResult = {
  job_id?: string;
  status?: string;
  result?: {
    keywords_planned?: string[];
    competitors_saved?: number;
    evaluated?: number;
    accounts_discovered?: number;
    message?: string;
  };
};

export function DiscoverInline({ clientSlug, orgSlug, disabled, disabledHint }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function runDiscover() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      setStatus(
        disabledHint?.trim() ||
          (!orgSlug.trim()
            ? "No organization context — refresh the page or sign in again."
            : "Add or select a creator in the header first."),
      );
      return;
    }
    setBusy(true);
    setStatus("Searching…");
    const apiBase = getContentApiBase();
    const headersBase = await clientApiHeaders({ orgSlug });

    try {
      const d = await contentApiFetch(`${apiBase}/api/v1/clients/${clientSlug}/competitors/discover`, {
        method: "POST",
        headers: { ...headersBase, "Content-Type": "application/json" },
        body: JSON.stringify({ keyword_mode: "all" }),
      });
      if (d.status === 409) {
        setStatus("Discovery already running — please wait.");
        return;
      }
      if (!d.ok) {
        const err = await d.text();
        setStatus(err ? `Error: ${err.slice(0, 200)}` : "Something went wrong — try again.");
        return;
      }
      const json = (await d.json()) as DiscoverResult;
      const planned = json.result?.keywords_planned;
      const kwPrefix = planned?.length ? `Searched: ${planned.join(", ")}. ` : "";
      const saved = json.result?.competitors_saved ?? 0;
      const evaluated = json.result?.evaluated ?? 0;
      const discovered = json.result?.accounts_discovered;
      const msg = json.result?.message;
      if (msg) {
        setStatus(`${kwPrefix}${msg}`);
      } else {
        const bits = [
          `${saved} competitor${saved === 1 ? "" : "s"} saved`,
          evaluated != null && evaluated > 0 ? `${evaluated} evaluated` : null,
          discovered != null ? `${discovered} accounts found` : null,
        ].filter(Boolean);
        setStatus(`${kwPrefix}Done — ${bits.join(", ")}.`);
      }
      router.refresh();
    } catch {
      setStatus("Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass rounded-xl border border-zinc-200/60 dark:border-white/[0.08]">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-app-fg transition-colors hover:bg-zinc-100/60 dark:hover:bg-white/[0.04]"
      >
        <span className="flex items-center gap-2">
          <Search className="h-4 w-4 text-amber-500" aria-hidden />
          Find more competitors
        </span>
        {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-app-fg-subtle" /> : <ChevronDown className="h-4 w-4 shrink-0 text-app-fg-subtle" />}
      </button>
      {expanded ? (
        <div className="border-t border-zinc-200/60 px-4 py-3 dark:border-white/[0.06]">
          <p className="mb-3 text-[11px] leading-relaxed text-app-fg-subtle">
            Uses identity keywords from your niche profile (
            <a href="/settings" className="font-medium text-amber-400 hover:underline">
              Settings → Niche profile
            </a>
            ). Sync your reels first so keywords are filled in.
          </p>
          <button
            type="button"
            disabled={busy || disabled || !clientSlug.trim() || !orgSlug.trim()}
            title={disabledHint ?? undefined}
            onClick={() => void runDiscover()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
            {busy ? "Searching…" : "Find competitors"}
          </button>
          {status ? <p className="mt-2 text-[11px] text-app-fg-muted">{status}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
