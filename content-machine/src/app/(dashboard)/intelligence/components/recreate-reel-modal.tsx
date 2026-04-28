"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles, X } from "lucide-react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import type { ClientCarouselTemplate, ClientCoverTemplate, ScrapedReelRow } from "@/lib/api";
import {
  fetchClientCarouselTemplates,
  fetchClientCoverTemplates,
  generationStart,
} from "@/lib/api-client";

type Props = {
  open: boolean;
  onClose: () => void;
  reel: ScrapedReelRow | null;
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
};

/** Target production format the user wants to recreate the source reel as.
 * `auto` keeps the legacy behavior (use the source reel's original format). */
type RecreateFormatChoice = "auto" | "text_overlay" | "talking_head" | "carousel";

const RECREATE_FORMAT_OPTIONS: ReadonlyArray<{ key: RecreateFormatChoice; label: string; hint: string }> = [
  { key: "auto", label: "Auto", hint: "Keep source reel's original format" },
  { key: "text_overlay", label: "Text overlay", hint: "Static visuals + on-screen text blocks" },
  { key: "talking_head", label: "Talking head", hint: "You speak to camera the whole reel" },
  { key: "carousel", label: "Carousel", hint: "Swipeable PNG slides (not a video)" },
];

function CarouselTemplatePicker({
  templates,
  selectedId,
  onSelect,
  disabled,
}: {
  templates: ClientCarouselTemplate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-app-fg">
          Carousel template <span className="font-normal text-app-fg-muted">(required)</span>
        </p>
        <Link
          href="/context"
          className="text-[10px] font-semibold text-amber-700 hover:underline dark:text-amber-400"
        >
          Edit templates →
        </Link>
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Carousel template">
        {templates.map((template) => {
          const active = selectedId === template.id;
          return (
            <button
              key={template.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onSelect(template.id)}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                active
                  ? "border-amber-500/55 bg-amber-500/10 text-app-fg"
                  : "border-zinc-200/90 bg-white text-zinc-700 hover:border-zinc-300 dark:border-white/10 dark:bg-zinc-900/60 dark:text-app-fg-muted dark:hover:border-white/20"
              }`}
            >
              {template.name}
              <span className="ml-1 font-normal text-app-fg-subtle">
                · {template.slides.length} slides
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CoverTemplatePicker({
  templates,
  selectedId,
  onSelect,
  disabled,
}: {
  templates: ClientCoverTemplate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-app-fg">
          Cover template <span className="font-normal text-app-fg-muted">(required)</span>
        </p>
        <Link
          href="/context"
          className="text-[10px] font-semibold text-amber-700 hover:underline dark:text-amber-400"
        >
          Edit templates →
        </Link>
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cover template">
        {templates.map((template) => {
          const active = selectedId === template.id;
          return (
            <button
              key={template.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onSelect(template.id)}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                active
                  ? "border-amber-500/55 bg-amber-500/10 text-app-fg"
                  : "border-zinc-200/90 bg-white text-zinc-700 hover:border-zinc-300 dark:border-white/10 dark:bg-zinc-900/60 dark:text-app-fg-muted dark:hover:border-white/20"
              }`}
            >
              {template.name}
              <span className="ml-1 font-normal text-app-fg-subtle">
                · {template.reference_label ?? "1 image"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
  const [formatChoice, setFormatChoice] = useState<RecreateFormatChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [carouselTemplates, setCarouselTemplates] = useState<ClientCarouselTemplate[]>([]);
  const [selectedCarouselTemplateId, setSelectedCarouselTemplateId] = useState<string | null>(null);
  const [coverTemplates, setCoverTemplates] = useState<ClientCoverTemplate[]>([]);
  const [selectedCoverTemplateId, setSelectedCoverTemplateId] = useState<string | null>(null);
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
      setFormatChoice(null);
      setMsg(null);
      setPhase(null);
      setSessionId(null);
      setCarouselTemplates([]);
      setSelectedCarouselTemplateId(null);
      setCoverTemplates([]);
      setSelectedCoverTemplateId(null);
      setBusy(false);
      if (phaseTimerRef.current) {
        clearInterval(phaseTimerRef.current);
        phaseTimerRef.current = null;
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open || !clientSlug.trim() || !orgSlug.trim()) return;
    let cancelled = false;
    void Promise.all([
      fetchClientCarouselTemplates(clientSlug, orgSlug),
      fetchClientCoverTemplates(clientSlug, orgSlug),
    ]).then(([carouselRes, coverRes]) => {
      if (cancelled) return;
      if (carouselRes.ok) {
        setCarouselTemplates(carouselRes.data);
        if (carouselRes.data.length === 1) {
          setSelectedCarouselTemplateId(carouselRes.data[0].id);
        }
      }
      if (coverRes.ok) {
        setCoverTemplates(coverRes.data);
        if (coverRes.data.length === 1) {
          setSelectedCoverTemplateId(coverRes.data[0].id);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, clientSlug, orgSlug]);

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
    if (!formatChoice) {
      setMsg("Pick a target format to recreate the reel as.");
      return;
    }
    if (formatChoice === "carousel" && carouselTemplates.length > 0 && !selectedCarouselTemplateId) {
      setMsg("Pick a carousel template first.");
      return;
    }
    if (formatChoice !== "carousel" && coverTemplates.length > 0 && !selectedCoverTemplateId) {
      setMsg("Pick a cover template first.");
      return;
    }
    const selectedCarouselTemplate =
      formatChoice === "carousel" && selectedCarouselTemplateId
        ? carouselTemplates.find((template) => template.id === selectedCarouselTemplateId) ?? null
        : null;
    const selectedCoverTemplate =
      formatChoice !== "carousel" && selectedCoverTemplateId
        ? coverTemplates.find((template) => template.id === selectedCoverTemplateId) ?? null
        : null;

    setBusy(true);
    setMsg(null);
    setSessionId(null);
    startPhaseRotation();

    try {
      const res = await generationStart(clientSlug, orgSlug, {
        source_type: "url_adapt",
        url,
        extra_instruction: extraInstruction.trim() || undefined,
        format_key: formatChoice === "auto" ? undefined : formatChoice,
        selected_carousel_template: selectedCarouselTemplate ?? undefined,
        selected_cover_template: selectedCoverTemplate ?? undefined,
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
              Same core video idea as the competitor reel — pick the production format you want
              (or Auto to keep the source&apos;s). Examples, setting, and copy rewritten for your client.
              You pick one of five angles on Generate, then get script and caption.
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
            <div className="mt-4">
              <p className="mb-1.5 block text-xs font-semibold text-app-fg">
                Recreate as <span className="font-normal text-app-fg-muted">(required)</span>
              </p>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Target format">
                {RECREATE_FORMAT_OPTIONS.map(({ key, label, hint }) => {
                  const active = formatChoice === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      title={hint}
                      disabled={busy}
                      onClick={() => setFormatChoice(key)}
                      className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                        active
                          ? "border-amber-500/55 bg-amber-500/10 text-app-fg"
                          : "border-zinc-200/90 bg-white text-zinc-700 hover:border-zinc-300 dark:border-white/10 dark:bg-zinc-900/60 dark:text-app-fg-muted dark:hover:border-white/20"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-app-fg-subtle">
                {formatChoice && formatChoice !== "auto"
                  ? "We'll keep the source reel's idea + viewer payoff, but rebuild beats and on-screen language for this format."
                  : formatChoice === "auto"
                  ? "We'll mirror the source reel's original production format."
                  : "Pick a target format — Auto keeps the source reel's format, the others re-format the same idea."}
              </p>
            </div>

            {formatChoice === "carousel" ? (
              carouselTemplates.length > 0 ? (
                <CarouselTemplatePicker
                  templates={carouselTemplates}
                  selectedId={selectedCarouselTemplateId}
                  onSelect={setSelectedCarouselTemplateId}
                  disabled={busy}
                />
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-zinc-200/90 bg-white/60 p-3 text-[11px] leading-relaxed text-app-fg-muted dark:border-white/10 dark:bg-zinc-900/50">
                  No carousel templates configured yet.{" "}
                  <Link
                    href="/context"
                    className="font-semibold text-amber-700 hover:underline dark:text-amber-400"
                  >
                    Add one in Context
                  </Link>{" "}
                  to guide carousel structure from Media references.
                </div>
              )
            ) : formatChoice ? (
              coverTemplates.length > 0 ? (
                <CoverTemplatePicker
                  templates={coverTemplates}
                  selectedId={selectedCoverTemplateId}
                  onSelect={setSelectedCoverTemplateId}
                  disabled={busy}
                />
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-zinc-200/90 bg-white/60 p-3 text-[11px] leading-relaxed text-app-fg-muted dark:border-white/10 dark:bg-zinc-900/50">
                  No cover/thumbnail templates configured yet.{" "}
                  <Link
                    href="/context"
                    className="font-semibold text-amber-700 hover:underline dark:text-amber-400"
                  >
                    Add one in Context
                  </Link>{" "}
                  to preload cover creation from Media references.
                </div>
              )
            ) : null}

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
              disabled={busy || !postUrl || disabled || !formatChoice}
              onClick={() => void submit()}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-zinc-950 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
              {busy
                ? "Creating session…"
                : !formatChoice
                ? "Pick a target format above"
                : "Start adaptation"}
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
