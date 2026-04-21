"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  Film,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import { PostPreviewModal } from "@/components/post-preview-modal";
import {
  brollDelete,
  brollList,
  carouselSlideRegenerate,
  carouselSlidesGenerate,
  carouselSlidesPatch,
  carouselSlidesZipUrl,
  clientImagesList,
  creationGenerateBackground,
  creationRenderVideo,
  creationSetBackgroundImage,
  creationSetBroll,
  fetchBackgroundJob,
  generationComposeThumbnail,
  generationGenerateThumbnail,
  generationGetSession,
  generationRegenerate,
  generationRegenerateCovers,
  patchCreateSession,
  type BrollClipRow,
  type CarouselSlide,
  type ClientImageRow,
  type GenerationSession,
  type TextBlock,
} from "@/lib/api-client";

const POLL_MS = 4000;
const MAX_POLLS = 90;

function canonicalFormatKey(k: string | null | undefined): string | null {
  if (!k?.trim()) return null;
  if (k === "b_roll") return "b_roll_reel";
  return k;
}

/**
 * Inline regenerate control (replaces the old global "Refine" panel).
 * Lives next to the section it regenerates and posts back to the same `/regenerate` endpoint
 * with a per-section `scope`. Optional one-line feedback is forwarded to the LLM.
 */
function RegenInline({
  scope,
  busy,
  onRegen,
  placeholder = "How should this change? (optional)",
}: {
  scope: "hooks" | "script" | "caption" | "text_blocks";
  busy: boolean;
  onRegen: (scope: "hooks" | "script" | "caption" | "text_blocks", feedback: string) => Promise<void>;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-app-divider px-2 py-1 text-[11px] font-semibold text-app-fg-muted hover:text-app-fg disabled:opacity-40"
      >
        <RefreshCw className="h-3 w-3" /> Regenerate
      </button>
    );
  }

  return (
    <div className="flex flex-1 items-center gap-1.5 sm:max-w-md">
      <input
        type="text"
        autoFocus
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder={placeholder}
        className="glass-inset min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-[11px] text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-1 focus:ring-amber-500/35"
      />
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          await onRegen(scope, feedback.trim());
          setFeedback("");
          setOpen(false);
        }}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-amber-500/15 px-2.5 py-1.5 text-[11px] font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        Run
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setFeedback("");
        }}
        className="rounded-lg p-1 text-app-fg-subtle hover:text-app-fg"
        aria-label="Cancel"
      >
        ✕
      </button>
    </div>
  );
}

function BrollLibrarySection({
  clips,
  loading,
  deletingClipId,
  selectedClipId,
  sessionBrollClipId,
  showClipBanner,
  clipBannerUrl,
  onPick,
  onDelete,
}: {
  clips: BrollClipRow[];
  loading: boolean;
  deletingClipId: string | null;
  selectedClipId: string;
  sessionBrollClipId?: string | null;
  showClipBanner: boolean;
  clipBannerUrl?: string | null;
  onPick: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      {showClipBanner && clipBannerUrl ? (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-4 py-3">
          <Film className="h-4 w-4 shrink-0 text-emerald-500" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">B-roll set</p>
            <p className="truncate text-[11px] text-app-fg-muted">{clipBannerUrl}</p>
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold text-app-fg">
          B-roll library{" "}
          <span className="font-normal text-app-fg-muted">
            ({clips.length} clip{clips.length !== 1 ? "s" : ""})
          </span>
        </p>
        <Link
          href="/media?tab=broll"
          className="text-[11px] font-semibold text-sky-500 hover:underline dark:text-sky-400"
        >
          Manage in Media →
        </Link>
      </div>

      {clips.length === 0 ? (
        <div className="rounded-xl border border-dashed border-app-divider/60 py-8 text-center">
          <Film className="mx-auto mb-2 h-6 w-6 text-app-fg-subtle opacity-30" />
          <p className="mb-3 text-xs text-app-fg-subtle">No clips yet.</p>
          <Link
            href="/media?tab=broll"
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25"
          >
            <Plus className="h-3 w-3" />
            Upload B-roll
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {clips.map((c) => {
            const isActive = selectedClipId === c.id || sessionBrollClipId === c.id;
            return (
              <div
                key={c.id}
                className={`group relative flex flex-col gap-1.5 rounded-xl border p-3 transition-colors ${
                  isActive
                    ? "border-amber-500/45 bg-amber-500/10"
                    : "border-app-divider hover:border-white/20"
                }`}
              >
                <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-black/30">
                  {c.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumbnail_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Film className="h-5 w-5 text-app-fg-subtle opacity-40" />
                  )}
                </div>
                <p className="line-clamp-1 text-[11px] font-medium text-app-fg">
                  {c.label || `Clip ${c.id.slice(0, 6)}`}
                </p>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={loading || isActive}
                    onClick={() => void onPick(c.id)}
                    className="flex-1 rounded-lg bg-amber-500/15 py-1 text-[10px] font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-40"
                  >
                    {isActive ? "Active" : "Use clip"}
                  </button>
                  <button
                    type="button"
                    disabled={deletingClipId === c.id}
                    onClick={() => void onDelete(c.id)}
                    className="rounded-lg p-1 text-app-fg-subtle hover:bg-red-500/10 hover:text-red-400"
                    aria-label="Delete clip"
                  >
                    {deletingClipId === c.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ClientImagesPicker({
  images,
  selectedImageId,
  busy,
  onPick,
  emptyHint = "No client images yet.",
}: {
  images: ClientImageRow[];
  selectedImageId: string;
  busy: boolean;
  onPick: (id: string) => void;
  emptyHint?: string;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold text-app-fg">
          Client images{" "}
          <span className="font-normal text-app-fg-muted">
            ({images.length})
          </span>
        </p>
        <Link
          href="/media?tab=images"
          className="text-[11px] font-semibold text-sky-500 hover:underline dark:text-sky-400"
        >
          Manage in Media →
        </Link>
      </div>

      {images.length === 0 ? (
        <div className="rounded-xl border border-dashed border-app-divider/60 py-8 text-center">
          <ImageIcon className="mx-auto mb-2 h-6 w-6 text-app-fg-subtle opacity-30" />
          <p className="mb-3 text-xs text-app-fg-subtle">{emptyHint}</p>
          <Link
            href="/media?tab=images"
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25"
          >
            <Plus className="h-3 w-3" />
            Upload image
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {images.map((img) => {
            const isActive = selectedImageId === img.id;
            return (
              <button
                key={img.id}
                type="button"
                disabled={busy}
                onClick={() => onPick(img.id)}
                className={`group flex flex-col gap-1 overflow-hidden rounded-xl border p-1.5 text-left transition-colors ${
                  isActive
                    ? "border-amber-500/45 bg-amber-500/10"
                    : "border-app-divider hover:border-white/20"
                } disabled:opacity-50`}
                title={img.label || "Use this image"}
              >
                <div className="overflow-hidden rounded-lg bg-black/10" style={{ aspectRatio: "9/16" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.file_url} alt="" className="h-full w-full object-cover" />
                </div>
                <span className="line-clamp-1 px-1 text-[10px] text-app-fg-muted">
                  {isActive ? "Active" : img.label || "Use"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CarouselSection({
  clientSlug,
  sessionId,
  slides,
  images,
  busy,
  generating,
  count,
  onCountChange,
  onGenerateAll,
  onRegenerateOne,
  onTextEdit,
}: {
  clientSlug: string;
  sessionId: string;
  slides: CarouselSlide[];
  images: ClientImageRow[];
  busy: boolean;
  generating: boolean;
  count: number;
  onCountChange: (n: number) => void;
  onGenerateAll: () => void | Promise<void>;
  onRegenerateOne: (
    idx: number,
    text: string,
    source: "ai" | "client_image",
    clientImageId?: string,
  ) => void | Promise<void>;
  onTextEdit: (idx: number, text: string) => void;
}) {
  const [pickerOpenForIdx, setPickerOpenForIdx] = useState<number | null>(null);
  const zipUrl = slides.length > 0 ? carouselSlidesZipUrl(clientSlug, sessionId) : null;
  const slideCountLabel = `${slides.length} slide${slides.length === 1 ? "" : "s"}`;

  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
        <StepHeader n={1} label="Carousel slides" done={slides.length > 0} />

        <div className="mb-4 flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold text-app-fg-muted">
              Slide count
              <span className="ml-1 font-normal">(3–10)</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={3}
                max={10}
                step={1}
                value={count}
                onChange={(e) => onCountChange(Number(e.target.value))}
                className="w-44 accent-amber-500"
                disabled={generating}
              />
              <span className="min-w-[2ch] text-sm font-bold text-app-fg">{count}</span>
            </div>
          </div>

          <button
            type="button"
            disabled={generating || busy}
            onClick={() => void onGenerateAll()}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500/15 px-4 py-2 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {generating ? "Generating…" : slides.length > 0 ? "Regenerate all slides" : "Generate slides"}
          </button>

          {zipUrl && (
            <a
              href={zipUrl}
              download={`carousel_${sessionId}.zip`}
              className="ml-auto inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-zinc-950 shadow-md shadow-emerald-900/25 hover:opacity-90"
            >
              <Download className="h-3.5 w-3.5" />
              Download all (.zip)
            </a>
          )}
        </div>

        {slides.length === 0 ? (
          <p className="rounded-xl border border-dashed border-app-divider/60 py-8 text-center text-xs text-app-fg-subtle">
            No slides yet — pick a count and hit Generate slides. Slide&nbsp;1 becomes your Instagram cover automatically.
          </p>
        ) : (
          <>
            <p className="mb-3 text-[11px] text-app-fg-muted">
              {slideCountLabel} · 9:16 PNGs · Slide&nbsp;1 is the IG cover. Edit text inline; hit{" "}
              <span className="font-semibold">Re-render</span> to redraw the image with new text or a different source.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {slides.map((s) => {
                const isPickerOpen = pickerOpenForIdx === s.idx;
                return (
                  <div
                    key={s.idx}
                    className="flex flex-col gap-2 rounded-xl border border-app-divider bg-app-chip-bg/30 p-2"
                  >
                    <div
                      className="overflow-hidden rounded-lg border border-app-divider bg-black/10"
                      style={{ aspectRatio: "9/16" }}
                    >
                      {s.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.image_url}
                          alt={`Slide ${s.idx + 1}`}
                          className="block h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[10px] text-app-fg-subtle">
                          (no image)
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-app-fg-muted">
                        Slide {s.idx + 1}
                        {s.idx === 0 && (
                          <span className="ml-1 rounded bg-amber-500/20 px-1 text-amber-700 dark:text-amber-400">
                            cover
                          </span>
                        )}
                      </span>
                    </div>
                    <textarea
                      value={s.text}
                      onChange={(e) => onTextEdit(s.idx, e.target.value)}
                      rows={3}
                      className="glass-inset w-full resize-y rounded-lg px-2 py-1.5 text-[11px] leading-snug text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/35"
                    />
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void onRegenerateOne(s.idx, s.text || "", "ai")
                        }
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-app-divider px-2 py-1 text-[10px] font-semibold text-app-fg-muted hover:text-app-fg disabled:opacity-40"
                      >
                        <RefreshCw className="h-3 w-3" /> Re-render
                      </button>
                      <button
                        type="button"
                        disabled={busy || images.length === 0}
                        onClick={() => setPickerOpenForIdx(isPickerOpen ? null : s.idx)}
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-app-divider px-2 py-1 text-[10px] font-semibold text-app-fg-muted hover:text-app-fg disabled:opacity-40"
                        title={images.length === 0 ? "No client images uploaded" : "Use a client image"}
                      >
                        <ImageIcon className="h-3 w-3" />
                      </button>
                    </div>
                    {isPickerOpen && (
                      <div className="mt-1 rounded-lg border border-app-divider/60 bg-app-chip-bg/40 p-1.5">
                        <ClientImagesPicker
                          images={images}
                          selectedImageId=""
                          busy={busy}
                          onPick={(id) => {
                            setPickerOpenForIdx(null);
                            void onRegenerateOne(s.idx, s.text || "", "client_image", id);
                          }}
                          emptyHint="No client images yet."
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StepHeader({
  n,
  label,
  done,
  children,
}: {
  n: number;
  label: string;
  done: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          done ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
        }`}
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : n}
      </div>
      <h2 className="flex-1 text-sm font-semibold text-app-fg">{label}</h2>
      {children}
    </div>
  );
}

type CoverMode = "ai" | "image";

/** Active source tab for the merged Visual+Render card. Maps to backend `background_type`:
 *  ai → generated_image, image → client_image, clip → broll. */
type BgSource = "ai" | "image" | "clip";

function bgSourceFromSession(t: string | null | undefined): BgSource {
  const v = (t || "").trim().toLowerCase();
  if (v === "broll") return "clip";
  if (v === "client_image") return "image";
  return "ai";
}

function ReelCoverSection({
  hooks,
  coverOptions,
  coverRegenBusy,
  onRegenerateCovers,
  images,
  thumbnailUrl,
  thumbnailBusy,
  coverText,
  selectedImageId,
  mode,
  onModeChange,
  onCoverTextChange,
  onSelectImage,
  onGenerateAi,
  onComposeFromImage,
  step,
}: {
  hooks: Array<{ text?: string }>;
  /** AI-written cover headlines (cover_text_options on the session). When present these
   *  drive the chips; otherwise we fall back to spoken-line hooks for legacy sessions. */
  coverOptions: string[];
  coverRegenBusy: boolean;
  onRegenerateCovers: () => void;
  images: ClientImageRow[];
  thumbnailUrl: string | null;
  thumbnailBusy: boolean;
  coverText: string;
  selectedImageId: string;
  mode: CoverMode;
  onModeChange: (m: CoverMode) => void;
  onCoverTextChange: (s: string) => void;
  onSelectImage: (id: string) => void;
  onGenerateAi: () => void;
  onComposeFromImage: () => void;
  step: number;
}) {
  const usingCoverOptions = coverOptions.length > 0;
  const chipItems: string[] = usingCoverOptions
    ? coverOptions
    : hooks.map((h) => h?.text ?? "").filter(Boolean);
  return (
    <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
      <StepHeader n={step} label="Reel cover" done={Boolean(thumbnailUrl)}>
        <span className="text-[10px] text-app-fg-subtle">Instagram cover · 9:16</span>
      </StepHeader>

      {/* Source toggle: AI image vs. existing client image */}
      <div className="mb-4 inline-flex rounded-xl border border-app-divider bg-app-chip-bg/40 p-1">
        <button
          type="button"
          onClick={() => onModeChange("ai")}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors ${
            mode === "ai" ? "bg-white/10 text-app-fg shadow-sm" : "text-app-fg-muted hover:text-app-fg"
          }`}
        >
          <Sparkles className="h-3 w-3" /> AI image
        </button>
        <button
          type="button"
          onClick={() => onModeChange("image")}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors ${
            mode === "image" ? "bg-white/10 text-app-fg shadow-sm" : "text-app-fg-muted hover:text-app-fg"
          }`}
        >
          <ImageIcon className="h-3 w-3" /> Client image
        </button>
      </div>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="mx-auto shrink-0 sm:mx-0">
          {thumbnailBusy ? (
            <div
              className="flex w-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-app-divider bg-app-chip-bg/40"
              style={{ aspectRatio: "9/16" }}
            >
              <Loader2 className="h-6 w-6 animate-spin text-app-fg-subtle" />
              <p className="text-[10px] text-app-fg-muted">{mode === "ai" ? "~30–60s" : "few seconds"}</p>
            </div>
          ) : thumbnailUrl ? (
            <a href={thumbnailUrl} target="_blank" rel="noreferrer" title="Open full size">
              <div className="w-[140px] overflow-hidden rounded-xl border border-app-divider shadow-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbnailUrl}
                  alt="Reel cover"
                  width={140}
                  className="block w-full object-cover"
                  style={{ aspectRatio: "9/16" }}
                />
              </div>
            </a>
          ) : (
            <div
              className="flex w-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-app-divider/70 bg-app-chip-bg/20"
              style={{ aspectRatio: "9/16" }}
            >
              <ImageIcon className="h-6 w-6 text-app-fg-subtle opacity-30" />
              <p className="px-3 text-center text-[10px] text-app-fg-subtle">No cover yet</p>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="text-xs leading-relaxed text-app-fg-muted">
            {mode === "ai"
              ? "AI generates a 9:16 background with the hook burned in."
              : "Pick a client photo and we overlay the hook in the same editorial style."}
          </p>

          {chipItems.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-app-fg-muted">
                  {usingCoverOptions ? "Pick a cover headline" : "Pick a hook as headline"}
                </p>
                {usingCoverOptions && (
                  <button
                    type="button"
                    onClick={onRegenerateCovers}
                    disabled={coverRegenBusy}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-app-fg-muted hover:text-app-fg disabled:opacity-50"
                    title="Generate fresh cover headlines"
                  >
                    {coverRegenBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    {coverRegenBusy ? "Regenerating…" : "Regenerate"}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {chipItems.map((txt, i) => {
                  const active = coverText === txt;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onCoverTextChange(active ? "" : txt)}
                      className={`rounded-lg border px-2 py-1.5 text-left text-[11px] leading-snug transition-colors ${
                        active
                          ? "border-amber-500/45 bg-amber-500/10 text-app-fg"
                          : "border-app-divider text-app-fg-muted hover:border-white/20 hover:text-app-fg"
                      }`}
                    >
                      {txt.length > 72 ? txt.slice(0, 72) + "…" : txt}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-app-fg-muted">
              Or type a custom headline
            </p>
            <textarea
              value={coverText}
              onChange={(e) => onCoverTextChange(e.target.value)}
              placeholder="Short, punchy headline for the cover…"
              rows={2}
              className="glass-inset w-full resize-none rounded-xl px-3 py-2 text-sm text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/35"
            />
          </div>

          {mode === "image" && (
            <ClientImagesPicker
              images={images}
              selectedImageId={selectedImageId}
              busy={thumbnailBusy}
              onPick={onSelectImage}
              emptyHint="No client images yet — upload some PNG/JPG photos in Media."
            />
          )}

          <button
            type="button"
            disabled={thumbnailBusy || (mode === "image" && !selectedImageId)}
            onClick={mode === "ai" ? onGenerateAi : onComposeFromImage}
            className="inline-flex items-center gap-2 self-start rounded-xl bg-amber-500/15 px-4 py-2 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-50"
            title={mode === "image" && !selectedImageId ? "Pick an image first" : undefined}
          >
            {thumbnailBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : mode === "ai" ? (
              <Sparkles className="h-3.5 w-3.5" />
            ) : (
              <ImageIcon className="h-3.5 w-3.5" />
            )}
            {thumbnailBusy
              ? mode === "ai" ? "Generating…" : "Composing…"
              : thumbnailUrl
              ? "Regenerate cover"
              : mode === "ai" ? "Generate cover" : "Compose cover"}
          </button>

          {thumbnailUrl && !thumbnailBusy && (
            <a
              href={thumbnailUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 self-start text-xs font-semibold text-sky-500 hover:underline dark:text-sky-400"
            >
              <Download className="h-3.5 w-3.5" />
              Open full size · right-click to save
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function CaptionSection({
  caption,
  hashtags,
  onCopy,
  regenInline,
}: {
  caption: string;
  hashtags: string[];
  onCopy: () => void;
  regenInline: React.ReactNode;
}) {
  return (
    <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold text-app-fg">Caption + hashtags</h2>
        {regenInline}
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded-lg bg-app-icon-btn-bg px-2.5 py-1 text-[11px] font-bold text-app-icon-btn-fg"
        >
          <Copy className="h-3 w-3" /> Copy
        </button>
      </div>
      {caption ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-app-fg">{caption}</p>
      ) : (
        <p className="text-xs text-app-fg-subtle">No caption yet.</p>
      )}
      {hashtags.length > 0 && (
        <p className="mt-3 text-xs text-app-fg-muted">{hashtags.join(" ")}</p>
      )}
    </div>
  );
}

function AiContextSection({
  hooks,
  scriptForTalkingHead,
  regenHooks,
  busy,
}: {
  hooks: Array<{ text?: string }>;
  scriptForTalkingHead?: string | null;
  regenHooks: (feedback: string) => Promise<void>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!hooks.length && !scriptForTalkingHead) return null;

  return (
    <div className="glass rounded-2xl border border-app-divider/60 p-4 md:p-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-app-fg-muted hover:text-app-fg"
      >
        <span>What the AI is working with</span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {hooks.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-app-fg-subtle">
                  Alternative hooks ({hooks.length})
                </p>
                <RegenInline
                  scope="hooks"
                  busy={busy}
                  onRegen={async (_s, fb) => regenHooks(fb)}
                  placeholder="More direct, shorter, …"
                />
              </div>
              <ul className="space-y-1.5">
                {hooks.map((h, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-app-divider/50 bg-app-chip-bg/30 px-3 py-2 text-xs leading-relaxed text-app-fg"
                  >
                    {h?.text || "—"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export type VideoCreateWorkspaceProps = {
  clientSlug: string;
  orgSlug: string;
  sessionId: string;
  /** Allows the parent to react to state changes (e.g. show a toast or refresh sessions). */
  onSessionUpdated?: (s: GenerationSession) => void;
};

/**
 * Self-contained video pipeline for one session.
 *
 * Two flows depending on `source_format_key`:
 *
 *  - `text_overlay` / `carousel` / `b_roll_reel` (visual formats):
 *      Step 1 Text blocks → Step 2 Background → Step 3 Render → Step 4 Cover → Step 5 Output
 *  - `talking_head` (and other content-only formats):
 *      Editable Script + Cover + Caption (no render pipeline; the user films themself).
 *
 * Per-section regenerate buttons replace the old global "Refine" panel. The collapsible
 * "What the AI is working with" section at the bottom shows the 5 alternative hooks.
 */
export function VideoCreateWorkspace({
  clientSlug,
  orgSlug,
  sessionId,
  onSessionUpdated,
}: VideoCreateWorkspaceProps) {
  const { show } = useToast();
  const [bootstrapDone, setBootstrapDone] = useState(false);
  const [session, setSession] = useState<GenerationSession | null>(null);
  const [clips, setClips] = useState<BrollClipRow[]>([]);
  const [images, setImages] = useState<ClientImageRow[]>([]);
  const [selectedClipId, setSelectedClipId] = useState("");
  const [selectedImageId, setSelectedImageId] = useState("");
  const [textDraft, setTextDraft] = useState<TextBlock[]>([]);
  const [scriptDraft, setScriptDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [bgBusy, setBgBusy] = useState(false);
  const [renderBusy, setRenderBusy] = useState(false);
  const [deletingClipId, setDeletingClipId] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [thumbnailBusy, setThumbnailBusy] = useState(false);
  const [coverText, setCoverText] = useState("");
  const [coverMode, setCoverMode] = useState<CoverMode>("ai");
  const [coverImageId, setCoverImageId] = useState("");
  const [coverRegenBusy, setCoverRegenBusy] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  /**
   * Active source tab for the Visual card. Defaults to whatever's already set on the
   * session; once the user manually clicks a tab we stop following the session so
   * switching tabs doesn't snap back after a save. The shared preview always shows
   * `session.background_url` regardless of which tab is active.
   */
  const [bgSource, setBgSource] = useState<BgSource | null>(null);
  const bgSourceUserPickedRef = useRef(false);
  const [carouselCount, setCarouselCount] = useState(6);
  const [carouselGenBusy, setCarouselGenBusy] = useState(false);
  const [carouselSlideBusy, setCarouselSlideBusy] = useState(false);
  const [carouselDraft, setCarouselDraft] = useState<CarouselSlide[]>([]);
  const carouselDraftDirty = useRef(false);
  const carouselDraftRef = useRef<CarouselSlide[]>([]);
  const carouselSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    carouselDraftRef.current = carouselDraft;
  }, [carouselDraft]);

  // Hold the latest parent callback in a ref so it never invalidates effects/callbacks.
  // (Parents typically pass an inline `onSessionUpdated`, which would otherwise loop.)
  const onSessionUpdatedRef = useRef(onSessionUpdated);
  useEffect(() => {
    onSessionUpdatedRef.current = onSessionUpdated;
  }, [onSessionUpdated]);

  const applySession = useCallback((s: GenerationSession) => {
    setSession(s);
    setTextDraft(Array.isArray(s.text_blocks) ? s.text_blocks.map((b) => ({ ...b })) : []);
    setScriptDraft(s.script ?? "");
    setSelectedClipId(s.broll_clip_id ?? "");
    setSelectedImageId(s.client_image_id ?? "");
    if (s.thumbnail_url) setThumbnailUrl(s.thumbnail_url);
    if (Array.isArray(s.carousel_slides)) {
      const sorted = [...s.carousel_slides].sort((a, b) => a.idx - b.idx);
      // Server is source of truth unless the user is mid-edit on the same slide set.
      if (!carouselDraftDirty.current) {
        setCarouselDraft(sorted.map((sl) => ({ ...sl })));
        if (sorted.length > 0) setCarouselCount(sorted.length);
      }
    } else if (!carouselDraftDirty.current) {
      setCarouselDraft([]);
    }
    onSessionUpdatedRef.current?.(s);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!cs || !os || !sessionId) return;
    setBootstrapDone(false);
    void (async () => {
      const [sRes, bRes, iRes] = await Promise.all([
        generationGetSession(cs, os, sessionId),
        brollList(cs, os),
        clientImagesList(cs, os),
      ]);
      if (cancelled) return;
      if (!sRes.ok) {
        show(sRes.error, "error");
      } else {
        applySession(sRes.data);
        // Pre-select the first AI-written cover headline so users land on a real
        // cover-style line; falls back to "" (custom textarea) for legacy sessions.
        setCoverText(sRes.data.cover_text_options?.[0] ?? "");
      }
      if (bRes.ok) setClips(bRes.data);
      if (iRes.ok) setImages(iRes.data);
      setBootstrapDone(true);
    })();
    return () => {
      cancelled = true;
    };
    // `applySession` and `show` are stable; depend only on inputs that should refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientSlug, orgSlug, sessionId]);

  const fk = useMemo(() => {
    const raw = session?.source_format_key ?? null;
    return canonicalFormatKey(raw) ?? raw ?? (session?.source_type === "url_adapt" ? "text_overlay" : null);
  }, [session]);
  /** Full-deliverable preview modal — opened from the recap card's "Preview post"
   *  button. Replaces the previous in-place "Show more" caption toggle, which only
   *  surfaced when the caption overflowed its 3-line clamp (and so was invisible
   *  for short captions, even though users still wanted a single "see the whole
   *  post" surface with the playable video next to it). */
  const [previewOpen, setPreviewOpen] = useState(false);
  const isTextOverlay = fk === "text_overlay";
  const isCarousel = fk === "carousel";
  const isBroll = fk === "b_roll_reel";
  const isTalkingHead = fk === "talking_head";

  /** Sync the active bg-source tab with the session's background_type until the user
   *  explicitly clicks a tab; from then on the user's choice wins. b_roll_reel formats
   *  are forced to "clip" (only valid option). */
  useEffect(() => {
    if (!session) return;
    if (isBroll) {
      setBgSource("clip");
      return;
    }
    if (bgSourceUserPickedRef.current) return;
    setBgSource(bgSourceFromSession(session.background_type));
  }, [session, isBroll]);

  const onPickBgSource = useCallback((next: BgSource) => {
    bgSourceUserPickedRef.current = true;
    setBgSource(next);
  }, []);

  const savedBlocks = session?.text_blocks ?? [];
  const hasUnsavedBlocks = useMemo(() => {
    if (textDraft.length !== savedBlocks.length) return true;
    return textDraft.some((b, i) => b.text !== savedBlocks[i]?.text || b.isCTA !== savedBlocks[i]?.isCTA);
  }, [textDraft, savedBlocks]);
  const hasUnsavedScript = (session?.script ?? "") !== scriptDraft;
  const step1Done = !hasUnsavedBlocks && textDraft.length > 0;
  const step2Done = Boolean(session?.background_url);
  const step3Done = session?.render_status === "done" || session?.render_status === "cleaned";
  const isRendering = session?.render_status === "rendering";

  const saveTextBlocks = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!session || !cs || !os) return;
    setLoading(true);
    try {
      const res = await patchCreateSession(cs, os, session.id, {
        text_blocks: textDraft.filter((b) => b.text.trim()),
      });
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      applySession(res.data);
      show("Text blocks saved.", "success");
    } finally {
      setLoading(false);
    }
  }, [applySession, clientSlug, orgSlug, session, show, textDraft]);

  const saveScript = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!session || !cs || !os) return;
    setLoading(true);
    try {
      const res = await patchCreateSession(cs, os, session.id, { script: scriptDraft });
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      applySession(res.data);
      show("Script saved.", "success");
    } finally {
      setLoading(false);
    }
  }, [applySession, clientSlug, orgSlug, session, scriptDraft, show]);

  const onRegenSection = useCallback(
    async (scope: "hooks" | "script" | "caption" | "text_blocks", feedback: string) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!session || !cs || !os) return;
      setRegenBusy(true);
      try {
        const res = await generationRegenerate(cs, os, session.id, {
          scope,
          feedback: feedback || undefined,
        });
        if (!res.ok) {
          show(res.error, "error");
          return;
        }
        applySession(res.data);
        show("Regenerated.", "success");
      } finally {
        setRegenBusy(false);
      }
    },
    [applySession, clientSlug, orgSlug, session, show],
  );

  const onGenerateBg = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!session || !cs || !os) return;
    setBgBusy(true);
    try {
      const res = await creationGenerateBackground(cs, os, session.id);
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      applySession(res.data);
      show("Background generated.", "success");
    } finally {
      setBgBusy(false);
    }
  }, [applySession, clientSlug, orgSlug, session, show]);

  const onSetBroll = useCallback(
    async (clipId: string) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!session || !cs || !os || !clipId.trim()) return;
      setLoading(true);
      try {
        const res = await creationSetBroll(cs, os, session.id, clipId.trim());
        if (!res.ok) {
          show(res.error, "error");
          return;
        }
        applySession(res.data);
        setSelectedClipId(clipId);
        show("B-roll set.", "success");
      } finally {
        setLoading(false);
      }
    },
    [applySession, clientSlug, orgSlug, session, show],
  );

  const onDeleteClip = useCallback(
    async (clipId: string) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!cs || !os) return;
      setDeletingClipId(clipId);
      try {
        const res = await brollDelete(cs, os, clipId);
        if (!res.ok) {
          show(res.error, "error");
          return;
        }
        setClips((prev) => prev.filter((c) => c.id !== clipId));
        if (selectedClipId === clipId) setSelectedClipId("");
        show("Clip deleted.", "success");
      } finally {
        setDeletingClipId(null);
      }
    },
    [clientSlug, orgSlug, selectedClipId, show],
  );

  const pollRenderJob = useCallback(
    async (jobId: string, sId: string) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!cs || !os) return;
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const jr = await fetchBackgroundJob(os, jobId);
        if (!jr.ok) {
          show(jr.error, "error");
          return;
        }
        if (jr.data.status === "failed") {
          show(jr.data.error_message || "Render failed.", "error");
          const s = await generationGetSession(cs, os, sId);
          if (s.ok) applySession(s.data);
          return;
        }
        if (jr.data.status === "completed") {
          const s = await generationGetSession(cs, os, sId);
          if (s.ok) {
            applySession(s.data);
            show("Video ready — download below.", "success");
          }
          return;
        }
      }
      show("Render is taking longer than expected. Refresh later.", "error");
    },
    [applySession, clientSlug, orgSlug, show],
  );

  const onRender = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!session || !cs || !os) return;
    setRenderBusy(true);
    try {
      const res = await creationRenderVideo(cs, os, session.id);
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      setSession((prev) => (prev ? { ...prev, render_status: "rendering", render_error: null } : prev));
      show("Render started — usually 1–3 minutes.", "success");
      void pollRenderJob(res.job_id, session.id);
    } finally {
      setRenderBusy(false);
    }
  }, [clientSlug, orgSlug, session, show, pollRenderJob]);

  const onRegenerateCovers = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!session || !cs || !os) return;
    setCoverRegenBusy(true);
    try {
      const res = await generationRegenerateCovers(cs, os, session.id);
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      applySession(res.data);
      // Land on the first fresh option so the user sees the new copy immediately.
      setCoverText(res.data.cover_text_options?.[0] ?? "");
      show("Cover headlines refreshed.", "success");
    } finally {
      setCoverRegenBusy(false);
    }
  }, [applySession, clientSlug, orgSlug, session, show]);

  const onGenerateThumbnail = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!session || !cs || !os) return;
    const text = coverText.trim() || undefined;
    setThumbnailBusy(true);
    try {
      const res = await generationGenerateThumbnail(cs, os, session.id, text);
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      setThumbnailUrl(res.data.thumbnail_url);
    } finally {
      setThumbnailBusy(false);
    }
  }, [clientSlug, orgSlug, session, coverText, show]);

  const onComposeCoverFromImage = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!session || !cs || !os || !coverImageId) return;
    const text = coverText.trim() || undefined;
    setThumbnailBusy(true);
    try {
      const res = await generationComposeThumbnail(cs, os, session.id, coverImageId, text);
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      setThumbnailUrl(res.data.thumbnail_url);
      show("Cover composed.", "success");
    } finally {
      setThumbnailBusy(false);
    }
  }, [clientSlug, orgSlug, session, coverImageId, coverText, show]);

  const onSetBackgroundImage = useCallback(
    async (imageId: string) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!session || !cs || !os || !imageId.trim()) return;
      setLoading(true);
      try {
        const res = await creationSetBackgroundImage(cs, os, session.id, imageId.trim());
        if (!res.ok) {
          show(res.error, "error");
          return;
        }
        applySession(res.data);
        setSelectedImageId(imageId);
        show("Image set as background.", "success");
      } finally {
        setLoading(false);
      }
    },
    [applySession, clientSlug, orgSlug, session, show],
  );

  const onGenerateCarouselSlides = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!session || !cs || !os) return;
    setCarouselGenBusy(true);
    try {
      const res = await carouselSlidesGenerate(cs, os, session.id, carouselCount);
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      carouselDraftDirty.current = false;
      applySession(res.data);
      show("Slides generated.", "success");
    } finally {
      setCarouselGenBusy(false);
    }
  }, [applySession, carouselCount, clientSlug, orgSlug, session, show]);

  const onRegenerateCarouselSlide = useCallback(
    async (
      idx: number,
      text: string,
      source: "ai" | "client_image",
      clientImageId?: string,
    ) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!session || !cs || !os) return;
      setCarouselSlideBusy(true);
      try {
        const res = await carouselSlideRegenerate(cs, os, session.id, {
          idx,
          text,
          image_source: source,
          client_image_id: clientImageId,
        });
        if (!res.ok) {
          show(res.error, "error");
          return;
        }
        carouselDraftDirty.current = false;
        applySession(res.data);
        show(`Slide ${idx + 1} updated.`, "success");
      } finally {
        setCarouselSlideBusy(false);
      }
    },
    [applySession, clientSlug, orgSlug, session, show],
  );

  const onCarouselTextEdit = useCallback(
    (idx: number, text: string) => {
      setCarouselDraft((prev) =>
        prev.map((s) => (s.idx === idx ? { ...s, text } : s)),
      );
      carouselDraftDirty.current = true;
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!session || !cs || !os) return;
      if (carouselSaveTimer.current) clearTimeout(carouselSaveTimer.current);
      carouselSaveTimer.current = setTimeout(() => {
        void (async () => {
          // Snapshot current draft after the debounce window so we always send the latest text.
          const latest = carouselDraftRef.current;
          const res = await carouselSlidesPatch(cs, os, session.id, latest);
          if (!res.ok) {
            show(res.error, "error");
            return;
          }
          carouselDraftDirty.current = false;
          applySession(res.data);
        })();
      }, 600);
    },
    [applySession, clientSlug, orgSlug, session, show],
  );

  useEffect(() => {
    return () => {
      if (carouselSaveTimer.current) clearTimeout(carouselSaveTimer.current);
    };
  }, []);

  const copyText = useCallback(
    async (label: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        show(`Copied ${label}.`, "success");
      } catch {
        show("Copy failed.", "error");
      }
    },
    [show],
  );

  if (!bootstrapDone) {
    return (
      <div className="flex min-h-[20vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-app-fg-subtle" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="rounded-xl border border-app-divider px-5 py-8 text-center text-sm text-app-fg-muted">
        Could not load this session for the video pipeline.
      </div>
    );
  }

  const hooks = (Array.isArray(session.hooks) ? session.hooks : []) as Array<{ text?: string }>;
  const coverOptions = (Array.isArray(session.cover_text_options) ? session.cover_text_options : []) as string[];
  const captionFull = `${session.caption_body ?? ""}${
    Array.isArray(session.hashtags) && session.hashtags.length ? `\n\n${session.hashtags.join(" ")}` : ""
  }`.trim();

  // ─────────────────────────────── talking_head minimal flow ───────────────────────────────
  if (isTalkingHead) {
    return (
      <div className="space-y-4">
        <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Video className="h-4 w-4 text-amber-500" />
            <h2 className="flex-1 text-sm font-semibold text-app-fg">Script</h2>
            <RegenInline
              scope="script"
              busy={regenBusy}
              onRegen={async (s, fb) => onRegenSection(s, fb)}
              placeholder="Tighter, more direct, add a story…"
            />
            <button
              type="button"
              onClick={() => void copyText("script", scriptDraft)}
              className="inline-flex items-center gap-1 rounded-lg bg-app-icon-btn-bg px-2.5 py-1 text-[11px] font-bold text-app-icon-btn-fg"
            >
              <Copy className="h-3 w-3" /> Copy
            </button>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-app-fg-muted">
            Talking-head format — film yourself reading this script. Edit freely; markdown headings
            (##&nbsp;Hook, ##&nbsp;Insight 1, …) help you remember structure on camera.
          </p>
          <textarea
            value={scriptDraft}
            onChange={(e) => setScriptDraft(e.target.value)}
            rows={Math.min(28, Math.max(10, scriptDraft.split("\n").length + 1))}
            className="glass-inset w-full resize-y rounded-xl px-3 py-3 font-mono text-[13px] leading-relaxed text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/35"
            placeholder="## Hook&#10;Did you know…&#10;&#10;## Situation&#10;…"
          />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={loading || !hasUnsavedScript}
              onClick={() => void saveScript()}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500/15 px-4 py-2 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {loading ? "Saving…" : "Save script"}
            </button>
            {!hasUnsavedScript && scriptDraft.trim() && (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Saved ✓</span>
            )}
          </div>
        </div>

        <ReelCoverSection
          hooks={hooks}
          coverOptions={coverOptions}
          coverRegenBusy={coverRegenBusy}
          onRegenerateCovers={onRegenerateCovers}
          images={images}
          thumbnailUrl={thumbnailUrl}
          thumbnailBusy={thumbnailBusy}
          coverText={coverText}
          selectedImageId={coverImageId}
          mode={coverMode}
          onModeChange={setCoverMode}
          onCoverTextChange={setCoverText}
          onSelectImage={setCoverImageId}
          onGenerateAi={onGenerateThumbnail}
          onComposeFromImage={onComposeCoverFromImage}
          step={2}
        />

        <CaptionSection
          caption={session.caption_body ?? ""}
          hashtags={session.hashtags ?? []}
          onCopy={() => void copyText("caption + hashtags", captionFull)}
          regenInline={
            <RegenInline
              scope="caption"
              busy={regenBusy}
              onRegen={async (s, fb) => onRegenSection(s, fb)}
              placeholder="Different angle, shorter, …"
            />
          }
        />

        <AiContextSection
          hooks={hooks}
          regenHooks={(fb) => onRegenSection("hooks", fb)}
          busy={regenBusy}
        />
      </div>
    );
  }

  // ─────────────────────────────── carousel flow (PNG slides → ZIP) ───────────────────────────────
  if (isCarousel) {
    return (
      <div className="space-y-4">
        <CarouselSection
          clientSlug={clientSlug}
          sessionId={session.id}
          slides={carouselDraft}
          images={images}
          busy={carouselSlideBusy || loading}
          generating={carouselGenBusy}
          count={carouselCount}
          onCountChange={setCarouselCount}
          onGenerateAll={onGenerateCarouselSlides}
          onRegenerateOne={onRegenerateCarouselSlide}
          onTextEdit={onCarouselTextEdit}
        />

        <CaptionSection
          caption={session.caption_body ?? ""}
          hashtags={session.hashtags ?? []}
          onCopy={() => void copyText("caption + hashtags", captionFull)}
          regenInline={
            <RegenInline
              scope="caption"
              busy={regenBusy}
              onRegen={async (s, fb) => onRegenSection(s, fb)}
              placeholder="Different angle, shorter, …"
            />
          }
        />

        <AiContextSection
          hooks={hooks}
          regenHooks={(fb) => onRegenSection("hooks", fb)}
          busy={regenBusy}
        />
      </div>
    );
  }

  // ────────────────── visual formats: text_overlay / b_roll_reel ──────────────────
  if (!isTextOverlay && !isBroll) {
    return (
      <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
        <div className="flex items-start gap-3">
          <Video className="h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-app-fg">Unsupported format</p>
            <p className="mt-1 text-xs leading-relaxed text-app-fg-muted">
              Format <span className="font-semibold text-app-fg-secondary">{(fk ?? "—").replace(/_/g, " ")}</span>
              {" "}has no AI render pipeline. Copy hooks, script and caption from the bottom panel.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <AiContextSection
            hooks={hooks}
            regenHooks={(fb) => onRegenSection("hooks", fb)}
            busy={regenBusy}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Pinned deliverable recap (only on Done sessions) ──
          Sits above the build steps so when a user reopens a finished session they
          immediately see the result (cover + caption + download / copy actions),
          instead of having to scroll past four build cards to find it. Mild action
          overlap with the Output card below is intentional — top of page is the
          "show me what I made" view; Output is the "how do I publish it" view. */}
      {step3Done && session.thumbnail_url ? (
        <div className="glass rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-4 md:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <a
              href={session.thumbnail_url}
              target="_blank"
              rel="noreferrer"
              title="Open cover full size"
              className="mx-auto block shrink-0 sm:mx-0"
            >
              <div className="w-[120px] overflow-hidden rounded-lg border border-app-divider bg-black/20 shadow-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={session.thumbnail_url}
                  alt="Reel cover"
                  width={120}
                  className="block aspect-[9/16] w-full object-cover"
                />
              </div>
            </a>

            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span className="text-xs font-bold uppercase tracking-wide text-emerald-400">
                  Ready to publish
                </span>
                {session.updated_at ? (
                  <span className="text-[11px] tabular-nums text-app-fg-subtle">
                    · {new Date(session.updated_at).toLocaleDateString()}
                  </span>
                ) : null}
              </div>

              {session.caption_body ? (
                <p className="line-clamp-3 whitespace-pre-line text-[13px] leading-relaxed text-app-fg-secondary">
                  {session.caption_body}
                </p>
              ) : (
                <p className="text-xs text-app-fg-muted">No caption yet.</p>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25"
                >
                  <Eye className="h-3 w-3" /> Preview post
                </button>
                <button
                  type="button"
                  onClick={() => void copyText("caption + hashtags", captionFull)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-app-divider px-3 py-1.5 text-xs font-bold text-app-fg hover:bg-white/5"
                >
                  <Copy className="h-3 w-3" /> Copy caption
                </button>
                {session.rendered_video_url ? (
                  <a
                    href={session.rendered_video_url}
                    download="reel.mp4"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-zinc-950 shadow-sm hover:opacity-90"
                  >
                    <Download className="h-3 w-3" /> Download MP4
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Step 1: On-screen text ── */}
      <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
        <StepHeader n={1} label="On-screen text" done={step1Done}>
          <RegenInline
            scope="text_blocks"
            busy={regenBusy}
            onRegen={async (s, fb) => onRegenSection(s, fb)}
            placeholder="More direct, add emoji, shorter…"
          />
        </StepHeader>

        <div className="mb-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-app-fg">
              On-screen text blocks
              <span className="ml-1.5 font-normal text-app-fg-muted">
                ({textDraft.length}/6 · 6–7 words max)
              </span>
            </p>
            <button
              type="button"
              onClick={() => setTextDraft((prev) => [...prev, { text: "", isCTA: false }])}
              disabled={textDraft.length >= 6}
              className="inline-flex items-center gap-1 rounded-lg border border-app-divider px-2 py-1 text-[11px] font-semibold text-app-fg-muted hover:text-app-fg disabled:opacity-40"
            >
              <Plus className="h-3 w-3" /> Add block
            </button>
          </div>
          <div className="space-y-2">
            {/* Hook row — `hooks[0].text` is what `build_remotion_props` (video_render.py)
                burns in for the first ~3s of the reel, so it's effectively the opening
                on-screen text block. Rendered inline as the first list item (read-only,
                amber-tinted) so the user sees the full opener + body sequence in one
                place; full edit/alternatives live in the bottom "AI working with" panel. */}
            {hooks[0]?.text ? (
              <div className="flex items-center gap-2">
                <div
                  className="glass-inset flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2"
                  title="Hook · burned into the first ~3s of the reel"
                >
                  <span className="shrink-0 rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                    Hook · 3s
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-app-fg">
                    {hooks[0].text}
                  </p>
                </div>
                <RegenInline
                  scope="hooks"
                  busy={regenBusy}
                  onRegen={async (s, fb) => onRegenSection(s, fb)}
                  placeholder="More direct, shorter, …"
                />
              </div>
            ) : null}

            {textDraft.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={b.text}
                  onChange={(e) => {
                    const next = [...textDraft];
                    next[i] = { ...next[i], text: e.target.value };
                    setTextDraft(next);
                  }}
                  placeholder={b.isCTA ? "👇 Schreib 'Keyword' für …" : "❌ Short punchy line…"}
                  className="glass-inset min-w-0 flex-1 rounded-xl px-3 py-2 text-sm text-app-fg placeholder:text-app-fg-subtle focus:outline-none focus:ring-2 focus:ring-amber-500/35"
                />
                <label
                  className="flex cursor-pointer select-none items-center gap-1 rounded-lg border border-app-divider px-2 py-2 text-[10px] font-semibold text-app-fg-muted hover:border-amber-500/30"
                  title="Mark as CTA block"
                >
                  <input
                    type="checkbox"
                    checked={b.isCTA ?? false}
                    onChange={(e) => {
                      const next = [...textDraft];
                      next[i] = { ...next[i], isCTA: e.target.checked };
                      setTextDraft(next);
                    }}
                    className="h-3 w-3 accent-amber-500"
                  />
                  CTA
                </label>
                <button
                  type="button"
                  onClick={() => setTextDraft((prev) => prev.filter((_, j) => j !== i))}
                  className="rounded-lg p-2 text-app-fg-subtle hover:bg-red-500/10 hover:text-red-400"
                  aria-label="Remove block"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {textDraft.length === 0 && !hooks[0]?.text && (
              <p className="rounded-xl border border-dashed border-app-divider/60 py-4 text-center text-xs text-app-fg-subtle">
                No text blocks yet — click Add block above, or hit Regenerate.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={loading || !hasUnsavedBlocks}
            onClick={() => void saveTextBlocks()}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500/15 px-4 py-2 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {loading ? "Saving…" : "Save text blocks"}
          </button>
          {!hasUnsavedBlocks && textDraft.length > 0 && (
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Saved ✓</span>
          )}
        </div>
      </div>

      {/* ── Step 2: Visual & render (merged) ──
          Source picker (tabs) + shared preview + per-source controls + render footer
          all live in one card. The old separate Render step is now the card's footer
          so the user never sees a "blocked" Render card sitting empty. */}
      <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
        <StepHeader n={2} label="Visual & render" done={step3Done} />

        {/* Source tabs — only shown when there's >1 valid source for this format.
            b_roll_reel has only one valid source (clip), so we skip the tabs. */}
        {isTextOverlay ? (
          <div className="mb-4 inline-flex rounded-xl border border-app-divider bg-app-chip-bg/40 p-1">
            {(
              [
                { key: "ai" as const, label: "AI image", icon: Sparkles },
                { key: "image" as const, label: "Client photo", icon: ImageIcon },
                { key: "clip" as const, label: "Stock clip", icon: Film },
              ] as const
            ).map(({ key, label, icon: Icon }) => {
              const active = bgSource === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onPickBgSource(key)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                    active
                      ? "bg-white/10 text-app-fg shadow-sm"
                      : "text-app-fg-muted hover:text-app-fg"
                  }`}
                >
                  <Icon className="h-3 w-3" /> {label}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Preview-left + per-tab content-right. The preview is the "this is what your
            reel will use" anchor — it always reflects whatever's saved on the session
            (photo, clip, AI still) at proper 9:16, regardless of which tab is active.
            Picker grids on the right are for browsing/selecting; this preview is for
            verifying the choice (especially clips, which autoplay so you can check the loop). */}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="mx-auto shrink-0 sm:mx-0">
            {bgBusy ? (
              <div className="flex aspect-[9/16] w-[160px] flex-col items-center justify-center gap-2 rounded-xl border border-app-divider bg-app-chip-bg/40">
                <Loader2 className="h-6 w-6 animate-spin text-app-fg-subtle" />
                <p className="text-[10px] text-app-fg-muted">~30–60s</p>
              </div>
            ) : session.background_url ? (
              <a
                href={session.background_url}
                target="_blank"
                rel="noreferrer"
                title="Open full size"
                className="block"
              >
                <div className="w-[160px] overflow-hidden rounded-xl border border-app-divider shadow-md">
                  {session.background_type === "broll" ? (
                    <video
                      src={session.background_url}
                      muted
                      loop
                      autoPlay
                      playsInline
                      className="block aspect-[9/16] w-full object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={session.background_url}
                      alt="Currently active background"
                      width={160}
                      className="block aspect-[9/16] w-full object-cover"
                    />
                  )}
                </div>
                <p className="mt-1.5 text-center text-[10px] uppercase tracking-wide text-app-fg-subtle">
                  Currently active
                </p>
              </a>
            ) : (
              <div className="flex aspect-[9/16] w-[160px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-app-divider/70 bg-app-chip-bg/20">
                <ImageIcon className="h-6 w-6 text-app-fg-subtle opacity-30" />
                <p className="px-3 text-center text-[10px] text-app-fg-subtle">No background yet</p>
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {bgSource === "ai" && (
              <>
                <p className="text-xs leading-relaxed text-app-fg-muted">
                  Generate a 9:16 still matched to the chosen angle. ~30–60s.
                </p>
                <button
                  type="button"
                  disabled={bgBusy}
                  onClick={() => void onGenerateBg()}
                  className="inline-flex items-center gap-2 self-start rounded-xl bg-amber-500/15 px-4 py-2 text-xs font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-50"
                >
                  {bgBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {bgBusy
                    ? "Generating…"
                    : session.background_type === "generated_image" && session.background_url
                    ? "Regenerate"
                    : "Generate image"}
                </button>
              </>
            )}

            {bgSource === "image" && (
              <>
                <p className="text-xs leading-relaxed text-app-fg-muted">
                  Use an existing photo of you / your brand as a static 9:16 background.
                </p>
                <ClientImagesPicker
                  images={images}
                  selectedImageId={session.background_type === "client_image" ? selectedImageId : ""}
                  busy={loading}
                  onPick={(id) => void onSetBackgroundImage(id)}
                />
              </>
            )}

            {bgSource === "clip" && (
              <>
                {!isBroll ? (
                  <p className="text-xs leading-relaxed text-app-fg-muted">
                    Loop a video clip behind the text. Clip length doesn&apos;t matter — render follows
                    your script timing.
                  </p>
                ) : null}
                <BrollLibrarySection
                  clips={clips}
                  loading={loading}
                  deletingClipId={deletingClipId}
                  selectedClipId={selectedClipId}
                  sessionBrollClipId={session.broll_clip_id}
                  showClipBanner={false}
                  onPick={(id) => void onSetBroll(id)}
                  onDelete={(id) => void onDeleteClip(id)}
                />
              </>
            )}
          </div>
        </div>

        {/* Render footer — primary action lives in the same card as the visual decision
            that unblocks it, instead of a separate "Render" card that's empty 90% of the time. */}
        <div className="mt-5 border-t border-app-divider/50 pt-4">
          {!step2Done && !step3Done ? (
            <p className="text-xs text-app-fg-muted">Pick a background above to enable render.</p>
          ) : isRendering ? (
            <div className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3">
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-amber-500" />
              <div>
                <p className="text-sm font-semibold text-app-fg">Rendering…</p>
                <p className="text-xs text-app-fg-muted">
                  Usually 1–3 minutes. You can leave this page.
                </p>
              </div>
            </div>
          ) : session.render_status === "failed" ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-red-500/25 bg-red-500/[0.07] px-4 py-3">
                <p className="text-sm font-semibold text-red-400">Render failed</p>
                {session.render_error && (
                  <p className="mt-1 text-xs text-app-fg-muted">{session.render_error}</p>
                )}
              </div>
              <button
                type="button"
                disabled={renderBusy}
                onClick={() => void onRender()}
                className="inline-flex items-center gap-2 rounded-xl border border-app-divider px-4 py-2 text-xs font-bold text-app-fg hover:bg-white/5 disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry render
              </button>
            </div>
          ) : step3Done ? (
            <div className="flex flex-wrap items-center gap-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              <p className="text-sm text-app-fg">Render complete — see output below.</p>
              <button
                type="button"
                disabled={renderBusy}
                onClick={() => void onRender()}
                className="ml-auto rounded-lg border border-app-divider px-3 py-1.5 text-xs font-semibold text-app-fg-muted hover:text-app-fg disabled:opacity-50"
              >
                Re-render
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                disabled={renderBusy || !step2Done}
                onClick={() => void onRender()}
                className="inline-flex items-center gap-2 rounded-xl bg-violet-500/20 px-5 py-2.5 text-sm font-bold text-violet-200 hover:bg-violet-500/30 disabled:opacity-50"
              >
                {renderBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                {renderBusy ? "Starting…" : "Render video"}
              </button>
              <p className="text-xs text-app-fg-muted">1080×1920 · ~1–3 min</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Step 3: Reel cover ── */}
      <ReelCoverSection
        hooks={hooks}
        coverOptions={coverOptions}
        coverRegenBusy={coverRegenBusy}
        onRegenerateCovers={onRegenerateCovers}
        images={images}
        thumbnailUrl={thumbnailUrl}
        thumbnailBusy={thumbnailBusy}
        coverText={coverText}
        selectedImageId={coverImageId}
        mode={coverMode}
        onModeChange={setCoverMode}
        onCoverTextChange={setCoverText}
        onSelectImage={setCoverImageId}
        onGenerateAi={onGenerateThumbnail}
        onComposeFromImage={onComposeCoverFromImage}
        step={3}
      />

      {/* ── Step 4: Output (video + caption + hashtags) ── */}
      {(step3Done || session.rendered_video_url) && (
        <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
          <StepHeader n={4} label="Output" done={Boolean(session.rendered_video_url)} />

          {session.rendered_video_url ? (
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <div className="w-full shrink-0 sm:max-w-[240px]">
                <video
                  src={session.rendered_video_url}
                  controls
                  playsInline
                  className="w-full rounded-xl border border-app-divider"
                  style={{ aspectRatio: "9/16" }}
                />
              </div>
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-sm font-semibold text-app-fg">Your video is ready.</p>
                  <p className="mt-1 text-xs leading-relaxed text-app-fg-muted">
                    Download the MP4 and open it in Instagram. Add a trending sound before publishing — audio
                    boosts reach significantly.
                  </p>
                </div>
                <a
                  href={session.rendered_video_url}
                  download="reel.mp4"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 self-start rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-zinc-950 shadow-md shadow-emerald-900/25 hover:opacity-90"
                >
                  <Download className="h-4 w-4" />
                  Download MP4
                </a>
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2.5">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">Before publishing</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-app-fg-muted">
                    Open as a draft in Instagram → Add sound → pick a trending audio in your niche → publish.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-app-fg-muted">Video was rendered and cleaned up after 30 days.</p>
          )}
        </div>
      )}

      {/* ── Caption + hashtags (always after Cover; copy with a button) ── */}
      <CaptionSection
        caption={session.caption_body ?? ""}
        hashtags={session.hashtags ?? []}
        onCopy={() => void copyText("caption + hashtags", captionFull)}
        regenInline={
          <RegenInline
            scope="caption"
            busy={regenBusy}
            onRegen={async (s, fb) => onRegenSection(s, fb)}
            placeholder="Different angle, shorter, …"
          />
        }
      />

      <AiContextSection
        hooks={hooks}
        regenHooks={(fb) => onRegenSection("hooks", fb)}
        busy={regenBusy}
      />

      <PostPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Post preview"
        caption={session.caption_body}
        hashtags={session.hashtags}
        thumbnailUrl={session.thumbnail_url}
        videoUrl={session.rendered_video_url}
      />
    </div>
  );
}
