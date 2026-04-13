"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles, X } from "lucide-react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import type { ScrapedReelRow } from "@/lib/api";
import { generationStart } from "@/lib/api-client";

type Props = {
  open: boolean;
  onClose: () => void;
  reel: ScrapedReelRow | null;
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
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

const PHASE_TICK_MS = 6000;

export function RecreateReelModal({
  open,
  onClose,
  reel,
  clientSlug,
  orgSlug,
  disabled,
  disabledHint,
}: Props) {
  const [extraInstruction, setExtraInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasAnalysis = Boolean(reel?.analysis);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, busy, onClose]);

  useEffect(() => {
    if (!open) {
      setExtraInstruction("");
      setMsg(null);
      setPhase(null);
      setSessionId(null);
      setBusy(false);
      if (phaseTimerRef.current) {
        clearInterval(phaseTimerRef.current);
        phaseTimerRef.current = null;
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function clearPhaseTimer() {
    if (phaseTimerRef.current) {
      clearInterval(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
  }

  function startPhaseRotation() {
    clearPhaseTimer();
    const phases = hasAnalysis
      ? [
          "Using your existing analysis…",
          "Extracting adaptation patterns for your client…",
          "Generating angle options…",
        ]
      : [
          "Scraping reel & downloading video…",
          "Analyzing with Gemini (video + criteria)…",
          "Extracting adaptation patterns…",
          "Generating angle options…",
        ];
    let i = 0;
    setPhase(phases[0] ?? "Working…");
    phaseTimerRef.current = setInterval(() => {
      i = (i + 1) % phases.length;
      setPhase(phases[i] ?? "Still working…");
    }, PHASE_TICK_MS);
  }

  async function submit() {
    const url = reel?.post_url?.trim() ?? "";
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      setMsg(
        disabledHint?.trim() ||
          (!orgSlug.trim()
            ? "No organization context — refresh the page or sign in again."
            : "Pick a creator in the header first."),
      );
      return;
    }
    if (!url || !isLikelyInstagramReelUrl(url)) {
      setMsg("This reel has no valid Instagram link.");
      return;
    }

    setBusy(true);
    setMsg(null);
    setSessionId(null);
    startPhaseRotation();

    try {
      const res = await generationStart(clientSlug, orgSlug, {
        source_type: "url_adapt",
        url,
        extra_instruction: extraInstruction.trim() || undefined,
      });
      clearPhaseTimer();
      setPhase(null);
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setSessionId(res.data.id);
    } catch (e) {
      clearPhaseTimer();
      setPhase(null);
      setMsg(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!open || !reel) {
    return null;
  }

  const postUrl = reel.post_url?.trim() ?? "";
  const excerpt =
    (reel.hook_text || reel.caption || "").trim().slice(0, 160) ||
    "No caption stored — structure still comes from video when analyzed.";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm dark:bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recreate-reel-title"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200/90 bg-zinc-50 p-5 shadow-2xl dark:border-white/12 dark:bg-zinc-950/95"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h2 id="recreate-reel-title" className="text-sm font-semibold text-app-fg">
              Adapt this reel for your client
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-app-fg-subtle">
              Same format and core video idea as the competitor reel; examples, setting, and copy rewritten for your
              client. You pick one of five angles on Generate, then get script and caption.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-200/80 disabled:opacity-40 dark:text-app-fg-subtle dark:hover:bg-white/10"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-3 rounded-xl border border-zinc-200/80 bg-white/70 p-3 dark:border-white/10 dark:bg-zinc-900/50">
          <div className="shrink-0">
            <ReelThumbnail src={reel.thumbnail_url} alt="" size="md" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-app-fg">@{reel.account_username}</p>
            <p className="mt-0.5 text-[10px] tabular-nums text-app-fg-muted">
              {reel.views != null ? `${reel.views.toLocaleString()} views` : "—"}{" "}
              {reel.comments != null ? `· ${reel.comments.toLocaleString()} comments` : ""}
            </p>
            <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-app-fg-secondary">{excerpt}</p>
            {hasAnalysis ? (
              <p className="mt-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300/90">
                Existing Silas analysis — faster path (no full video re-download when already in your DB).
              </p>
            ) : (
              <p className="mt-1.5 text-[10px] text-app-fg-subtle">
                First run may take ~1 minute (scrape + video analysis). You can close Intelligence after opening
                Generate.
              </p>
            )}
          </div>
        </div>

        {!sessionId ? (
          <>
            <label htmlFor="recreate-extra" className="mt-4 block text-xs font-semibold text-app-fg">
              Extra focus <span className="font-normal text-app-fg-muted">(optional)</span>
            </label>
            <textarea
              id="recreate-extra"
              rows={3}
              value={extraInstruction}
              onChange={(e) => setExtraInstruction(e.target.value)}
              disabled={busy}
              placeholder="e.g. Stronger German workplace framing, or keep the list format but change the topic…"
              className="mt-1.5 w-full resize-y rounded-xl border border-zinc-200/90 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 disabled:opacity-60 dark:border-white/10 dark:bg-zinc-900/80 dark:text-app-fg dark:placeholder:text-app-fg-faint"
            />

            <button
              type="button"
              disabled={busy || !postUrl || disabled}
              onClick={() => void submit()}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-zinc-950 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
              {busy ? "Creating session…" : "Start adaptation"}
            </button>
          </>
        ) : (
          <div className="mt-4 space-y-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
            <p className="text-sm font-semibold text-app-fg">Angles ready</p>
            <p className="text-xs text-app-fg-muted">
              Open Generate to pick an angle, then get script and captions for your client.
            </p>
            <Link
              href={`/generate?session=${encodeURIComponent(sessionId)}`}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-zinc-950"
              onClick={onClose}
            >
              Continue in Generate
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="w-full text-center text-xs font-semibold text-app-fg-muted hover:text-app-fg"
            >
              Close
            </button>
          </div>
        )}

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
      </div>
    </div>
  );
}
