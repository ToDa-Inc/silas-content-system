"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { clientApiHeaders, getContentApiBase } from "@/lib/api-client";

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

export function DiscoverButton({ clientSlug, orgSlug, disabled, disabledHint }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function runDiscover() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      setStatus(
        disabledHint?.trim() ||
          (!orgSlug.trim()
            ? "No organization context — refresh the page or sign in again."
            : "Add or select a creator (client) in the header first."),
      );
      return;
    }
    setBusy(true);
    setStatus("Searching niche keywords…");
    const apiBase = getContentApiBase();
    const headersBase = await clientApiHeaders({ orgSlug });

    try {
      const d = await fetch(`${apiBase}/api/v1/clients/${clientSlug}/competitors/discover`, {
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
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy || disabled || !clientSlug.trim() || !orgSlug.trim()}
        title={disabledHint ?? undefined}
        onClick={() => void runDiscover()}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
        {busy ? "Discovering…" : "Discover competitors"}
      </button>
      <p className="text-[11px] leading-snug text-app-fg-subtle">
        Find accounts in your niche (Apify + AI scoring). After <strong>Refresh baseline</strong>, run{" "}
        <strong>Auto-profile</strong> first for better seed keywords.
      </p>
      {status ? (
        <p className="max-w-[260px] text-[11px] text-app-fg-muted">{status}</p>
      ) : null}
    </div>
  );
}
