"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Radar } from "lucide-react";

type Props = {
  apiBase: string;
  orgSlug: string;
  clientSlug: string;
};

/** Client-side discover + job polling for Intelligence page. */
export function DiscoverPanel({ apiBase, orgSlug, clientSlug }: Props) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pollJob(jobId: string) {
    const max = 120;
    for (let i = 0; i < max; i++) {
      const r = await fetch(`${apiBase}/api/v1/jobs/${jobId}`, {
        headers: { "X-Org-Slug": orgSlug },
      });
      if (!r.ok) {
        setStatus(`Job status error: ${r.status}`);
        return;
      }
      const j = await r.json();
      if (j.status === "completed") {
        setStatus(
          `Done — saved ${j.result?.competitors_saved ?? "?"} competitors (evaluated ${j.result?.evaluated ?? "?"}).`,
        );
        router.refresh();
        return;
      }
      if (j.status === "failed") {
        setStatus(j.error_message || "Job failed");
        return;
      }
      setStatus(`Job ${j.status}… (${i + 1}/${max})`);
      await new Promise((r2) => setTimeout(r2, 3000));
    }
    setStatus("Timed out waiting for job — check worker logs.");
  }

  async function onDiscover() {
    setBusy(true);
    setStatus("Queueing discovery…");
    try {
      const body: Record<string, unknown> = {};
      if (keyword.trim()) body.keyword = keyword.trim();
      const r = await fetch(
        `${apiBase}/api/v1/clients/${clientSlug}/competitors/discover`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Org-Slug": orgSlug,
          },
          body: JSON.stringify(body),
        },
      );
      if (!r.ok) {
        setStatus(await r.text());
        return;
      }
      const { job_id } = await r.json();
      setStatus("Job queued — polling…");
      await pollJob(job_id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-6">
      <div className="mb-4 flex items-center gap-2">
        <Radar className="h-5 w-5 text-primary" aria-hidden />
        <h3 className="text-lg font-bold text-on-surface">Competitor discovery</h3>
      </div>
      <p className="mb-4 text-sm text-zinc-400">
        Runs Apify + OpenRouter (worker must be running). Leave keyword empty to use the first
        niche keyword from the client config.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            Keyword (optional)
          </span>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="e.g. toxic workplace"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onDiscover()}
          className="flex items-center justify-center gap-2 rounded-lg bg-primary-container px-6 py-2.5 text-sm font-bold text-on-primary-container disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {busy ? "Running…" : "Run discovery"}
        </button>
      </div>
      {status ? (
        <p className="mt-4 whitespace-pre-wrap font-mono text-xs text-zinc-400">{status}</p>
      ) : null}
    </div>
  );
}
