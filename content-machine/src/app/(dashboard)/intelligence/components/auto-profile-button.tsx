"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { clientApiHeaders, getContentApiBase } from "@/lib/api-client";

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
};

export function AutoProfileButton({ clientSlug, orgSlug, disabled, disabledHint }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function runAutoProfile() {
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
    setStatus("Analyzing your reels + bio (identity keywords for search)…");
    const apiBase = getContentApiBase();
    const headersBase = await clientApiHeaders({ orgSlug });

    try {
      const r = await fetch(`${apiBase}/api/v1/clients/${clientSlug}/auto-profile`, {
        method: "POST",
        headers: headersBase,
      });
      if (r.status === 409) {
        setStatus("Auto-profile already running — please wait.");
        return;
      }
      if (!r.ok) {
        const err = await r.text();
        setStatus(err ? `Error: ${err.slice(0, 240)}` : "Something went wrong — try again.");
        return;
      }
      const json = (await r.json()) as {
        result?: { niches_count?: number; seeds_count?: number; captions_used?: number };
      };
      const n = json.result?.niches_count ?? 0;
      const s = json.result?.seeds_count ?? 0;
      setStatus(`Done — ${n} niche(s), ${s} seed account(s). Run Discover next.`);
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
        onClick={() => void runAutoProfile()}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-violet-400/45 bg-violet-500/12 px-4 py-2 text-sm font-semibold text-violet-100 transition-colors hover:bg-violet-500/22 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
        {busy ? "Profiling…" : "Auto-profile"}
      </button>
      <p className="text-[11px] leading-snug text-app-fg-subtle">
        Refresh niche keywords from your reels (bio-style search terms + seed competitors). Run after baseline.
      </p>
      {status ? (
        <p className="max-w-[260px] text-[11px] text-app-fg-muted">{status}</p>
      ) : null}
    </div>
  );
}
