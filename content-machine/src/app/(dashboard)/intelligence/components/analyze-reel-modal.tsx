"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Link2, Loader2, X } from "lucide-react";
import {
  clientApiHeaders,
  contentApiFetch,
  formatFastApiError,
  getContentApiBase,
} from "@/lib/api-client";
import { formatSilasScoreSummary } from "@/lib/silas-score-display";

type Props = {
  open: boolean;
  onClose: () => void;
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
  /** When opening the modal, pre-fill the URL field (e.g. from a reel row). */
  initialUrl?: string | null;
  /** Lets the parent disable row actions and show a shared progress area while this job runs. */
  onAnalysisJobEnqueued?: (jobId: string) => void;
};

function isLikelyInstagramReelUrl(s: string): boolean {
  const t = s.trim().toLowerCase();
  return (
    t.includes("instagram.com/reel") ||
    t.includes("instagram.com/reels/") ||
    t.includes("instagram.com/p/") ||
    t.includes("instagram.com/tv/")
  );
}

type JobRow = {
  id: string;
  status: string;
  result?: {
    status?: string;
    error?: string;
    reel?: {
      url: string;
      owner: string;
      views?: number;
      likes?: number;
      comments?: number;
      duration?: number;
      timestamp?: string | null;
    };
    analysis?: {
      total_score: number | null;
      rating: string;
      weighted_total?: number | null;
      raw_scores?: Record<string, number | null | undefined>;
      scores?: Record<string, number | null | undefined>;
      full_text?: string;
      prompt_version?: string;
      model?: string;
      analyzed_at?: string;
      video_analyzed?: boolean;
    };
    analysis_id?: string;
    reel_id?: string;
    persist_error?: string;
  } | null;
  error_message?: string | null;
};

const POLL_MS = 2000;
const MAX_POLLS = 90;

export function AnalyzeReelModal({
  open,
  onClose,
  clientSlug,
  orgSlug,
  disabled,
  disabledHint,
  initialUrl,
  onAnalysisJobEnqueued,
}: Props) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<JobRow["result"] | null>(null);
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setUrl("");
      setMsg(null);
      setPhase(null);
      setResult(null);
      setShowFull(false);
      setBusy(false);
    } else {
      setUrl(initialUrl?.trim() ?? "");
      setMsg(null);
      setPhase(null);
      setResult(null);
      setShowFull(false);
      setBusy(false);
    }
  }, [open, initialUrl]);

  if (!open) {
    return null;
  }

  async function submit() {
    const trimmed = url.trim();
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      setMsg(
        disabledHint?.trim() ||
          (!orgSlug.trim()
            ? "No organization context — refresh the page or sign in again."
            : "Pick a creator in the header first."),
      );
      return;
    }
    if (!trimmed) {
      setMsg("Paste a reel URL.");
      return;
    }
    if (!isLikelyInstagramReelUrl(trimmed)) {
      setMsg("Use an Instagram reel or post URL (reel, reels, /p/, or /tv/).");
      return;
    }

    setBusy(true);
    setMsg(null);
    setPhase("Queued — scraping + analysis (~1 min)…");
    setResult(null);
    setShowFull(false);

    const apiBase = getContentApiBase();
    const headersBase = await clientApiHeaders({ orgSlug });

    try {
      const postRes = await contentApiFetch(
        `${apiBase}/api/v1/clients/${encodeURIComponent(clientSlug)}/reels/analyze-url`,
        {
          method: "POST",
          headers: { ...headersBase, "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed }),
        },
      );

      const postJson = (await postRes.json().catch(() => ({}))) as {
        job_id?: string;
        detail?: unknown;
      };

      if (!postRes.ok) {
        setMsg(formatFastApiError(postJson, `Request failed (${postRes.status})`));
        setPhase(null);
        return;
      }

      const jobId = postJson.job_id;
      if (!jobId) {
        setMsg("No job_id returned from server.");
        setPhase(null);
        return;
      }

      onAnalysisJobEnqueued?.(jobId);

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        setPhase(
          i < 8
            ? "Scraping reel & downloading video…"
            : i < 25
              ? "Analyzing with Gemini (video + criteria)…"
              : "Still working…",
        );

        const jRes = await contentApiFetch(`${apiBase}/api/v1/jobs/${encodeURIComponent(jobId)}`, {
          headers: headersBase,
        });
        const job = (await jRes.json().catch(() => ({}))) as JobRow;

        if (!jRes.ok) {
          setMsg(formatFastApiError(job as unknown as Record<string, unknown>, "Could not load job status"));
          setPhase(null);
          return;
        }

        if (job.status === "failed") {
          setMsg(job.error_message || "Analysis failed.");
          setPhase(null);
          return;
        }

        if (job.status === "completed" && job.result) {
          setPhase(null);
          setResult(job.result);
          if (job.result.status === "error") {
            const code = job.result.error || "unknown";
            const human =
              code === "reel_not_found"
                ? "No reel data — link may be invalid or removed."
                : code === "private_account"
                  ? "No video URL — reel may be private or unavailable."
                  : code;
            setMsg(human);
          } else {
            setMsg(null);
          }
          return;
        }
      }

      setMsg("Timed out waiting for analysis. Check Intelligence later or retry.");
      setPhase(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Network error.");
      setPhase(null);
    } finally {
      setBusy(false);
    }
  }

  const success =
    result?.status === "completed" && result.analysis && result.reel
      ? { analysis: result.analysis, reel: result.reel }
      : null;
  const scores = success?.analysis.scores;
  const jobSilas = success
    ? formatSilasScoreSummary({
        total_score: success.analysis.total_score,
        weighted_total: success.analysis.weighted_total ?? null,
        rating: success.analysis.rating,
        prompt_version: success.analysis.prompt_version ?? null,
      })
    : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm dark:bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-labelledby="analyze-reel-title"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-zinc-200/90 bg-zinc-50 p-5 shadow-2xl dark:border-white/12 dark:bg-zinc-950/95"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h2 id="analyze-reel-title" className="text-sm font-semibold text-app-fg">
              Analyze a reel
            </h2>
            <p className="mt-1 text-[11px] text-app-fg-subtle">
              Public Instagram URL → scrape → full-video scoring on the five Silas criteria (~1 minute).
            </p>
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
        <input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setMsg(null);
          }}
          placeholder="https://www.instagram.com/reel/… or /p/…"
          disabled={busy}
          className="mb-3 w-full rounded-xl border border-zinc-200/90 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 disabled:opacity-60 dark:border-white/10 dark:bg-zinc-900/80 dark:text-app-fg dark:placeholder:text-app-fg-faint"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-zinc-950 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
          {busy ? "Working…" : "Analyze"}
        </button>
        {phase ? (
          <p className="mt-3 text-xs text-zinc-600 dark:text-app-fg-muted" aria-live="polite">
            {phase}
          </p>
        ) : null}
        {msg ? (
          <p className="mt-3 text-xs text-amber-800 dark:text-amber-200/90" role="alert">
            {msg}
          </p>
        ) : null}

        {success ? (
          <div className="mt-5 space-y-3 border-t border-zinc-200/90 pt-4 text-xs text-zinc-800 dark:border-white/10 dark:text-app-fg-secondary">
            {result?.analysis_id && !result?.persist_error ? (
              <p className="text-[10px] text-zinc-500 dark:text-app-fg-faint">
                Saved — appears on your reel cards and under{" "}
                <span className="font-medium text-zinc-700 dark:text-app-fg-muted">View all reels</span>.
              </p>
            ) : null}
            {result?.persist_error ? (
              <p className="text-[10px] text-amber-800 dark:text-amber-200/80" role="status">
                DB save failed: {result.persist_error}. Apply{" "}
                <code className="rounded bg-zinc-200/80 px-1 dark:bg-black/40">backend/sql/phase2_reel_analyses.sql</code>{" "}
                in Supabase.
              </p>
            ) : null}
            <p>
              <span className="text-zinc-600 dark:text-app-fg-subtle">@{success.reel.owner}</span>
              {success.reel.views != null ? (
                <span className="ml-2 text-zinc-500 dark:text-app-fg-muted">
                  {success.reel.views.toLocaleString()} views
                </span>
              ) : null}
            </p>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-2xl font-bold text-zinc-900 dark:text-app-fg">
                {jobSilas?.scoreText ?? "—"}
                <span className="text-sm font-normal text-zinc-500 dark:text-app-fg-muted">
                  {jobSilas?.maxSuffix ?? ""}
                </span>
              </span>
              {jobSilas?.ratingText ? (
                <span className="rounded-full bg-zinc-200/90 px-2 py-0.5 text-[11px] font-medium text-zinc-800 dark:bg-white/12 dark:text-app-fg">
                  {jobSilas.ratingText}
                </span>
              ) : null}
              {success.analysis.video_analyzed === false ? (
                <span className="text-[10px] text-zinc-500 dark:text-app-fg-faint">
                  Caption-only (video too large or unavailable)
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
            {success.analysis.full_text ? (
              <div>
                <button
                  type="button"
                  onClick={() => setShowFull((s) => !s)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg py-2 text-left text-[11px] font-medium text-zinc-600 hover:text-zinc-900 dark:text-app-fg-muted dark:hover:text-app-fg"
                >
                  Full analysis
                  {showFull ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {showFull ? (
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-200/80 bg-zinc-100/90 p-3 text-[11px] leading-relaxed text-zinc-800 dark:border-white/10 dark:bg-black/40 dark:text-app-fg-secondary">
                    {success.analysis.full_text}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
