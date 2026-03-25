"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { fetchReelAnalysisDetail } from "@/lib/api-client";
import { replicabilityLabel } from "@/lib/replicability-label";
import type { ReelAnalysisDetail } from "@/lib/reel-types";

type Props = {
  open: boolean;
  onClose: () => void;
  reelId: string;
  clientSlug: string;
  orgSlug: string;
};

export function ReelAnalysisDetailModal({ open, onClose, reelId, clientSlug, orgSlug }: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ReelAnalysisDetail | null>(null);
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    if (!open || !reelId.trim() || !clientSlug.trim() || !orgSlug.trim()) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setData(null);
    setShowFull(false);
    void (async () => {
      const res = await fetchReelAnalysisDetail(clientSlug, orgSlug, reelId);
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setData(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, reelId, clientSlug, orgSlug]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  const json = data?.full_analysis_json;
  const fullText = json?.full_text;
  const scores = json?.scores;
  const videoFlag = data?.video_analyzed ?? json?.video_analyzed;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm dark:bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reel-analysis-title"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200/90 bg-zinc-50 p-5 shadow-xl dark:border-white/12 dark:bg-zinc-950/95 dark:shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h2 id="reel-analysis-title" className="text-sm font-semibold text-zinc-900 dark:text-app-fg">
              Silas analysis
            </h2>
            {data?.owner_username ? (
              <p className="mt-1 text-[11px] text-zinc-600 dark:text-app-fg-subtle">
                @{data.owner_username}
              </p>
            ) : null}
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

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-zinc-600 dark:text-app-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading analysis…
          </div>
        ) : err ? (
          <p className="py-4 text-xs text-amber-700 dark:text-amber-200/90" role="alert">
            {err}
          </p>
        ) : data ? (
          <div className="space-y-3 text-xs text-zinc-800 dark:text-app-fg-secondary">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-2xl font-bold text-zinc-900 dark:text-app-fg">
                {data.total_score ?? "—"}
                <span className="text-sm font-normal text-zinc-500 dark:text-app-fg-muted">/50</span>
              </span>
              {data.replicability_rating ? (
                <span className="rounded-full bg-zinc-200/90 px-2 py-0.5 text-[11px] font-medium text-zinc-800 dark:bg-white/15 dark:text-app-fg">
                  {replicabilityLabel(data.replicability_rating)}
                </span>
              ) : null}
              {videoFlag === false ? (
                <span className="text-[10px] text-zinc-500 dark:text-app-fg-faint">
                  Caption-only (video unavailable or too large)
                </span>
              ) : null}
            </div>
            {scores ? (
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {(
                  [
                    ["instant_hook", "Instant hook"],
                    ["high_relatability", "Relatability"],
                    ["cognitive_tension", "Cognitive tension"],
                    ["clear_value", "Clear value"],
                    ["comment_trigger", "Comment trigger"],
                  ] as const
                ).map(([key, label]) => (
                  <li
                    key={key}
                    className="flex justify-between gap-2 rounded-lg border border-zinc-200/80 bg-white/80 px-2 py-1.5 dark:border-white/10 dark:bg-white/5"
                  >
                    <span className="text-zinc-600 dark:text-app-fg-muted">{label}</span>
                    <span className="font-mono text-zinc-900 dark:text-app-fg">
                      {scores[key] != null ? `${scores[key]}/10` : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {fullText ? (
              <div>
                <button
                  type="button"
                  onClick={() => setShowFull((s) => !s)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg py-2 text-left text-[11px] font-medium text-zinc-600 hover:text-zinc-900 dark:text-app-fg-muted dark:hover:text-app-fg"
                >
                  Full model output
                  {showFull ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {showFull ? (
                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-200/80 bg-zinc-100/90 p-3 text-[11px] leading-relaxed text-zinc-800 dark:border-white/10 dark:bg-black/40 dark:text-app-fg-secondary">
                    {fullText}
                  </pre>
                ) : null}
              </div>
            ) : null}
            <p className="text-[10px] text-zinc-500 dark:text-app-fg-faint">
              {data.prompt_version ? `${data.prompt_version}` : null}
              {data.model_used ? ` · ${data.model_used}` : null}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
