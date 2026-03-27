"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { clientApiHeaders, contentApiFetch, getContentApiBase } from "@/lib/api-client";
import type { ClientRow } from "@/lib/api";

type Props = {
  clientSlug: string;
  orgSlug: string;
  client: ClientRow | null;
  disabled?: boolean;
};

function NicheKeywordLists({ nicheConfig }: { nicheConfig: unknown[] }) {
  if (!nicheConfig.length) {
    return (
      <p className="text-sm text-zinc-400">
        No niche profile yet. Run <strong>Re-generate</strong> after you have reels in Intelligence (use{" "}
        <strong>Update my reels</strong> on the Dashboard first).
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {nicheConfig.map((raw, i) => {
        if (!raw || typeof raw !== "object") return null;
        const n = raw as Record<string, unknown>;
        const name = String(n.name ?? n.id ?? `Niche ${i + 1}`);
        const kwEn = Array.isArray(n.keywords) ? n.keywords.map(String) : [];
        const kwDe = Array.isArray(n.keywords_de) ? n.keywords_de.map(String) : [];
        const tagsEn = Array.isArray(n.hashtags) ? n.hashtags.map(String) : [];
        const tagsDe = Array.isArray(n.hashtags_de) ? n.hashtags_de.map(String) : [];
        const topicEn = Array.isArray(n.topic_keywords) ? n.topic_keywords.map(String) : [];
        const topicDe = Array.isArray(n.topic_keywords_de) ? n.topic_keywords_de.map(String) : [];

        return (
          <div key={name + i} className="rounded-xl border border-outline-variant/15 bg-surface-container-low/50 p-4">
            <h3 className="text-sm font-semibold text-on-surface">{name}</h3>
            {n.description ? (
              <p className="mt-1 text-xs text-zinc-400">{String(n.description).slice(0, 280)}</p>
            ) : null}
            <dl className="mt-3 space-y-2 text-xs">
              {kwEn.length ? (
                <div>
                  <dt className="font-medium text-zinc-500">Primary identity keywords</dt>
                  <dd className="mt-0.5 text-zinc-300">{kwEn.join(" · ")}</dd>
                </div>
              ) : null}
              {kwDe.length ? (
                <div>
                  <dt className="font-medium text-zinc-500">Additional identity keywords</dt>
                  <dd className="mt-0.5 text-zinc-300">{kwDe.join(" · ")}</dd>
                </div>
              ) : null}
              {topicEn.length || topicDe.length ? (
                <div>
                  <dt className="font-medium text-zinc-500">Topic keywords (reel search)</dt>
                  <dd className="mt-0.5 text-zinc-300">
                    {[...topicEn, ...topicDe].filter(Boolean).join(" · ") || "—"}
                  </dd>
                </div>
              ) : null}
              {tagsEn.length || tagsDe.length ? (
                <div>
                  <dt className="font-medium text-zinc-500">Hashtags</dt>
                  <dd className="mt-0.5 text-zinc-300">
                    {[...tagsEn.map((t) => `#${t}`), ...tagsDe.map((t) => `#${t}`)].join(" ")}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

export function NicheProfilePanel({ clientSlug, orgSlug, client, disabled }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function runAutoProfile() {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      setStatus("Select a workspace and creator first.");
      return;
    }
    setBusy(true);
    setStatus(null);
    const apiBase = getContentApiBase();
    const headersBase = await clientApiHeaders({ orgSlug });
    try {
      const r = await contentApiFetch(`${apiBase}/api/v1/clients/${clientSlug}/auto-profile`, {
        method: "POST",
        headers: headersBase,
      });
      if (r.status === 409) {
        setStatus("Already running — wait a moment.");
        return;
      }
      if (!r.ok) {
        const err = await r.text();
        setStatus(err ? err.slice(0, 240) : "Failed.");
        return;
      }
      const json = (await r.json()) as {
        result?: { niches_count?: number; seeds_count?: number };
      };
      const n = json.result?.niches_count ?? 0;
      const s = json.result?.seeds_count ?? 0;
      setStatus(`Updated — ${n} niche(s), ${s} seed account(s).`);
      router.refresh();
    } catch {
      setStatus("Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (!clientSlug.trim()) {
    return (
      <p className="text-sm text-zinc-400">
        Select a creator in the header to manage niche keywords.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-400">
        These keywords power <strong>Discover</strong> (bio search) and topic chips in Intelligence. They are
        generated from your recent reel captions + bio — review and re-run when your content shifts.
      </p>
      <NicheKeywordLists nicheConfig={client?.niche_config ?? []} />
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => void runAutoProfile()}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
          {busy ? "Generating…" : "Re-generate from latest reels"}
        </button>
        {status ? <span className="text-xs text-zinc-400">{status}</span> : null}
      </div>
    </div>
  );
}
