"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { fetchReelAnalysisDetail } from "@/lib/api-client";
import { inlineMd } from "@/lib/inline-markdown";
import { formatSilasScoreSummary } from "@/lib/silas-score-display";
import type { ReelAnalysisDetail } from "@/lib/reel-types";

type Props = {
  open: boolean;
  onClose: () => void;
  reelId: string;
  clientSlug: string;
  orgSlug: string;
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-200/70 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.04]">
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-app-fg-subtle">
        {title}
      </h3>
      <div className="mt-2 text-[11px] leading-relaxed text-zinc-800 dark:text-app-fg-secondary">
        {children}
      </div>
    </div>
  );
}

function formatLines(fmt: Record<string, string> | undefined | null): React.ReactNode {
  if (!fmt || !Object.keys(fmt).length) return null;
  const order = ["format_type", "hook_type", "language", "duration_feel", "caption"];
  const keys = [...new Set([...order.filter((k) => k in fmt), ...Object.keys(fmt)])];
  return (
    <dl className="space-y-1">
      {keys.map((k) => {
        const v = fmt[k];
        if (!v) return null;
        const label = k.replace(/_/g, " ");
        return (
          <div key={k} className="flex gap-2">
            <dt className="w-28 shrink-0 capitalize text-zinc-500 dark:text-app-fg-muted">{label}</dt>
            <dd className="min-w-0 flex-1">{inlineMd(v)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function replicableList(el: Record<string, string> | null | undefined): React.ReactNode {
  if (!el || !Object.keys(el).length) return null;
  return (
    <ul className="list-inside list-disc space-y-1">
      {Object.entries(el).map(([k, v]) => (
        <li key={k}>
          <span className="font-medium capitalize">{k.replace(/_/g, " ")}:</span> {inlineMd(v)}
        </li>
      ))}
    </ul>
  );
}

function suggestedBlock(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length && typeof raw[0] === "string") return raw[0] as string;
  return null;
}

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
    void (async () => {
      setLoading(true);
      setErr(null);
      setData(null);
      setShowFull(false);
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
  const sum = json?.structured_summary;
  const ks = json?.keyword_similarity ?? null;
  // Niche-keyword analyses don't run Silas scoring. The DB row leaves every score
  // field null/0 and the real output lives under `keyword_similarity`. Detect it
  // so we don't show a meaningless "0/50 · Weak" headline for these rows.
  const isNicheAnalysis =
    !!ks &&
    (data?.source === "keyword_similarity" ||
      (data?.total_score == null || data?.total_score === 0)) &&
    (data?.prompt_version == null || !data.prompt_version.startsWith("silas_v2"));

  const wtRaw = json?.weighted_total;
  const wtParsed =
    wtRaw == null ? null : typeof wtRaw === "number" ? wtRaw : Number(wtRaw);
  const wt = wtParsed != null && Number.isFinite(wtParsed) ? wtParsed : null;
  const disp =
    data != null
      ? formatSilasScoreSummary({
          total_score: data.total_score,
          replicability_rating: data.replicability_rating,
          weighted_total: wt,
          silas_rating: typeof json?.rating === "string" ? json.rating : null,
          prompt_version: data.prompt_version,
        })
      : null;

  const why =
    data?.why_it_worked?.trim() ||
    sum?.content_summary?.trim() ||
    null;
  const hookType = data?.hook_type?.trim() || sum?.format?.hook_type || null;
  const contentAngle = data?.content_angle?.trim() || sum?.format?.format_type || null;
  const captionStruct = data?.caption_structure?.trim() || sum?.format?.caption || null;
  const emotional = data?.emotional_trigger?.trim() || null;
  const repl =
    (data?.replicable_elements && Object.keys(data.replicable_elements).length
      ? data.replicable_elements
      : null) ||
    sum?.replicable_elements ||
    null;
  const suggest =
    suggestedBlock(data?.suggested_adaptations) || sum?.suggested_adaptation?.trim() || null;

  const hasStructured =
    why ||
    hookType ||
    contentAngle ||
    captionStruct ||
    emotional ||
    (repl && Object.keys(repl).length) ||
    suggest;

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
              {isNicheAnalysis ? "Niche match" : "Silas analysis"}
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
            {isNicheAnalysis && ks ? (
              <>
                <div className="flex flex-wrap items-baseline gap-2">
                  {ks.similarity_score != null ? (
                    <span className="text-2xl font-bold text-zinc-900 dark:text-app-fg">
                      {ks.similarity_score}
                      <span className="text-sm font-normal text-zinc-500 dark:text-app-fg-muted">
                        % match
                      </span>
                    </span>
                  ) : null}
                  {ks.verdict ? (
                    <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[11px] font-medium capitalize text-purple-800 dark:text-purple-300">
                      {ks.verdict.replace(/_/g, " ")}
                    </span>
                  ) : null}
                  {videoFlag === false ? (
                    <span className="text-[10px] text-zinc-500 dark:text-app-fg-faint">
                      Caption-only (video unavailable or too large)
                    </span>
                  ) : null}
                </div>
                {ks.matched_keywords?.length ? (
                  <Section title="Matched keywords">
                    <div className="flex flex-wrap gap-1">
                      {ks.matched_keywords.map((kw) => (
                        <span
                          key={kw}
                          className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-medium text-purple-800 dark:text-purple-300"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </Section>
                ) : null}
                {ks.what_the_video_is_about ? (
                  <Section title="What this reel is about">{inlineMd(ks.what_the_video_is_about)}</Section>
                ) : null}
                {ks.what_matches ? (
                  <Section title="What matches your niche">{inlineMd(ks.what_matches)}</Section>
                ) : null}
                {ks.what_differs ? (
                  <Section title="What's different">{inlineMd(ks.what_differs)}</Section>
                ) : null}
                {ks.adaptation_angle ? (
                  <Section title="How to adapt this">{inlineMd(ks.adaptation_angle)}</Section>
                ) : null}
              </>
            ) : (
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-2xl font-bold text-zinc-900 dark:text-app-fg">
                  {disp?.scoreText ?? "—"}
                  <span className="text-sm font-normal text-zinc-500 dark:text-app-fg-muted">
                    {disp?.maxSuffix ?? ""}
                  </span>
                </span>
                {disp?.ratingText ? (
                  <span className="rounded-full bg-zinc-200/90 px-2 py-0.5 text-[11px] font-medium text-zinc-800 dark:bg-white/15 dark:text-app-fg">
                    {disp.ratingText}
                  </span>
                ) : null}
                {videoFlag === false ? (
                  <span className="text-[10px] text-zinc-500 dark:text-app-fg-faint">
                    Caption-only (video unavailable or too large)
                  </span>
                ) : null}
              </div>
            )}
            {!isNicheAnalysis && scores ? (
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

            {!isNicheAnalysis && hasStructured ? (
              <div className="space-y-2">
                {why ? <Section title="Summary">{inlineMd(why)}</Section> : null}
                {emotional ? <Section title="Relatability signal">{inlineMd(emotional)}</Section> : null}
                {hookType || contentAngle || captionStruct ? (
                  <Section title="Format">
                    {hookType ? (
                      <p className="mb-1">
                        <span className="text-zinc-500 dark:text-app-fg-muted">Hook type:</span> {inlineMd(hookType)}
                      </p>
                    ) : null}
                    {contentAngle ? (
                      <p className="mb-1">
                        <span className="text-zinc-500 dark:text-app-fg-muted">Type:</span> {inlineMd(contentAngle)}
                      </p>
                    ) : null}
                    {captionStruct ? (
                      <p>
                        <span className="text-zinc-500 dark:text-app-fg-muted">Caption:</span> {inlineMd(captionStruct)}
                      </p>
                    ) : null}
                    {!hookType && !contentAngle && !captionStruct && sum?.format
                      ? formatLines(sum.format)
                      : null}
                  </Section>
                ) : sum?.format && Object.keys(sum.format).length ? (
                  <Section title="Format">{formatLines(sum.format)}</Section>
                ) : null}
                {repl && Object.keys(repl).length ? (
                  <Section title="Replicable elements">{replicableList(repl)}</Section>
                ) : null}
                {suggest ? <Section title="Suggested adaptation">{inlineMd(suggest)}</Section> : null}
              </div>
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
            {data.analyzed_at ? (
              <p className="text-[10px] text-zinc-500 dark:text-app-fg-faint">
                Analyzed {new Date(data.analyzed_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
