"use client";

import Link from "next/link";
import type { Operation } from "fast-json-patch";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
// Font loaders moved to ./editors/carousel/carousel-helpers.ts and
// ./editors/shared/style-helpers.tsx (their module-load side effect registers
// @font-face for the Remotion player).
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  Grid3x3,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  Trash2,
  Video,
} from "lucide-react";
import {
  AlignmentPad,
  CarouselEditableEmptyState,
  ControlGroupHeader,
  EditorShell,
  HelpHint,
  SaveStatusPill,
  ScopeLockedHint,
  ScopeToggle,
  SegmentedTabs,
  type CarouselTab,
  type ScopeMode,
  InheritanceHint,
  resolvedContrastLabel,
  resolvedThemeFontLabel,
  resolvedThemeLookLabel,
  type CoverTab,
  type VideoEditorTab,
} from "@/components/editor-ui";
import { CaptionSection } from "@/components/editors/shared/CaptionSection";
import { CoverTextLayerEditor } from "@/components/editors/cover/CoverTextLayerEditor";
import { BackgroundPicker } from "@/components/editors/video/BackgroundPicker";
import { CarouselTextLayerEditor } from "@/components/editors/carousel/CarouselTextLayerEditor";
import {
  CAROUSEL_FONT_LABELS,
  CAROUSEL_FONT_STACKS,
  CAROUSEL_MIN_SLIDES,
  type CarouselFontId,
  carouselDisplayImageUrl,
  carouselFontId,
  mergeCarouselBackgroundStyle,
  mergeCarouselTextBox,
} from "@/components/editors/carousel/carousel-helpers";
import { RegenInline, type RegenScope } from "@/components/editors/shared/RegenInline";
import { AiContextSection } from "@/components/editors/shared/AiContextSection";
import { ClientImagesPicker } from "@/components/editors/shared/ClientImagesPicker";
import { BrollLibrarySection } from "@/components/editors/shared/BrollLibrarySection";
import {
  FormatGlyph,
  LOOK_VISUAL,
  OutlineGlyph,
  STYLE_CHIP_OFF,
  STYLE_CHIP_ON,
  type UiFormat,
  appearanceHasSavedOverrides,
  coverPreviewFontFamily,
  layoutFormatFromTemplateId,
} from "@/components/editors/shared/style-helpers";
import { CoverEditor, type CoverMode } from "@/components/editors/cover/CoverEditor";
import { TalkingHeadEditor } from "@/components/editors/talking-head/TalkingHeadEditor";
import { CarouselEditor } from "@/components/editors/carousel/CarouselEditor";
import { EditorCommandPalette } from "@/components/editors/shared/EditorCommandPalette";
import { StudioFormatTabs } from "@/components/editors/shared/StudioShell";
import { useEditorSelection } from "@/components/editors/shared/useEditorSelection";
import { buildVideoActions } from "@/components/editors/video/videoActions";
import { UndoPill } from "@/components/undo-pill";
import { useUndoKeybindings, useUndoStack } from "@/lib/use-undo-stack";
import { useToast } from "@/components/ui/toast-provider";
import { PostPreviewModal } from "@/components/post-preview-modal";
import { VideoSpecPreview, type VideoClipTrimProps } from "@/components/video-spec-preview";
import { LayoutSlider } from "@/components/layout-slider";
import {
  brollDelete,
  brollList,
  carouselSlideRegenerate,
  carouselSlidesGenerate,
  carouselSlidesPatch,
  carouselSlidesZipUrl,
  clientApiHeaders,
  contentApiFetch,
  clientImagesList,
  creationGenerateBackground,
  creationRenderVideo,
  creationSetBackgroundImage,
  creationSetBroll,
  fetchBackgroundJob,
  fetchClientGenerationLibraries,
  generationComposeThumbnail,
  generationGenerateThumbnail,
  generationGetSession,
  generationPatchSession,
  patchCoverSpec,
  generationRegenerate,
  generationRegenerateCovers,
  patchCreateSession,
  patchSessionVideoSpec,
  postFitSessionSpecToBroll,
  promptEditSessionVideoSpec,
  type BrollClipRow,
  type CarouselBackgroundStyle,
  type CarouselTextBox,
  type CarouselSlide,
  type ClientImageRow,
  type GenerationSession,
  type TextBlock,
} from "@/lib/api-client";
import type { ClientCarouselTemplate } from "@/lib/api";
import {
  DEFAULT_COVER_EDIT,
  coverPayload,
  coverSpecFromPayload,
  coverSpecToPayload,
  coverHookTextFromPayload,
  type CoverEditState,
} from "@/lib/cover-edit";
import { computeCoverTextBlockPreview } from "@/lib/cover-text-layout";
import {
  buildPreviewSpecFromSession,
  DEFAULT_APPEARANCE,
  DEFAULT_LAYOUT,
  effectiveBackgroundDuration,
  LAYOUT_VERTICAL_OFFSET_MAX,
  LAYOUT_VERTICAL_OFFSET_MIN,
  parseVideoSpec,
  sessionPrimaryHookText,
  type VideoSpec,
  type VideoSpecAppearance,
  type VideoSpecLayout,
} from "@/lib/video-spec";
import {
  autoBlockDurationSec,
  autoHookDurationSec,
  segmentDurationRange,
  segmentDurationSec,
  segmentExcerpt,
  segmentLabel,
} from "@/lib/video-spec-timing";
import { effectivePausesSec, pauseGapToExplicitTimelinePatchOps, relayoutTimeline } from "@/lib/video-spec-timeline";
import { createRafCoalescer } from "@/lib/raf-coalesce";
import { stablePlayerSpec } from "@/lib/player-spec";
import {
  buildLayerRows,
  computeLayerTimingChange,
  createTextLayer,
  deleteTextLayer,
  editTextLayer,
} from "@/lib/video-spec-layer-timeline";
import {
  APPEARANCE_CLEAR_OPS,
  appearanceOpsToPatchOps,
  inferContrast,
  inferFontMood,
  mergeAppearanceOpsIntoDraft,
  mergeGlobalAndBlockAppearance,
  opsForContrast,
  opsForFontMood,
  type AppearanceOp,
  type ContrastId,
  type VideoThemeId,
} from "@/lib/appearance-style";

/** Remotion renders often exceed 1–3 min; polling must outlast the job and prefer session row state. */
const VIDEO_RENDER_POLL_INTERVAL_MS = 2500;
const VIDEO_RENDER_MAX_POLLS = 240;

// STYLE_CHIP_ON / STYLE_CHIP_OFF extracted to ./editors/shared/style-helpers.tsx.

// Carousel font loading + constants + pure helpers extracted to
// ./editors/carousel/carousel-helpers.ts.
// COVER_PATRICK_FONT (PatrickHand font loader) extracted to
// ./editors/shared/style-helpers.tsx — no longer referenced from this file
// since the cover preview rendering moved to CoverEditor.tsx.

function reindexCarouselSlides(slides: CarouselSlide[]): CarouselSlide[] {
  const sorted = [...slides].sort((a, b) => a.idx - b.idx);
  const n = sorted.length;
  return sorted.map((s, i) => ({
    ...s,
    idx: i,
    text_box: { ...mergeCarouselTextBox({ ...s, idx: i }, n), ...(s.text_box ?? {}) },
  }));
}

// clientImageIdForSlide extracted to ./editors/carousel/carousel-helpers.ts.

function mergeCarouselSlidesFromServer(
  serverSlides: CarouselSlide[],
  localDraft: CarouselSlide[],
  preserveLocalEdits: boolean,
): CarouselSlide[] {
  const sorted = [...serverSlides].sort((a, b) => a.idx - b.idx);
  const withDefaults = sorted.map((row) => ({
    ...row,
    text_box: row.text_box ?? mergeCarouselTextBox(row, sorted.length),
  }));
  if (!preserveLocalEdits) return withDefaults;
  return localDraft.map((local) => {
    const server = withDefaults.find((s) => s.idx === local.idx);
    if (!server) return local;
    return {
      ...local,
      base_image_url: server.base_image_url ?? local.base_image_url,
      image_url: server.image_url ?? local.image_url,
      prompt: server.prompt ?? local.prompt,
      background_style: server.background_style ?? local.background_style,
    };
  });
}

/** Duration slider: hook length or block end only — other layers keep their timeline positions. */
function beatDurationToLayerTiming(
  spec: VideoSpec,
  segmentId: string,
  newDurationSec: number,
): { startSec?: number; endSec?: number } {
  const range = segmentDurationRange(segmentId);
  const dur = Math.min(range.max, Math.max(range.min, newDurationSec));
  if (segmentId === "hook") {
    return { endSec: dur };
  }
  const b = spec.blocks.find((x) => x.id === segmentId);
  if (!b) {
    return { endSec: dur };
  }
  return { endSec: Math.round((b.startSec + dur) * 100) / 100 };
}

// UiFormat, FormatGlyph, OutlineGlyph, LOOK_VISUAL, coverPreviewFontFamily,
// appearanceHasSavedOverrides, layoutFormatFromTemplateId, STYLE_CHIP_*
// extracted to ./editors/shared/style-helpers.tsx and imported at the top.

// `CarouselFontId` and `carouselFontId` extracted to
// ./editors/carousel/carousel-helpers.ts (imported above).

function blockHasSavedStyleOverrides(b: VideoSpec["blocks"][number] | undefined): boolean {
  if (!b) return false;
  if (b.textTreatment != null) return true;
  return appearanceHasSavedOverrides(b.appearance ?? {});
}

function canonicalFormatKey(k: string | null | undefined): string | null {
  if (!k?.trim()) return null;
  if (k === "b_roll") return "b_roll_reel";
  return k;
}

const CAROUSEL_ROLE_LABELS: Record<string, string> = {
  cover: "Cover",
  body: "Body",
  screenshot: "Screenshot",
  quote: "Quote",
  cta: "CTA",
  other: "Other",
};

function carouselTemplateSummary(template: ClientCarouselTemplate | null | undefined): string | null {
  if (!template?.slides?.length) return null;
  const roles = [...template.slides]
    .sort((a, b) => a.idx - b.idx)
    .map((slide) => CAROUSEL_ROLE_LABELS[slide.role] ?? slide.role)
    .join(" · ");
  return `${template.slides.length} slide${template.slides.length === 1 ? "" : "s"} · ${roles}`;
}

// RegenInline + RegenScope were extracted to ./editors/shared/RegenInline.tsx.

// BrollLibrarySection extracted to ./editors/shared/BrollLibrarySection.tsx.

// ClientImagesPicker extracted to ./editors/shared/ClientImagesPicker.tsx.

// `mergeCarouselTextBox`, `mergeCarouselBackgroundStyle`, `clamp01`, and
// `clampRange` were extracted to ./editors/carousel/carousel-helpers.ts and
// are imported at the top of this file.

// downloadBlob inlined into CarouselEditor (only carousel ZIP export used it).

// CarouselTextLayerEditor was extracted to
// ./editors/carousel/CarouselTextLayerEditor.tsx — pure leaf, drag/resize stage
// for the carousel text overlay. The canonical render path remains server-side
// Pillow (``compose_carousel_final_png``); this canvas is for live preview only.

// CoverTextLayerEditor was extracted to ./editors/cover/CoverTextLayerEditor.tsx
// (REEL_COVER_STAGE_W / REEL_COVER_STAGE_H moved alongside it as stage constants).

// CarouselSection extracted to ./editors/carousel/CarouselEditor.tsx (renamed CarouselEditor).

// StepHeader was extracted to ./editors/shared/StepHeader.tsx.

// CoverMode is re-exported via the CoverEditor module imported at the top.

/** Active source tab for the merged Visual+Render card. Maps to backend `background_type`:
 *  ai → generated_image, image → client_image, clip → broll. */
type BgSource = "ai" | "image" | "clip";

function bgSourceFromSession(t: string | null | undefined): BgSource {
  const v = (t || "").trim().toLowerCase();
  if (v === "broll") return "clip";
  if (v === "client_image") return "image";
  return "ai";
}

// ReelCoverSection extracted to ./editors/cover/CoverEditor.tsx (renamed CoverEditor).

// CaptionSection was extracted to ./editors/shared/CaptionSection.tsx.

// AiContextSection was extracted to ./editors/shared/AiContextSection.tsx.

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
  const [coverEdit, setCoverEdit] = useState<CoverEditState>(DEFAULT_COVER_EDIT);
  /** Hydrate flag: skip the autosave round-trip until the editor has loaded the
   *  persisted cover_spec at least once (or confirmed there isn't one). Prevents
   *  the initial mount from PATCHing default state over a real saved spec. */
  const coverHydratedRef = useRef(false);
  /** Counter of in-flight cover_spec PATCHes — drives the shared "Saving…" pill. */
  const [coverSpecInFlight, setCoverSpecInFlight] = useState(0);
  const coverSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Counter + debounce ref for text_blocks / script autosave. Mirrors the same
   *  pattern so the "Save text blocks" and "Save script" buttons can disappear. */
  const [contentInFlight, setContentInFlight] = useState(0);
  const textBlocksSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scriptSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** In-flight count for carousel slide PATCHes (text + layout). Surfaces the
   *  previously-silent autosave in the section header SaveStatusPill. */
  const [carouselInFlight, setCarouselInFlight] = useState(0);
  const [coverRegenBusy, setCoverRegenBusy] = useState(false);
  const [regenBusyScope, setRegenBusyScope] = useState<RegenScope | null>(null);
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
  const [carouselConvertBusy, setCarouselConvertBusy] = useState(false);
  const [carouselDraft, setCarouselDraft] = useState<CarouselSlide[]>([]);
  const carouselDraftDirty = useRef(false);
  const carouselDraftRef = useRef<CarouselSlide[]>([]);
  const carouselSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bust browser cache when Supabase overwrites the same carousel_base_* path. */
  const [carouselBgCacheRev, setCarouselBgCacheRev] = useState<Record<number, number>>({});
  const [carouselRegeneratingIdx, setCarouselRegeneratingIdx] = useState<number | null>(null);
  const bumpCarouselBgCacheRev = useCallback((idx: number) => {
    setCarouselBgCacheRev((prev) => ({ ...prev, [idx]: (prev[idx] ?? 0) + 1 }));
  }, []);
  /** Generation carousel templates — same library GET as Generate; used to swap snapshots before slides exist. */
  const [carouselTemplateLibrary, setCarouselTemplateLibrary] = useState<ClientCarouselTemplate[]>([]);
  const [carouselTemplateBusy, setCarouselTemplateBusy] = useState(false);
  /** After slides exist, user opens this to pick a new recipe (clears slides via PATCH). */
  const [carouselStyleSwitchOpen, setCarouselStyleSwitchOpen] = useState(false);
  const [carouselStyleSwitchDraftId, setCarouselStyleSwitchDraftId] = useState<string | null>(null);

  useEffect(() => {
    carouselDraftRef.current = carouselDraft;
  }, [carouselDraft]);

  /**
   * Snapshot-based undo for the video spec. We push the *previous* spec right
   * before a destructive operation (template/theme swap, AI refine, layer
   * delete) and let the user revert via Cmd+Z or the inline pill. Per-stroke
   * autosaves intentionally do NOT push — that would fill the stack with
   * micro-edits and bury the destructive moves the user actually wants to
   * undo.
   */
  const undoStack = useUndoStack<VideoSpec>({ cap: 20 });
  const undoApplyingRef = useRef(false);

  // Hold the latest parent callback in a ref so it never invalidates effects/callbacks.
  // (Parents typically pass an inline `onSessionUpdated`, which would otherwise loop.)
  const onSessionUpdatedRef = useRef(onSessionUpdated);
  useEffect(() => {
    onSessionUpdatedRef.current = onSessionUpdated;
  }, [onSessionUpdated]);

  /** Debounced autosave for text blocks (on-screen captions for video formats).
   *  Replaces the old explicit "Save text blocks" button: changes flush 600ms
   *  after the user stops typing. The SaveStatusPill in the section header is
   *  the only feedback users need. */
  const textBlocksRef = useRef<TextBlock[]>([]);
  useEffect(() => {
    textBlocksRef.current = textDraft;
  }, [textDraft]);
  useEffect(() => {
    if (!bootstrapDone) return;
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!cs || !os || !session?.id) return;
    // Don't fire when there's nothing to save (initial server load already matches).
    const serverBlocks = Array.isArray(session.text_blocks) ? session.text_blocks : [];
    if (JSON.stringify(serverBlocks) === JSON.stringify(textDraft)) return;
    if (textBlocksSaveTimer.current) clearTimeout(textBlocksSaveTimer.current);
    textBlocksSaveTimer.current = setTimeout(() => {
      void (async () => {
        setContentInFlight((n) => n + 1);
        try {
          const res = await patchCreateSession(cs, os, session.id, {
            text_blocks: textBlocksRef.current.filter((b) => b.text.trim()),
          });
          if (res.ok) {
            // Avoid a full applySession (which would wipe other editor drafts);
            // just mirror the canonical server-side text_blocks back into session.
            setSession((prev) =>
              prev ? { ...prev, text_blocks: res.data.text_blocks ?? prev.text_blocks } : prev,
            );
          }
        } finally {
          setContentInFlight((n) => Math.max(0, n - 1));
        }
      })();
    }, 600);
    return () => {
      if (textBlocksSaveTimer.current) {
        clearTimeout(textBlocksSaveTimer.current);
        textBlocksSaveTimer.current = null;
      }
    };
    // session.text_blocks intentionally not a dep — we re-derive from `session`
    // when needed inside the effect. Including it would loop on server echo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textDraft, bootstrapDone, clientSlug, orgSlug, session?.id]);

  /** Same pattern for the talking-head script. */
  const scriptDraftRef = useRef("");
  useEffect(() => {
    scriptDraftRef.current = scriptDraft;
  }, [scriptDraft]);
  useEffect(() => {
    if (!bootstrapDone) return;
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!cs || !os || !session?.id) return;
    if ((session.script ?? "") === scriptDraft) return;
    if (scriptSaveTimer.current) clearTimeout(scriptSaveTimer.current);
    scriptSaveTimer.current = setTimeout(() => {
      void (async () => {
        setContentInFlight((n) => n + 1);
        try {
          const res = await patchCreateSession(cs, os, session.id, {
            script: scriptDraftRef.current,
          });
          if (res.ok) {
            setSession((prev) =>
              prev ? { ...prev, script: res.data.script ?? prev.script } : prev,
            );
          }
        } finally {
          setContentInFlight((n) => Math.max(0, n - 1));
        }
      })();
    }, 700);
    return () => {
      if (scriptSaveTimer.current) {
        clearTimeout(scriptSaveTimer.current);
        scriptSaveTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptDraft, bootstrapDone, clientSlug, orgSlug, session?.id]);

  /** Debounced autosave for the cover editor. Pattern mirrors `carouselSaveTimer`:
   *  any change to coverEdit / coverText / coverMode / coverImageId schedules a
   *  PATCH 500ms later, so dragging sliders or typing in the headline doesn't
   *  flood the network but the user never has to remember to click "save". */
  useEffect(() => {
    if (!coverHydratedRef.current) return;
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!cs || !os || !session?.id) return;
    if (coverSaveTimer.current) clearTimeout(coverSaveTimer.current);
    coverSaveTimer.current = setTimeout(() => {
      void (async () => {
        setCoverSpecInFlight((n) => n + 1);
        try {
          const payload = coverSpecToPayload(coverEdit, {
            hookText: coverText.trim() || null,
            coverMode,
            clientImageId: coverImageId || null,
          });
          const res = await patchCoverSpec(cs, os, session.id, payload);
          if (res.ok) {
            // Mirror server-confirmed cover_spec into the session so any other
            // listener (e.g. session header) sees the latest persisted state.
            setSession((prev) => (prev ? { ...prev, cover_spec: payload } : prev));
          }
        } finally {
          setCoverSpecInFlight((n) => Math.max(0, n - 1));
        }
      })();
    }, 500);
    return () => {
      if (coverSaveTimer.current) {
        clearTimeout(coverSaveTimer.current);
        coverSaveTimer.current = null;
      }
    };
  }, [coverEdit, coverText, coverMode, coverImageId, clientSlug, orgSlug, session?.id]);

  const applySession = useCallback((s: GenerationSession) => {
    setSession(s);
    setTextDraft(Array.isArray(s.text_blocks) ? s.text_blocks.map((b) => ({ ...b })) : []);
    setScriptDraft(s.script ?? "");
    setSelectedClipId(s.broll_clip_id ?? "");
    setSelectedImageId(s.client_image_id ?? "");
    if (s.selected_cover_template?.reference_image_id) {
      setCoverMode("image");
      setCoverImageId(s.selected_cover_template.reference_image_id);
    }
    if (s.thumbnail_url) setThumbnailUrl(s.thumbnail_url);
    /** Hydrate cover editor state from the persisted `cover_spec` (if any).
     *  Without this, the user lost every style/template/layout tweak on every
     *  page mount — the editor would silently reset to defaults while leaving
     *  the previously-baked thumbnail visible. */
    if (!coverHydratedRef.current) {
      const hydrated = coverSpecFromPayload(s.cover_spec);
      if (hydrated) {
        setCoverEdit(hydrated);
        if (s.cover_spec && typeof s.cover_spec === "object") {
          const mode = (s.cover_spec as Record<string, unknown>).cover_mode;
          if (mode === "ai" || mode === "image") setCoverMode(mode);
          const ci = (s.cover_spec as Record<string, unknown>).client_image_id;
          if (typeof ci === "string" && ci) setCoverImageId(ci);
          const ht = coverHookTextFromPayload(s.cover_spec);
          if (ht) setCoverText(ht);
        }
      }
      coverHydratedRef.current = true;
    }
    if (Array.isArray(s.carousel_slides)) {
      const sorted = [...s.carousel_slides].sort((a, b) => a.idx - b.idx);
      const prevDraft = carouselDraftRef.current;
      const next = mergeCarouselSlidesFromServer(
        sorted as CarouselSlide[],
        prevDraft,
        carouselDraftDirty.current,
      );
      carouselDraftRef.current = next;
      setCarouselDraft(next);
      if (sorted.length > 0) setCarouselCount(sorted.length);
      setCarouselBgCacheRev((prev) => {
        const out = { ...prev };
        for (const sl of sorted) {
          const row = sl as CarouselSlide;
          const local = prevDraft.find((l) => l.idx === row.idx);
          const serverBg = (row.base_image_url || "").trim();
          const localBg = (local?.base_image_url || "").trim();
          if (serverBg && serverBg !== localBg) {
            out[row.idx] = (out[row.idx] ?? 0) + 1;
          }
        }
        return out;
      });
    } else if (!carouselDraftDirty.current) {
      carouselDraftRef.current = [];
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
    coverHydratedRef.current = false;
    // New session = fresh undo history (otherwise Cmd+Z could restore the
    // previous session's spec into the new one, which is destructive).
    undoStack.reset();
    void (async () => {
      const [sRes, bRes, iRes, libRes] = await Promise.all([
        generationGetSession(cs, os, sessionId),
        brollList(cs, os),
        clientImagesList(cs, os),
        fetchClientGenerationLibraries(cs, os),
      ]);
      if (cancelled) return;
      if (libRes.ok) {
        setCarouselTemplateLibrary(libRes.data.carouselTemplates);
      }
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
  const [safeZonePreview, setSafeZonePreview] = useState(false);
  /** ⌘K command palette open state — Phase D. The palette + visible inspector
   *  buttons share a single action registry (see editors/video/videoActions.ts)
   *  so they never drift apart. */
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** Visible canvas tab for the Studio editor. This replaces the old long
   *  vertical stack of Step 1 → Step 2 → Step 3 → Step 4 for reel sessions. */
  const [videoSurface, setVideoSurface] = useState<"reel" | "cover" | "output">("reel");
  /** Studio selection state — Phase C primitive. Drives the InspectorForSelection
   *  pattern. Until the Studio shell migration is fully wired into the
   *  text_overlay branch, the workspace just uses it for `appliesTo` filters
   *  in the action registry (hook/block actions become available based on
   *  selectedSegmentId echoing into this hook). */
  const editorSelection = useEditorSelection();
  /** AI refine is the only spec operation that should block the UI — it's a multi-step
   *  LLM round-trip the user shouldn't double-fire. Template / look / appearance /
   *  layout commits are tracked separately via per-field optimistic state below. */
  const [aiRefineBusy, setAiRefineBusy] = useState(false);
  /** Drives visible copy during the two-step AI refine (LLM → apply patches). */
  const [aiRefinePhase, setAiRefinePhase] = useState<"idle" | "thinking" | "applying">("idle");
  /** Optimistic overrides for template / look so the active state flips on click,
   *  before the PATCH round-trips. Cleared on success (server-state wins) or failure. */
  const [pendingTemplate, setPendingTemplate] = useState<VideoSpec["templateId"] | null>(null);
  const [pendingTheme, setPendingTheme] = useState<VideoSpec["themeId"] | null>(null);
  /** Counter of in-flight spec PATCHes — drives the small "Saving…" pill without
   *  disabling every control in the panel. */
  const [specInFlight, setSpecInFlight] = useState(0);
  /** Monotonic request id; applySession only runs for the *latest* response so a
   *  slow PATCH can't clobber state from a faster, more recent one. */
  const specReqIdRef = useRef(0);
  /** Set when the user edits Style (font/contrast) so we know they diverged from pure Look defaults. */
  const styleTouchedRef = useRef(false);
  useEffect(() => {
    styleTouchedRef.current = false;
  }, [session?.id]);
  /** Timeline-strip selection: which segment is currently being edited in the
   *  Timing inspector. "hook" or a block id; defaults to the hook on every new
   *  session (most natural starting point — "what's my opener?"). */
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>("hook");
  /** Live duration draft while the slider is being dragged. Same pattern as
   *  `layoutDraft` — flushes optimistically into `livePreviewSpec`, commits on
   *  release. `null` = not currently dragging; preview reflects saved spec. */
  const [timingDraft, setTimingDraft] = useState<{ id: string; durationSec: number } | null>(null);
  /** Per-beat size while dragging — preview only until release. */
  const [fontScaleDraft, setFontScaleDraft] = useState<{ segmentId: string; scale: number } | null>(null);
  /** B-roll in/out while dragging — preview only until release. */
  const [brollTrimDraft, setBrollTrimDraft] = useState<{
    trimStartSec: number;
    trimEndSec: number;
  } | null>(null);
  const [layerTimingDraft, setLayerTimingDraft] = useState<{
    id: string;
    timing: { startSec?: number; endSec?: number };
  } | null>(null);
  /** In-flight edit for a single transition: pause before block `idx` (0 = after hook). */
  const [pauseDraft, setPauseDraft] = useState<{ idx: number; sec: number } | null>(null);
  /** Which inter-beat gap the compact Timing panel is editing (dropdown). */
  const [selectedGapIdx, setSelectedGapIdx] = useState(0);
  const isTextOverlay = fk === "text_overlay";
  const isCarousel = fk === "carousel";
  const isBroll = fk === "b_roll_reel";
  const isTalkingHead = fk === "talking_head";

  /** PNG slides exist — slide text/images are persisted until user switches recipe (clears slides). */
  const carouselSlidesLocked = useMemo(() => {
    const slides = session?.carousel_slides;
    return Array.isArray(slides) && slides.length > 0;
  }, [session?.carousel_slides]);

  useEffect(() => {
    if (!carouselSlidesLocked) {
      setCarouselStyleSwitchOpen(false);
      setCarouselStyleSwitchDraftId(null);
    }
  }, [carouselSlidesLocked]);

  /** When no PNGs yet, sync slider to session target length from Generate page. */
  useEffect(() => {
    if (!isCarousel || carouselSlidesLocked) return;
    const slides = session?.carousel_slides;
    if (Array.isArray(slides) && slides.length > 0) return;
    const raw = session?.carousel_slide_count;
    if (raw != null && typeof raw === "number" && Number.isFinite(raw)) {
      setCarouselCount(Math.min(10, Math.max(3, raw)));
    }
  }, [
    carouselSlidesLocked,
    isCarousel,
    session?.carousel_slide_count,
    session?.carousel_slides,
    session?.id,
  ]);

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

  const savedBlocks = useMemo(() => session?.text_blocks ?? [], [session?.text_blocks]);
  const hasUnsavedBlocks = useMemo(() => {
    if (textDraft.length !== savedBlocks.length) return true;
    return textDraft.some((b, i) => b.text !== savedBlocks[i]?.text || b.isCTA !== savedBlocks[i]?.isCTA);
  }, [textDraft, savedBlocks]);
  const hasUnsavedScript = (session?.script ?? "") !== scriptDraft;
  const step1Done = !hasUnsavedBlocks && textDraft.length > 0;
  const step2Done = Boolean(session?.background_url);
  const step3Done = session?.render_status === "done" || session?.render_status === "cleaned";
  const isRendering = session?.render_status === "rendering";

  const previewVideoSpec = useMemo(() => {
    if (!session) return null;
    const parsed = parseVideoSpec(session.video_spec);
    if (parsed) return parsed;
    const raw = session.video_spec;
    const looksLikePersistedSpec =
      raw !== null &&
      raw !== undefined &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      (raw as { v?: unknown }).v === 1;
    // Do not substitute ``buildPreviewSpecFromSession`` when a real v1 spec failed parse —
    // that hid Zod/JSON mismatches and made PATCH UI (format, timeline) look broken.
    if (looksLikePersistedSpec) return null;
    return buildPreviewSpecFromSession(session);
  }, [session]);

  const previewVideoSpecRef = useRef<VideoSpec | null>(null);
  useEffect(() => {
    previewVideoSpecRef.current = previewVideoSpec;
  }, [previewVideoSpec]);

  /** Must run every render (before any early return) — same order as backend
   *  ``_session_hook_text``: hooks[0] → video_spec.hook → angle draft_hook. */
  const primaryHookText = useMemo(
    () =>
      session
        ? sessionPrimaryHookText({
            hooks: session.hooks,
            video_spec: session.video_spec,
            angles: session.angles,
            chosen_angle_index: session.chosen_angle_index ?? null,
          })
        : "",
    [session],
  );

  /** Local optimistic state for layout sliders so dragging is lag-free.
   *  Saved value (`previewVideoSpec.layout`) wins on every fresh fetch / non-layout
   *  edit; we sync via a string key so a re-render after our own PATCH (returning
   *  the same value) is a no-op and never clobbers a drag in progress. */
  const sessionLayout: VideoSpecLayout = previewVideoSpec?.layout ?? DEFAULT_LAYOUT;
  const [layoutDraft, setLayoutDraft] = useState<VideoSpecLayout>(sessionLayout);
  const [layoutGuides, setLayoutGuides] = useState(false);
  const [videoEditorTab, setVideoEditorTab] = useState<VideoEditorTab>("text");
  const layoutSyncKey = `${session?.id ?? ""}|${sessionLayout.verticalAnchor ?? "bottom"}|${sessionLayout.verticalOffset}|${sessionLayout.textPanX ?? 0}|${sessionLayout.scale}|${sessionLayout.sidePadding}|${sessionLayout.textAlign}|${sessionLayout.stackGap}|${sessionLayout.stackGrowth}`;
  useEffect(() => {
    setLayoutDraft(sessionLayout);
    // sessionLayout is included transitively via the key string; we re-sync only on actual saved changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutSyncKey]);

  const sessionAppearance: VideoSpecAppearance = previewVideoSpec?.appearance ?? DEFAULT_APPEARANCE;
  const [appearanceDraft, setAppearanceDraft] = useState<VideoSpecAppearance>(sessionAppearance);
  const [blockAppearanceDraft, setBlockAppearanceDraft] = useState<VideoSpecAppearance>({});
  const appearanceSyncKey = `${session?.id ?? ""}|${JSON.stringify(sessionAppearance)}`;
  const appearanceDraftKey = JSON.stringify(appearanceDraft);
  useEffect(() => {
    setAppearanceDraft(sessionAppearance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearanceSyncKey]);

  const blockStyleSyncKey = `${session?.id ?? ""}|${selectedSegmentId}|${JSON.stringify(previewVideoSpec?.blocks.find((b) => b.id === selectedSegmentId)?.appearance ?? {})}`;
  useEffect(() => {
    if (selectedSegmentId === "hook") return;
    const row = previewVideoSpec?.blocks.find((b) => b.id === selectedSegmentId);
    if (!row) return;
    setBlockAppearanceDraft({ ...(row.appearance ?? {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockStyleSyncKey]);

  useEffect(() => {
    const n = previewVideoSpec?.blocks?.length ?? 0;
    if (n <= 0) return;
    setSelectedGapIdx((i) => Math.min(Math.max(0, i), n - 1));
  }, [session?.id, previewVideoSpec?.blocks?.length]);

  const blockAppearanceDraftKey =
    selectedSegmentId === "hook" ? "" : JSON.stringify(blockAppearanceDraft);

  /** Final spec rendered by the Player. Layered optimistic edits (template / look /
   *  appearance / layout / timing) win over the saved spec until the server confirms — keeps the
   *  UI feeling instant without waiting on PATCH round-trips. Memoized on a
   *  content-hash key so the Player's `inputProps` only gets a new identity when
   *  *meaningful values* change (preventing redundant Remotion re-syncs that flash
   *  the player). */
  const livePreviewSpec = useMemo<VideoSpec | null>(() => {
    if (!previewVideoSpec) return null;
    const basePauses = effectivePausesSec(previewVideoSpec);
    const pausesSec =
      pauseDraft != null && pauseDraft.idx >= 0 && pauseDraft.idx < basePauses.length
        ? basePauses.map((p, i) => (i === pauseDraft.idx ? pauseDraft.sec : p))
        : basePauses;
    const base: VideoSpec = {
      ...previewVideoSpec,
      templateId: pendingTemplate ?? previewVideoSpec.templateId,
      themeId: pendingTheme ?? previewVideoSpec.themeId,
      layout: layoutDraft,
      appearance: appearanceDraft,
      pausesSec,
    };
    // Apply in-flight duration drag by trimming/extending the selected layer only
    // (hook duration or block endSec) — same math as `computeLayerTimingChange` PATCH.
    const durationAdjusted =
      timingDraft != null
        ? computeLayerTimingChange(
            base,
            timingDraft.id,
            beatDurationToLayerTiming(base, timingDraft.id, timingDraft.durationSec),
          ).spec
        : base;
    const raw =
      layerTimingDraft != null
        ? computeLayerTimingChange(durationAdjusted, layerTimingDraft.id, layerTimingDraft.timing).spec
        : durationAdjusted;
    // Layer bars are absolute windows. Relayout is only for the legacy gap editor;
    // running it after layer drags would push later bars and destroy overlaps.
    const withPause = pauseDraft != null ? relayoutTimeline(raw, { applyClipCap: false }) : raw;
    let out: VideoSpec = withPause;
    if (selectedSegmentId !== "hook" && out.blocks.some((b) => b.id === selectedSegmentId)) {
      out = {
        ...out,
        blocks: out.blocks.map((b) =>
          b.id === selectedSegmentId ? { ...b, appearance: blockAppearanceDraft } : b,
        ),
      };
    }
    if (brollTrimDraft && out.background.kind === "video") {
      out = {
        ...out,
        background: {
          ...out.background,
          trimStartSec: brollTrimDraft.trimStartSec,
          trimEndSec: brollTrimDraft.trimEndSec,
        },
      };
    }
    if (fontScaleDraft) {
      const fsVal =
        Math.abs(fontScaleDraft.scale - 1) < 0.02 ? undefined : fontScaleDraft.scale;
      if (fontScaleDraft.segmentId === "hook") {
        const hook = { ...out.hook };
        if (fsVal === undefined) delete hook.fontScale;
        else hook.fontScale = fsVal;
        out = { ...out, hook };
      } else {
        out = {
          ...out,
          blocks: out.blocks.map((b) => {
            if (b.id !== fontScaleDraft.segmentId) return b;
            const row = { ...b };
            if (fsVal === undefined) delete row.fontScale;
            else row.fontScale = fsVal;
            return row;
          }),
        };
      }
    }
    return out;
    // Depend on primitives, not object refs — avoids spurious recomputes when
    // `previewVideoSpec` is reparsed but its content is unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    previewVideoSpec,
    pendingTemplate,
    pendingTheme,
    layoutDraft.verticalAnchor,
    layoutDraft.verticalOffset,
    layoutDraft.textPanX,
    layoutDraft.scale,
    layoutDraft.sidePadding,
    layoutDraft.textAlign,
    layoutDraft.stackGap,
    layoutDraft.stackGrowth,
    appearanceDraftKey,
    pauseDraft?.idx,
    pauseDraft?.sec,
    timingDraft?.id,
    timingDraft?.durationSec,
    layerTimingDraft?.id,
    layerTimingDraft?.timing.startSec,
    layerTimingDraft?.timing.endSec,
    selectedSegmentId,
    blockAppearanceDraftKey,
    fontScaleDraft?.segmentId,
    fontScaleDraft?.scale,
    brollTrimDraft?.trimStartSec,
    brollTrimDraft?.trimEndSec,
  ]);

  const playerSpecCacheRef = useRef<{ key: string; spec: VideoSpec } | null>(null);
  const playerSpec = useMemo(() => {
    if (!livePreviewSpec) {
      playerSpecCacheRef.current = null;
      return null;
    }
    const result = stablePlayerSpec(livePreviewSpec, playerSpecCacheRef.current);
    playerSpecCacheRef.current = result.cache;
    return result.spec;
  }, [livePreviewSpec]);

  const styleAppearanceForChips = useMemo(() => {
    if (!livePreviewSpec) return DEFAULT_APPEARANCE;
    if (selectedSegmentId === "hook") return livePreviewSpec.appearance ?? DEFAULT_APPEARANCE;
    const blk = livePreviewSpec.blocks.find((b) => b.id === selectedSegmentId);
    return mergeGlobalAndBlockAppearance(livePreviewSpec.appearance ?? DEFAULT_APPEARANCE, blk?.appearance ?? null);
  }, [livePreviewSpec, selectedSegmentId]);

  const styleThemeForCard = (pendingTheme ?? previewVideoSpec?.themeId ?? "bold-modern") as VideoThemeId;
  const styleTemplateId = pendingTemplate ?? previewVideoSpec?.templateId ?? "centered-pop";
  const styleFontMood = inferFontMood(styleAppearanceForChips);
  const styleContrast = inferContrast(styleAppearanceForChips, styleTemplateId, styleThemeForCard);
  const effectiveTemplateId = livePreviewSpec?.templateId ?? previewVideoSpec?.templateId;
  const formatChipSelection = layoutFormatFromTemplateId(effectiveTemplateId);
  const isBoldOutline = useMemo(() => {
    if (!livePreviewSpec) return false;
    if (selectedSegmentId === "hook") return livePreviewSpec.textTreatment === "bold-outline";
    const blk = livePreviewSpec.blocks.find((b) => b.id === selectedSegmentId);
    return (blk?.textTreatment ?? livePreviewSpec.textTreatment) === "bold-outline";
  }, [livePreviewSpec, selectedSegmentId]);

  const styleResetEnabled =
    selectedSegmentId === "hook"
      ? appearanceHasSavedOverrides(sessionAppearance)
      : blockHasSavedStyleOverrides(previewVideoSpec?.blocks.find((b) => b.id === selectedSegmentId));
  const uiPinForPositionRow = (() => {
    const tpl = livePreviewSpec?.templateId ?? previewVideoSpec?.templateId;
    if (tpl === "top-banner") return "top" as const;
    if (tpl === "bottom-card" || tpl === "stacked-cards")
      return (layoutDraft.verticalAnchor ?? "bottom") as VideoSpecLayout["verticalAnchor"];
    return "center" as const;
  })();

  const selectedLayerRows = useMemo(
    () => (livePreviewSpec ? buildLayerRows(livePreviewSpec) : previewVideoSpec ? buildLayerRows(previewVideoSpec) : []),
    [livePreviewSpec, previewVideoSpec],
  );
  const selectedLayer = selectedLayerRows.find((r) => r.id === selectedSegmentId) ?? selectedLayerRows[0] ?? null;

  const stableBlockLabelsRef = useRef<Record<string, string>>({});
  const lastSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const sessId = session?.id ?? null;
    const map = stableBlockLabelsRef.current;
    if (lastSessionIdRef.current !== sessId) {
      lastSessionIdRef.current = sessId;
      stableBlockLabelsRef.current = { hook: "Hook" };
    }
    if (!previewVideoSpec) return;
    let textCount = Object.values(stableBlockLabelsRef.current).filter((v) => v.startsWith("Text ")).length;
    previewVideoSpec.blocks.forEach((b) => {
      if (!stableBlockLabelsRef.current[b.id]) {
        if (b.isCTA) {
          stableBlockLabelsRef.current[b.id] = "CTA";
        } else {
          textCount++;
          stableBlockLabelsRef.current[b.id] = `Text ${textCount}`;
        }
      }
    });
  }, [session?.id, previewVideoSpec]);

  const [layerTextDraft, setLayerTextDraft] = useState("");
  const [layerCtaDraft, setLayerCtaDraft] = useState(false);
  useEffect(() => {
    setLayerTextDraft(selectedLayer?.text ?? "");
    setLayerCtaDraft(Boolean(selectedLayer?.isCTA));
  }, [selectedLayer?.id, selectedLayer?.text, selectedLayer?.isCTA]);

  /** Editable hook for Step 1. Single source of truth for the opening line.
   *  Persisted via `/hook/text` op on blur (see `onCommitHookText` below,
   *  declared after `applyVideoSpecOps`). The previous dual-text surface
   *  (Timing tab → Layer text) is now read-only. */
  const [hookDraft, setHookDraft] = useState("");
  useEffect(() => {
    setHookDraft(primaryHookText ?? "");
  }, [primaryHookText]);

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

  const moveTextBlock = useCallback((index: number, direction: -1 | 1) => {
    setTextDraft((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const temp = next[index]!;
      next[index] = next[nextIndex]!;
      next[nextIndex] = temp;
      return next;
    });
  }, []);

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
    async (scope: RegenScope, feedback: string): Promise<boolean> => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!session || !cs || !os) return false;
      setRegenBusyScope(scope);
      try {
        const res = await generationRegenerate(cs, os, session.id, {
          scope,
          feedback: feedback || undefined,
        });
        if (!res.ok) {
          show(res.error, "error");
          return false;
        }
        applySession(res.data);
        show("Regenerated.", "success");
        return true;
      } finally {
        setRegenBusyScope(null);
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

  const refreshSession = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!cs || !os || !sessionId) {
      return { ok: false as const, error: "Missing client or session" };
    }
    const s = await generationGetSession(cs, os, sessionId);
    if (s.ok) applySession(s.data);
    return s;
  }, [applySession, clientSlug, orgSlug, sessionId]);

  const pollRenderJob = useCallback(
    async (jobId: string, sId: string) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!cs || !os) return;
      for (let i = 0; i < VIDEO_RENDER_MAX_POLLS; i += 1) {
        await new Promise((r) => setTimeout(r, VIDEO_RENDER_POLL_INTERVAL_MS));
        const sPoll = await generationGetSession(cs, os, sId);
        if (sPoll.ok) {
          applySession(sPoll.data);
          const rs = sPoll.data.render_status;
          if (rs === "done" || rs === "cleaned") {
            show("Video ready — download below.", "success");
            return;
          }
          if (rs === "failed") {
            show(sPoll.data.render_error || "Render failed.", "error");
            return;
          }
        }
        const jr = await fetchBackgroundJob(os, jobId);
        if (jr.ok) {
          const st = (jr.data.status || "").toLowerCase();
          if (st === "failed") {
            show(jr.data.error_message || "Render failed.", "error");
            const s = await generationGetSession(cs, os, sId);
            if (s.ok) applySession(s.data);
            return;
          }
          if (st === "completed") {
            const s = await generationGetSession(cs, os, sId);
            if (s.ok) {
              applySession(s.data);
              show("Video ready — download below.", "success");
            }
            return;
          }
        }
        // Job GET can fail transiently; session row (above) is still updated by the worker.
      }
      const sFinal = await generationGetSession(cs, os, sId);
      if (sFinal.ok) {
        applySession(sFinal.data);
        const rs = sFinal.data.render_status;
        if (rs === "done" || rs === "cleaned") {
          show("Video ready — download below.", "success");
          return;
        }
        if (rs === "failed") {
          show(sFinal.data.render_error || "Render failed.", "error");
          return;
        }
      }
      show(
        "No update after several minutes. Try “Check status” or reload the page. If it’s still stuck, contact support.",
        "default",
      );
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

  const onPatchVideoTemplate = useCallback(
    async (templateId: VideoSpec["templateId"]) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!session || !cs || !os) return;
      // Snapshot the previous spec so the user can revert template + any
      // theme-derived overrides the server applies in a single Cmd+Z.
      const prevSpec = parseVideoSpec(session.video_spec ?? null);
      if (prevSpec) undoStack.push({ label: `Template → ${templateId}`, value: prevSpec });
      // Optimistic flip — UI shows the new active state immediately.
      setPendingTemplate(templateId);
      setSpecInFlight((n) => n + 1);
      const reqId = ++specReqIdRef.current;
      try {
        const res = await patchSessionVideoSpec(cs, os, session.id, {
          ops: [{ op: "replace", path: "/templateId", value: templateId }],
        });
        // Stale-response guard: only the latest request gets to update state.
        if (reqId !== specReqIdRef.current) return;
        if (!res.ok) {
          show(res.error, "error");
          setPendingTemplate(null);
          return;
        }
        applySession(res.data);
        setPendingTemplate(null);
      } finally {
        setSpecInFlight((n) => Math.max(0, n - 1));
      }
    },
    [applySession, clientSlug, orgSlug, session, show, undoStack],
  );

  const onPatchVideoTheme = useCallback(
    async (themeId: VideoSpec["themeId"]) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!session || !cs || !os) return;
      // Snapshot before clearing appearance overrides — theme switch is
      // destructive (all per-block appearance values reset to inherit).
      const prevSpec = parseVideoSpec(session.video_spec ?? null);
      if (prevSpec) undoStack.push({ label: `Theme → ${themeId}`, value: prevSpec });
      setPendingTheme(themeId);
      setSpecInFlight((n) => n + 1);
      const reqId = ++specReqIdRef.current;
      try {
        const clearAppearanceOps = appearanceOpsToPatchOps(APPEARANCE_CLEAR_OPS);
        const res = await patchSessionVideoSpec(cs, os, session.id, {
          ops: [{ op: "replace", path: "/themeId", value: themeId }, ...clearAppearanceOps],
        });
        if (reqId !== specReqIdRef.current) return;
        if (!res.ok) {
          show(res.error, "error");
          setPendingTheme(null);
          return;
        }
        applySession(res.data);
        styleTouchedRef.current = false;
        setPendingTheme(null);
      } finally {
        setSpecInFlight((n) => Math.max(0, n - 1));
      }
    },
    [applySession, clientSlug, orgSlug, session, show, undoStack],
  );

  /** Persist a single layout knob. Drag-while-dragging updates `layoutDraft` only
   *  (instant preview); release calls this to commit. We send a single JSON Patch
   *  per knob so concurrent edits to other knobs / the spec don't collide. */
  const onCommitLayout = useCallback(
    async <K extends keyof VideoSpecLayout>(key: K, value: VideoSpecLayout[K]) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!session || !cs || !os) return;
      // No-op if user released without actually changing the value.
      if (sessionLayout[key] === value) return;
      setSpecInFlight((n) => n + 1);
      const reqId = ++specReqIdRef.current;
      try {
        const res = await patchSessionVideoSpec(cs, os, session.id, {
          ops: [{ op: "replace", path: `/layout/${key}`, value }],
        });
        if (reqId !== specReqIdRef.current) return;
        if (!res.ok) {
          show(res.error, "error");
          // Roll the slider back to whatever the server still has.
          setLayoutDraft(sessionLayout);
          return;
        }
        applySession(res.data);
      } finally {
        setSpecInFlight((n) => Math.max(0, n - 1));
      }
    },
    [applySession, clientSlug, orgSlug, session, sessionLayout, show],
  );

  const onCommitVideoSpecOps = useCallback(
    async (ops: Operation[]) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!session || !cs || !os || ops.length === 0) return;
      for (const op of ops) {
        if (op.op !== "replace") continue;
        const p = op.path;
        const v = (op as { value?: unknown }).value;
        if (p === "/templateId" && typeof v === "string") {
          setPendingTemplate(v as VideoSpec["templateId"]);
        }
        if (p === "/layout/verticalAnchor" && (v === "top" || v === "center" || v === "bottom")) {
          setLayoutDraft((s) => ({ ...s, verticalAnchor: v }));
        }
      }
      setSpecInFlight((n) => n + 1);
      const reqId = ++specReqIdRef.current;
      try {
        const res = await patchSessionVideoSpec(cs, os, session.id, { ops });
        if (reqId !== specReqIdRef.current) return;
        if (!res.ok) {
          show(res.error, "error");
          setLayoutDraft(sessionLayout);
          setPendingTemplate(null);
          return;
        }
        applySession(res.data);
        setPendingTemplate(null);
      } finally {
        setSpecInFlight((n) => Math.max(0, n - 1));
      }
    },
    [applySession, clientSlug, orgSlug, session, sessionLayout, show],
  );

  const onSetUiFormat = useCallback(
    async (f: UiFormat) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!session || !cs || !os || !previewVideoSpec) return;
      const cur = previewVideoSpec.templateId;
      const ops: Operation[] = [];
      if (f === "center") ops.push({ op: "replace", path: "/templateId", value: "centered-pop" });
      else if (f === "stack") {
        ops.push({ op: "replace", path: "/templateId", value: "stacked-cards" });
        // NOTE: layout/stackGrowth is intentionally not written here — the
        // stacked-cards template renders cards top→down regardless, so writing
        // it created a phantom "Adjusted" badge that no preview reflected.
        if (cur === "top-banner") ops.push({ op: "replace", path: "/layout/verticalAnchor", value: "top" });
        if (cur === "centered-pop") {
          ops.push({ op: "replace", path: "/layout/verticalAnchor", value: "bottom" });
        }
      } else if (f === "card") {
        ops.push({ op: "replace", path: "/templateId", value: "bottom-card" });
        if (cur === "top-banner") ops.push({ op: "replace", path: "/layout/verticalAnchor", value: "top" });
        else if (cur === "centered-pop") {
          ops.push({ op: "replace", path: "/layout/verticalAnchor", value: "bottom" });
        }
      }
      await onCommitVideoSpecOps(ops);
    },
    [onCommitVideoSpecOps, clientSlug, orgSlug, previewVideoSpec, session],
  );

  const onSetOutlineLayout = useCallback(
    async (outline: boolean) => {
      if (!session || !previewVideoSpec) return;
      if (selectedSegmentId === "hook") {
        await onCommitVideoSpecOps([
          { op: "replace", path: "/textTreatment", value: outline ? "bold-outline" : null },
        ]);
        return;
      }
      const idx = previewVideoSpec.blocks.findIndex((b) => b.id === selectedSegmentId);
      if (idx < 0) return;
      await onCommitVideoSpecOps([
        { op: "replace", path: `/blocks/${idx}/textTreatment`, value: outline ? "bold-outline" : null },
      ]);
    },
    [onCommitVideoSpecOps, previewVideoSpec, selectedSegmentId, session],
  );

  const onSetUiPin = useCallback(
    async (pin: VideoSpecLayout["verticalAnchor"]) => {
      if (!session || !previewVideoSpec) return;
      const tpl = pendingTemplate ?? previewVideoSpec.templateId;
      if (tpl !== "bottom-card" && tpl !== "stacked-cards" && tpl !== "top-banner") return;
      const ops: Operation[] =
        tpl === "top-banner"
          ? [
              { op: "replace", path: "/templateId", value: "bottom-card" },
              { op: "replace", path: "/layout/verticalAnchor", value: pin },
            ]
          : [{ op: "replace", path: "/layout/verticalAnchor", value: pin }];
      await onCommitVideoSpecOps(ops);
    },
    [onCommitVideoSpecOps, pendingTemplate, previewVideoSpec, session],
  );

  const onCommitAppearanceOps = useCallback(
    async (ops: AppearanceOp[]) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!session || !cs || !os || ops.length === 0 || !previewVideoSpec) return;
      const blockIdx =
        selectedSegmentId !== "hook"
          ? previewVideoSpec.blocks.findIndex((b) => b.id === selectedSegmentId)
          : -1;
      const baseAppearance: VideoSpecAppearance =
        selectedSegmentId === "hook"
          ? sessionAppearance
          : (blockIdx >= 0 ? (previewVideoSpec.blocks[blockIdx]?.appearance ?? {}) : {});
      const appearancePathPrefix =
        blockIdx >= 0 ? (`/blocks/${blockIdx}/appearance` as const) : ("/appearance" as const);
      const meaningful = ops.filter(({ key, value }) => {
        const valN = value === "" || value === undefined ? null : value;
        const curRaw = baseAppearance[key] as string | undefined | null;
        const curN = curRaw === "" || curRaw === undefined || curRaw === null ? null : String(curRaw);
        return curN !== valN;
      });
      if (meaningful.length === 0) return;
      if (selectedSegmentId === "hook") {
        setAppearanceDraft((d) => mergeAppearanceOpsIntoDraft(d, meaningful));
      } else {
        setBlockAppearanceDraft((d) => mergeAppearanceOpsIntoDraft(d, meaningful));
      }
      styleTouchedRef.current = true;
      setSpecInFlight((n) => n + 1);
      const reqId = ++specReqIdRef.current;
      try {
        const res = await patchSessionVideoSpec(cs, os, session.id, {
          ops: appearanceOpsToPatchOps(meaningful, appearancePathPrefix),
        });
        if (reqId !== specReqIdRef.current) return;
        if (!res.ok) {
          show(res.error, "error");
          if (selectedSegmentId === "hook") {
            setAppearanceDraft(sessionAppearance);
          } else if (blockIdx >= 0) {
            setBlockAppearanceDraft({ ...(previewVideoSpec.blocks[blockIdx]?.appearance ?? {}) });
          }
          return;
        }
        applySession(res.data);
      } finally {
        setSpecInFlight((n) => Math.max(0, n - 1));
      }
    },
    [
      applySession,
      clientSlug,
      orgSlug,
      session,
      sessionAppearance,
      previewVideoSpec,
      selectedSegmentId,
      show,
    ],
  );

  const savedBeatFontScale = useMemo(() => {
    if (!previewVideoSpec) return 1;
    if (selectedSegmentId === "hook") {
      const v = previewVideoSpec.hook.fontScale;
      return v != null && Number.isFinite(Number(v)) ? Number(v) : 1;
    }
    const block = previewVideoSpec.blocks.find((b) => b.id === selectedSegmentId);
    const v = block?.fontScale;
    return v != null && Number.isFinite(Number(v)) ? Number(v) : 1;
  }, [previewVideoSpec, selectedSegmentId]);

  const displayBeatFontScale =
    fontScaleDraft?.segmentId === selectedSegmentId ? fontScaleDraft.scale : savedBeatFontScale;

  const onChangeFontScale = useCallback(
    (scale: number) => {
      setFontScaleDraft({ segmentId: selectedSegmentId, scale });
    },
    [selectedSegmentId],
  );

  const onCommitFontScale = useCallback(
    async (scale: number) => {
      if (!previewVideoSpec || !session) return;
      if (Math.abs(savedBeatFontScale - scale) < 0.02) {
        setFontScaleDraft(null);
        return;
      }
      const blockIdx =
        selectedSegmentId !== "hook"
          ? previewVideoSpec.blocks.findIndex((b) => b.id === selectedSegmentId)
          : -1;
      if (selectedSegmentId !== "hook" && blockIdx < 0) {
        setFontScaleDraft(null);
        return;
      }
      const path =
        selectedSegmentId === "hook" ? "/hook/fontScale" : (`/blocks/${blockIdx}/fontScale` as const);
      const value = Math.abs(scale - 1) < 0.02 ? null : scale;
      await onCommitVideoSpecOps([{ op: "replace", path, value }]);
      setFontScaleDraft(null);
    },
    [onCommitVideoSpecOps, previewVideoSpec, savedBeatFontScale, selectedSegmentId, session],
  );

  const onApplyFontScaleToAllBeats = useCallback(async () => {
    if (!previewVideoSpec || !session) return;
    const value = Math.abs(displayBeatFontScale - 1) < 0.02 ? null : displayBeatFontScale;
    const ops: Operation[] = [{ op: "replace", path: "/hook/fontScale", value }];
    previewVideoSpec.blocks.forEach((_, i) => {
      ops.push({ op: "replace", path: `/blocks/${i}/fontScale`, value });
    });
    await onCommitVideoSpecOps(ops);
    setFontScaleDraft(null);
  }, [displayBeatFontScale, onCommitVideoSpecOps, previewVideoSpec, session]);

  const onChangeBrollTrim = useCallback(
    (trimStartSec: number, trimEndSec: number) => {
      setBrollTrimDraft({ trimStartSec, trimEndSec });
    },
    [],
  );

  const onCommitBrollTrim = useCallback(
    async (trimStartSec: number, trimEndSec: number) => {
      if (!previewVideoSpec || !session) return;
      const bg = previewVideoSpec.background;
      const savedStart = Number(bg.trimStartSec ?? 0);
      const sourceDur = bg.durationSec != null ? Number(bg.durationSec) : null;
      const savedEnd = bg.trimEndSec != null ? Number(bg.trimEndSec) : sourceDur;
      if (
        sourceDur != null &&
        Math.abs(savedStart - trimStartSec) < 0.05 &&
        savedEnd != null &&
        Math.abs(savedEnd - trimEndSec) < 0.05
      ) {
        setBrollTrimDraft(null);
        return;
      }
      await onCommitVideoSpecOps([
        { op: "replace", path: "/background/trimStartSec", value: trimStartSec },
        { op: "replace", path: "/background/trimEndSec", value: trimEndSec },
      ]);
      setBrollTrimDraft(null);
    },
    [onCommitVideoSpecOps, previewVideoSpec, session],
  );

  const onClearAppearance = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!session || !cs || !os || !previewVideoSpec) return;
    const keys = ["fontId", "cardTextColor", "overlayTextColor", "cardBg", "overlayStroke"] as const;
    if (selectedSegmentId === "hook") {
      if (!appearanceHasSavedOverrides(sessionAppearance)) return;
      styleTouchedRef.current = false;
      setAppearanceDraft(DEFAULT_APPEARANCE);
      setSpecInFlight((n) => n + 1);
      const reqId = ++specReqIdRef.current;
      try {
        const res = await patchSessionVideoSpec(cs, os, session.id, {
          ops: keys.map((k) => ({ op: "replace" as const, path: `/appearance/${k}`, value: null })),
        });
        if (reqId !== specReqIdRef.current) return;
        if (!res.ok) {
          show(res.error, "error");
          setAppearanceDraft(sessionAppearance);
          return;
        }
        applySession(res.data);
      } finally {
        setSpecInFlight((n) => Math.max(0, n - 1));
      }
      return;
    }
    const idx = previewVideoSpec.blocks.findIndex((b) => b.id === selectedSegmentId);
    if (idx < 0) return;
    const row = previewVideoSpec.blocks[idx];
    if (!blockHasSavedStyleOverrides(row)) return;
    styleTouchedRef.current = false;
    setBlockAppearanceDraft({});
    setSpecInFlight((n) => n + 1);
    const reqId = ++specReqIdRef.current;
    try {
      const appearanceOps = keys.map((k) => ({
        op: "replace" as const,
        path: `/blocks/${idx}/appearance/${k}`,
        value: null,
      }));
      const treatmentOp = {
        op: "replace" as const,
        path: `/blocks/${idx}/textTreatment`,
        value: null,
      };
      const res = await patchSessionVideoSpec(cs, os, session.id, {
        ops: row.textTreatment != null ? [...appearanceOps, treatmentOp] : appearanceOps,
      });
      if (reqId !== specReqIdRef.current) return;
      if (!res.ok) {
        show(res.error, "error");
        setBlockAppearanceDraft({ ...(row.appearance ?? {}) });
        return;
      }
      applySession(res.data);
    } finally {
      setSpecInFlight((n) => Math.max(0, n - 1));
    }
  }, [applySession, clientSlug, orgSlug, session, sessionAppearance, previewVideoSpec, selectedSegmentId, show]);

  const onCommitPauseBeforeBeat = useCallback(
    async (pauseIdx: number, value: number) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      const specNow = previewVideoSpecRef.current;
      if (!session || !cs || !os || !specNow) {
        setPauseDraft(null);
        return;
      }
      const rounded = Math.round(value * 1000) / 1000;
      const cur = effectivePausesSec(specNow);
      if (pauseIdx < 0 || pauseIdx >= cur.length) {
        setPauseDraft(null);
        return;
      }
      if (Math.abs(cur[pauseIdx]! - rounded) < 1e-6) {
        setPauseDraft(null);
        return;
      }
      const ops = pauseGapToExplicitTimelinePatchOps(specNow, pauseIdx, rounded);
      if (ops.length === 0) {
        setPauseDraft(null);
        return;
      }
      setSpecInFlight((n) => n + 1);
      const reqId = ++specReqIdRef.current;
      try {
        const res = await patchSessionVideoSpec(cs, os, session.id, { ops });
        if (reqId !== specReqIdRef.current) return;
        if (!res.ok) {
          show(res.error, "error");
          return;
        }
        applySession(res.data);
      } finally {
        setSpecInFlight((n) => Math.max(0, n - 1));
        setPauseDraft(null);
      }
    },
    [applySession, clientSlug, orgSlug, session, show],
  );

  /** One-shot: shrink block durations so the timeline fits ``background.durationSec``. */
  const onFitBlocksToBroll = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!session || !cs || !os) return;
    setSpecInFlight((n) => n + 1);
    const reqId = ++specReqIdRef.current;
    try {
      const res = await postFitSessionSpecToBroll(cs, os, session.id);
      if (reqId !== specReqIdRef.current) return;
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      applySession(res.data);
      show("Beats fitted to B-roll length.", "success");
    } finally {
      setSpecInFlight((n) => Math.max(0, n - 1));
    }
  }, [applySession, clientSlug, orgSlug, session, show]);

  /** Reset the in-flight timing draft whenever the saved spec changes (server
   *  ack, fresh fetch). Same gate-by-string-key pattern as `layoutDraft`. */
  const timingSyncKey = `${session?.id ?? ""}|${previewVideoSpec?.totalSec ?? 0}|${previewVideoSpec?.gapBetweenBlocksSec ?? 0}|${previewVideoSpec?.pausesSec?.join(",") ?? ""}`;
  const fontScaleSyncKey = useMemo(() => {
    if (!previewVideoSpec) return "";
    const hookFs = previewVideoSpec.hook.fontScale ?? "";
    const blockFs = previewVideoSpec.blocks
      .map((b) => `${b.id}:${b.fontScale ?? ""}`)
      .join("|");
    return `${session?.id ?? ""}|${hookFs}|${blockFs}`;
  }, [previewVideoSpec, session?.id]);
  const brollTrimSyncKey = `${session?.id ?? ""}|${previewVideoSpec?.background.trimStartSec ?? 0}|${previewVideoSpec?.background.trimEndSec ?? ""}|${previewVideoSpec?.background.durationSec ?? ""}`;

  useEffect(() => {
    setTimingDraft(null);
    setPauseDraft(null);
    setLayerTimingDraft(null);
  }, [timingSyncKey]);

  useEffect(() => {
    setFontScaleDraft(null);
  }, [fontScaleSyncKey]);

  useEffect(() => {
    setBrollTrimDraft(null);
  }, [brollTrimSyncKey]);

  useEffect(() => {
    setPauseDraft(null);
    setLayerTimingDraft(null);
    setFontScaleDraft(null);
  }, [selectedSegmentId]);

  /** If the selected segment disappears (e.g. an AI refine deletes a block),
   *  fall back to the hook so the inspector never points to nothing. */
  useEffect(() => {
    if (!previewVideoSpec) return;
    if (selectedSegmentId === "hook") return;
    const exists = previewVideoSpec.blocks.some((b) => b.id === selectedSegmentId);
    if (!exists) setSelectedSegmentId("hook");
  }, [previewVideoSpec, selectedSegmentId]);

  /** Persist a duration edit: only the selected layer's window changes (hook
   *  length or block end); other beats keep their absolute positions. */
  const onCommitTiming = useCallback(
    async (segmentId: string, newDurationSec: number) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      const specNow = previewVideoSpecRef.current;
      if (!session || !cs || !os || !specNow) return;
      const timing = beatDurationToLayerTiming(specNow, segmentId, newDurationSec);
      const result = computeLayerTimingChange(specNow, segmentId, timing);
      // No-op if nothing changed (prevents an empty PATCH).
      if (result.ops.length === 0) {
        setTimingDraft(null);
        return;
      }
      setSpecInFlight((n) => n + 1);
      const reqId = ++specReqIdRef.current;
      try {
        const res = await patchSessionVideoSpec(cs, os, session.id, { ops: result.ops });
        if (reqId !== specReqIdRef.current) return;
        if (!res.ok) {
          show(res.error, "error");
          setTimingDraft(null);
          return;
        }
        applySession(res.data);
        setTimingDraft(null);
      } finally {
        setSpecInFlight((n) => Math.max(0, n - 1));
      }
    },
    [applySession, clientSlug, orgSlug, session, show],
  );

  const onCommitLayerTiming = useCallback(
    async (segmentId: string, timing: { startSec?: number; endSec?: number }) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      const specNow = previewVideoSpecRef.current;
      if (!session || !cs || !os || !specNow) return;
      const result = computeLayerTimingChange(specNow, segmentId, timing);
      if (result.ops.length === 0) {
        setLayerTimingDraft(null);
        return;
      }
      setSpecInFlight((n) => n + 1);
      const reqId = ++specReqIdRef.current;
      try {
        const res = await patchSessionVideoSpec(cs, os, session.id, { ops: result.ops });
        if (reqId !== specReqIdRef.current) return;
        if (!res.ok) {
          show(res.error, "error");
          setLayerTimingDraft(null);
          return;
        }
        applySession(res.data);
        setLayerTimingDraft(null);
      } finally {
        setSpecInFlight((n) => Math.max(0, n - 1));
      }
    },
    [applySession, clientSlug, orgSlug, session, show],
  );

  const onCommitLayerTimingRef = useRef<typeof onCommitLayerTiming | null>(null);
  const onResizeLayerTimingDraft = useCallback((id: string, timing: { startSec?: number; endSec?: number }) => {
    setSelectedSegmentId(id);
    setTimingDraft(null);
    setLayerTimingDraft({ id, timing });
  }, []);
  const onResizeLayerTimingCommit = useCallback((id: string, timing: { startSec?: number; endSec?: number }) => {
    void onCommitLayerTimingRef.current?.(id, timing);
  }, []);
  useEffect(() => {
    onCommitLayerTimingRef.current = onCommitLayerTiming;
  }, [onCommitLayerTiming]);

  const onChangeBrollTrimRaf = useMemo(
    () => createRafCoalescer(onChangeBrollTrim),
    [onChangeBrollTrim],
  );
  const onResizeLayerTimingDraftRaf = useMemo(
    () => createRafCoalescer(onResizeLayerTimingDraft),
    [onResizeLayerTimingDraft],
  );

  const previewClipTrim = useMemo((): VideoClipTrimProps | null => {
    if (!livePreviewSpec || livePreviewSpec.background.kind !== "video") return null;
    const bg = livePreviewSpec.background;
    const sourceDur = bg.durationSec != null ? Number(bg.durationSec) : null;
    if (sourceDur == null || !Number.isFinite(sourceDur)) return null;
    return {
      sourceDurationSec: sourceDur,
      trimStartSec: Number(bg.trimStartSec ?? 0),
      trimEndSec: bg.trimEndSec != null ? Number(bg.trimEndSec) : sourceDur,
      onChange: onChangeBrollTrimRaf,
      onCommit: onCommitBrollTrim,
    };
  }, [livePreviewSpec, onChangeBrollTrimRaf, onCommitBrollTrim]);

  const applyVideoSpecOps = useCallback(
    async (ops: Operation[], afterApply?: (s: GenerationSession) => void) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!session || !cs || !os || ops.length === 0) return;
      setSpecInFlight((n) => n + 1);
      const reqId = ++specReqIdRef.current;
      try {
        const res = await patchSessionVideoSpec(cs, os, session.id, { ops });
        if (reqId !== specReqIdRef.current) return;
        if (!res.ok) {
          show(res.error, "error");
          return;
        }
        applySession(res.data);
        afterApply?.(res.data);
      } finally {
        setSpecInFlight((n) => Math.max(0, n - 1));
      }
    },
    [applySession, clientSlug, orgSlug, session, show],
  );

  /**
   * Restore a previously captured spec snapshot via a root-replace JSON
   * Patch. Sends ``{ op: "replace", path: "", value: snapshot }`` which the
   * jsonpatch library treats as a full document swap (RFC 6902 §4.3). The
   * UI re-derives all drafts via ``applySession``.
   */
  const restoreSpecSnapshot = useCallback(
    async (spec: VideoSpec) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!session || !cs || !os) return;
      undoApplyingRef.current = true;
      setSpecInFlight((n) => n + 1);
      const reqId = ++specReqIdRef.current;
      try {
        const res = await patchSessionVideoSpec(cs, os, session.id, {
          ops: [{ op: "replace", path: "", value: spec as unknown as Record<string, unknown> }],
        });
        if (reqId !== specReqIdRef.current) return;
        if (!res.ok) {
          show(res.error, "error");
          return;
        }
        applySession(res.data);
      } finally {
        setSpecInFlight((n) => Math.max(0, n - 1));
        undoApplyingRef.current = false;
      }
    },
    [applySession, clientSlug, orgSlug, session, show],
  );

  const onUndo = useCallback(() => {
    const snap = undoStack.undo();
    if (!snap) return;
    void restoreSpecSnapshot(snap.value);
  }, [restoreSpecSnapshot, undoStack]);

  const onRedo = useCallback(() => {
    const snap = undoStack.redo();
    if (!snap) return;
    void restoreSpecSnapshot(snap.value);
  }, [restoreSpecSnapshot, undoStack]);

  useUndoKeybindings({ onUndo, onRedo });

  /** Commit the Step 1 hook input to video_spec.hook.text. Triggered on blur
   *  / Enter. Empty input resets to the saved value rather than persisting an
   *  empty hook (which would break the render). */
  const onCommitHookText = useCallback(async () => {
    const trimmed = hookDraft.trim();
    if (!trimmed) {
      setHookDraft(primaryHookText ?? "");
      return;
    }
    if (trimmed === (primaryHookText ?? "")) return;
    if (!previewVideoSpec) return;
    await applyVideoSpecOps([{ op: "replace", path: "/hook/text", value: trimmed }]);
  }, [applyVideoSpecOps, hookDraft, previewVideoSpec, primaryHookText]);

  const onAddTextLayer = useCallback(async () => {
    if (!previewVideoSpec) return;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `layer-${crypto.randomUUID()}`
        : `layer-${Date.now().toString(36)}`;
    const result = createTextLayer(previewVideoSpec, {
      afterLayerId: selectedSegmentId,
      text: "New text",
      id,
    });
    await applyVideoSpecOps(result.ops, () => setSelectedSegmentId(id));
  }, [applyVideoSpecOps, previewVideoSpec, selectedSegmentId]);

  const onDeleteSelectedLayer = useCallback(async () => {
    if (!previewVideoSpec || selectedSegmentId === "hook") return;
    const result = deleteTextLayer(previewVideoSpec, selectedSegmentId);
    await applyVideoSpecOps(result.ops, () => setSelectedSegmentId("hook"));
  }, [applyVideoSpecOps, previewVideoSpec, selectedSegmentId]);

  /** Step 1 trash must remove the matching ``video_spec`` layer so the preview updates
   *  immediately and surviving beats keep their on-screen duration. */
  const onRemoveTextBlock = useCallback(
    async (index: number) => {
      if (!previewVideoSpec) {
        setTextDraft((prev) => prev.filter((_, j) => j !== index));
        return;
      }
      const blockId = previewVideoSpec.blocks[index]?.id;
      if (blockId) {
        const result = deleteTextLayer(previewVideoSpec, blockId);
        if (result.ops.length > 0) {
          await applyVideoSpecOps(result.ops, () => setSelectedSegmentId("hook"));
        }
        return;
      }
      setTextDraft((prev) => prev.filter((_, j) => j !== index));
    },
    [applyVideoSpecOps, previewVideoSpec],
  );

  const onSaveSelectedLayer = useCallback(async () => {
    if (!previewVideoSpec || !selectedLayer) return;
    const text = layerTextDraft.trim();
    if (!text) {
      show("Layer text cannot be empty.", "error");
      return;
    }
    if (selectedLayer.id === "hook") {
      await applyVideoSpecOps([{ op: "replace", path: "/hook/text", value: text }]);
      return;
    }
    const result = editTextLayer(previewVideoSpec, selectedLayer.id, {
      text,
      isCTA: layerCtaDraft,
    });
    await applyVideoSpecOps(result.ops);
  }, [applyVideoSpecOps, layerCtaDraft, layerTextDraft, previewVideoSpec, selectedLayer, show]);

  // NOTE: the Timing tab "Layer text" field is now read-only (Step 1 is the
  // single source for hook + block text), so the previous debounced autosave
  // effect on `layerTextDraft` / `layerCtaDraft` has been removed. CTA toggles
  // happen in Step 1; timing changes go through `onCommitLayerTiming`.

  /**
   * Apply a free-text AI refine prompt to the live video spec.
   *
   * Phase D: this is the shared implementation behind the ⌘K palette and
   * any inspector button that wants to invoke AI refine. Takes the
   * instruction explicitly so callers control where the text comes from
   * (palette prompt, future inline input, programmatic action, etc).
   */
  const runVideoRefine = useCallback(
    async (instructionRaw: string) => {
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      const instruction = instructionRaw.trim();
      if (!session || !cs || !os || !instruction) return;
      setAiRefineBusy(true);
      setAiRefinePhase("thinking");
      setSpecInFlight((n) => n + 1);
      const reqId = ++specReqIdRef.current;
      try {
        const pe = await promptEditSessionVideoSpec(cs, os, session.id, { instruction });
        if (reqId !== specReqIdRef.current) return;
        if (!pe.ok) {
          show(pe.error, "error");
          return;
        }
        if (!Array.isArray(pe.data.ops) || pe.data.ops.length === 0) {
          show("AI couldn't translate that into a change — try being more specific.", "error");
          return;
        }
        setAiRefinePhase("applying");
        const prevSpec = parseVideoSpec(session.video_spec ?? null);
        if (prevSpec) {
          undoStack.push({
            label: `AI refine: ${instruction.slice(0, 28)}${instruction.length > 28 ? "…" : ""}`,
            value: prevSpec,
          });
        }
        const res = await patchSessionVideoSpec(cs, os, session.id, { ops: pe.data.ops });
        if (reqId !== specReqIdRef.current) return;
        if (!res.ok) {
          show(res.error, "error");
          return;
        }
        applySession(res.data);
        show(pe.data.summary || `Updated (${pe.data.ops.length} change${pe.data.ops.length === 1 ? "" : "s"}).`, "success");
      } catch (e) {
        show(e instanceof Error ? e.message : "AI refine failed unexpectedly.", "error");
      } finally {
        setAiRefineBusy(false);
        setAiRefinePhase("idle");
        setSpecInFlight((n) => Math.max(0, n - 1));
      }
    },
    [applySession, clientSlug, orgSlug, session, show, undoStack],
  );

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
      const res = await generationGenerateThumbnail(cs, os, session.id, text, coverPayload(coverEdit));
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      setThumbnailUrl(res.data.thumbnail_url);
    } finally {
      setThumbnailBusy(false);
    }
  }, [clientSlug, orgSlug, session, coverText, coverEdit, show]);

  const onComposeCoverFromImage = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!session || !cs || !os || !coverImageId) return;
    const text = coverText.trim() || undefined;
    setThumbnailBusy(true);
    try {
      const res = await generationComposeThumbnail(cs, os, session.id, coverImageId, text, coverPayload(coverEdit));
      if (!res.ok) {
        show(res.error, "error");
        return;
      }
      setThumbnailUrl(res.data.thumbnail_url);
      show("Cover composed.", "success");
    } finally {
      setThumbnailBusy(false);
    }
  }, [clientSlug, orgSlug, session, coverImageId, coverText, coverEdit, show]);

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
      const generated = res.data.carousel_slides ?? [];
      for (const sl of generated) bumpCarouselBgCacheRev(sl.idx);
      applySession(res.data);
      show("Slides generated.", "success");
    } finally {
      setCarouselGenBusy(false);
    }
  }, [applySession, bumpCarouselBgCacheRev, carouselCount, clientSlug, orgSlug, session, show]);

  const onPatchCarouselTemplate = useCallback(
    async (templateId: string, options?: { clearSlides?: boolean }) => {
      const tpl = carouselTemplateLibrary.find((t) => t.id === templateId);
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!tpl || !session || !cs || !os) return;
      const clearSlides = Boolean(options?.clearSlides);
      if (carouselSlidesLocked && !clearSlides) return;
      setCarouselTemplateBusy(true);
      try {
        const res = await generationPatchSession(cs, os, session.id, {
          selected_carousel_template: tpl,
          ...(clearSlides ? { clear_carousel_slides: true } : {}),
        });
        if (!res.ok) {
          show(res.error, "error");
          return;
        }
        applySession(res.data);
        if (clearSlides) {
          setCarouselStyleSwitchOpen(false);
          setCarouselStyleSwitchDraftId(null);
        }
        show(
          clearSlides
            ? "Template updated — slides cleared. Adjust count if needed, then Generate slides."
            : "Carousel template updated.",
          "success",
        );
      } finally {
        setCarouselTemplateBusy(false);
      }
    },
    [
      applySession,
      carouselSlidesLocked,
      carouselTemplateLibrary,
      clientSlug,
      orgSlug,
      session,
      show,
    ],
  );

  const onCarouselTextBoxAdjust = useCallback((idx: number, text_box: CarouselTextBox) => {
    const current = carouselDraftRef.current;
    const next = current.map((s) => (s.idx === idx ? { ...s, text_box } : s));
    carouselDraftRef.current = next;
    setCarouselDraft(next);
    carouselDraftDirty.current = true;
  }, []);

  const onCarouselBackgroundStyleAdjust = useCallback(
    (idx: number, background_style: CarouselBackgroundStyle) => {
      const current = carouselDraftRef.current;
      const next = current.map((s) => (s.idx === idx ? { ...s, background_style } : s));
      carouselDraftRef.current = next;
      setCarouselDraft(next);
      carouselDraftDirty.current = true;
    },
    [],
  );

  const commitCarouselDraft = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!session || !cs || !os) return false;
    setCarouselInFlight((n) => n + 1);
    try {
      const res = await carouselSlidesPatch(cs, os, session.id, carouselDraftRef.current);
      if (!res.ok) {
        show(res.error, "error");
        return false;
      }
      carouselDraftDirty.current = false;
      applySession(res.data);
      return true;
    } finally {
      setCarouselInFlight((n) => Math.max(0, n - 1));
    }
  }, [applySession, clientSlug, orgSlug, session, show]);

  const onApplyCarouselTextStyleToAll = useCallback(
    async (sourceIdx: number) => {
      const source = carouselDraftRef.current.find((s) => s.idx === sourceIdx);
      if (!source) return;
      const sourceTb = mergeCarouselTextBox(source, carouselDraftRef.current.length);
      const next = carouselDraftRef.current.map((s) => {
        const tb = mergeCarouselTextBox(s, carouselDraftRef.current.length);
        return {
          ...s,
          text_box: {
            ...tb,
            align: sourceTb.align,
            scale: sourceTb.scale,
            card: sourceTb.card,
            font: sourceTb.font,
          },
        };
      });
      carouselDraftRef.current = next;
      setCarouselDraft(next);
      carouselDraftDirty.current = true;
      if (await commitCarouselDraft()) show("Text style applied to all slides.", "success");
    },
    [commitCarouselDraft, show],
  );

  const onApplyCarouselBackgroundToAll = useCallback(
    async (sourceIdx: number) => {
      const source = carouselDraftRef.current.find((s) => s.idx === sourceIdx);
      if (!source) return;
      const background_style = mergeCarouselBackgroundStyle(source);
      const next = carouselDraftRef.current.map((s) => ({ ...s, background_style }));
      carouselDraftRef.current = next;
      setCarouselDraft(next);
      carouselDraftDirty.current = true;
      if (await commitCarouselDraft()) show("Background fade applied to all slides.", "success");
    },
    [commitCarouselDraft, show],
  );

  const patchCarouselDraftBroadcastTextBox = useCallback(
    <K extends keyof CarouselTextBox>(field: K, value: CarouselTextBox[K]) => {
      const next = carouselDraftRef.current.map((s) => {
        const tb = mergeCarouselTextBox(s, carouselDraftRef.current.length);
        return { ...s, text_box: { ...tb, [field]: value } };
      });
      carouselDraftRef.current = next;
      setCarouselDraft(next);
      carouselDraftDirty.current = true;
    },
    [],
  );

  const patchCarouselDraftBroadcastBackground = useCallback(
    <K extends keyof CarouselBackgroundStyle>(field: K, value: CarouselBackgroundStyle[K]) => {
      const next = carouselDraftRef.current.map((s) => {
        const bg = mergeCarouselBackgroundStyle(s);
        return { ...s, background_style: { ...bg, [field]: value } };
      });
      carouselDraftRef.current = next;
      setCarouselDraft(next);
      carouselDraftDirty.current = true;
    },
    [],
  );

  const onBroadcastCarouselTextBoxField = useCallback(
    async <K extends keyof CarouselTextBox>(field: K, value: CarouselTextBox[K]) => {
      patchCarouselDraftBroadcastTextBox(field, value);
      await commitCarouselDraft();
    },
    [commitCarouselDraft, patchCarouselDraftBroadcastTextBox],
  );

  const onBroadcastCarouselBackgroundField = useCallback(
    async <K extends keyof CarouselBackgroundStyle>(field: K, value: CarouselBackgroundStyle[K]) => {
      patchCarouselDraftBroadcastBackground(field, value);
      await commitCarouselDraft();
    },
    [commitCarouselDraft, patchCarouselDraftBroadcastBackground],
  );

  const onBroadcastCarouselTextBoxDraft = useCallback(
    <K extends keyof CarouselTextBox>(field: K, value: CarouselTextBox[K]) => {
      patchCarouselDraftBroadcastTextBox(field, value);
    },
    [patchCarouselDraftBroadcastTextBox],
  );

  const onBroadcastCarouselBackgroundDraft = useCallback(
    <K extends keyof CarouselBackgroundStyle>(field: K, value: CarouselBackgroundStyle[K]) => {
      patchCarouselDraftBroadcastBackground(field, value);
    },
    [patchCarouselDraftBroadcastBackground],
  );

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

      if (source === "client_image" && clientImageId) {
        const picked = images.find((img) => img.id === clientImageId);
        if (picked?.file_url) {
          const optimistic = carouselDraftRef.current.map((s) =>
            s.idx === idx
              ? {
                  ...s,
                  base_image_url: picked.file_url,
                  image_url: picked.file_url,
                }
              : s,
          );
          carouselDraftRef.current = optimistic;
          setCarouselDraft(optimistic);
          bumpCarouselBgCacheRev(idx);
        }
      }

      setCarouselRegeneratingIdx(idx);
      setCarouselSlideBusy(true);
      try {
        const slideRow = carouselDraftRef.current.find((s) => s.idx === idx);
        const nSlides = carouselDraftRef.current.length;
        const res = await carouselSlideRegenerate(cs, os, session.id, {
          idx,
          text,
          image_source: source,
          client_image_id: clientImageId,
          layout: null,
          text_box: slideRow ? mergeCarouselTextBox(slideRow, nSlides) : null,
        });
        if (!res.ok) {
          show(res.error, "error");
          return;
        }
        carouselDraftDirty.current = false;
        bumpCarouselBgCacheRev(idx);
        applySession(res.data);
        show(`Slide ${idx + 1} updated.`, "success");
      } finally {
        setCarouselSlideBusy(false);
        setCarouselRegeneratingIdx(null);
      }
    },
    [applySession, bumpCarouselBgCacheRev, clientSlug, images, orgSlug, session, show],
  );

  const onRemoveCarouselSlide = useCallback(
    async (idx: number) => {
      const current = carouselDraftRef.current;
      if (current.length <= CAROUSEL_MIN_SLIDES) {
        show(`Carousel needs at least ${CAROUSEL_MIN_SLIDES} slides.`, "error");
        return;
      }
      const filtered = current.filter((s) => s.idx !== idx);
      const sortedBefore = [...filtered].sort((a, b) => a.idx - b.idx);
      const next = reindexCarouselSlides(filtered);
      carouselDraftRef.current = next;
      setCarouselDraft(next);
      setCarouselCount(next.length);
      carouselDraftDirty.current = true;
      setCarouselBgCacheRev((prev) => {
        const out: Record<number, number> = {};
        sortedBefore.forEach((s, newIdx) => {
          out[newIdx] = prev[s.idx] ?? 0;
        });
        return out;
      });
      if (await commitCarouselDraft()) {
        show(`Slide removed — ${next.length} slides left.`, "success");
      }
    },
    [commitCarouselDraft, show],
  );

  const onConvertCarouselToEditable = useCallback(async () => {
    const cs = clientSlug.trim();
    const os = orgSlug.trim();
    if (!session || !cs || !os) return;

    const current = carouselDraftRef.current;
    const flatSlides = current.filter((s) => !(s.base_image_url || "").trim());
    if (flatSlides.length === 0) return;

    setCarouselConvertBusy(true);
    setCarouselSlideBusy(true);
    try {
      let latestSession: GenerationSession | null = null;
      for (const slide of flatSlides) {
        const res = await carouselSlideRegenerate(cs, os, session.id, {
          idx: slide.idx,
          text: slide.text,
          image_source: "ai",
          layout: null,
          text_box: mergeCarouselTextBox(slide, current.length),
        });
        if (!res.ok) {
          show(res.error, "error");
          return;
        }
        latestSession = res.data;
      }
      if (latestSession) {
        carouselDraftDirty.current = false;
        for (const slide of flatSlides) bumpCarouselBgCacheRev(slide.idx);
        applySession(latestSession);
        show("Carousel is editable now.", "success");
      }
    } finally {
      setCarouselSlideBusy(false);
      setCarouselConvertBusy(false);
    }
  }, [applySession, bumpCarouselBgCacheRev, clientSlug, orgSlug, session, show]);

  const onCarouselLayoutCommit = useCallback(async () => {
    await commitCarouselDraft();
  }, [commitCarouselDraft]);

  const onCarouselTextEdit = useCallback(
    (idx: number, text: string) => {
      const next = carouselDraftRef.current.map((s) => (s.idx === idx ? { ...s, text } : s));
      carouselDraftRef.current = next;
      setCarouselDraft(next);
      carouselDraftDirty.current = true;
      const cs = clientSlug.trim();
      const os = orgSlug.trim();
      if (!session || !cs || !os) return;
      if (carouselSaveTimer.current) clearTimeout(carouselSaveTimer.current);
      carouselSaveTimer.current = setTimeout(() => {
        void (async () => {
          // Snapshot current draft after the debounce window so we always send the latest text.
          const latest = carouselDraftRef.current;
          setCarouselInFlight((n) => n + 1);
          try {
            const res = await carouselSlidesPatch(cs, os, session.id, latest);
            if (!res.ok) {
              show(res.error, "error");
              return;
            }
            carouselDraftDirty.current = false;
            applySession(res.data);
          } finally {
            setCarouselInFlight((n) => Math.max(0, n - 1));
          }
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

  // Video editor action registry (Phase D). Same registry feeds both the
  // ⌘K command palette and the visible inspector buttons (Improve / Vary /
  // Shorten / Outline / …). No sparkles — plain text labels.
  //
  // Keep this hook ABOVE all conditional returns. Placing it below the
  // talking_head/carousel branches changes hook order between formats and
  // crashes React.
  const videoActions = useMemo(
    () =>
      buildVideoActions({
        selectedSegmentId,
        aiRefineBusy,
        regenBusyScope,
        spec: previewVideoSpec,
        regen: (scope, feedback) => onRegenSection(scope, feedback),
        applyRefinePrompt: runVideoRefine,
        setBoldOutline: async (on) => {
          await onSetOutlineLayout(on);
        },
      }),
    [
      aiRefineBusy,
      onRegenSection,
      onSetOutlineLayout,
      previewVideoSpec,
      regenBusyScope,
      runVideoRefine,
      selectedSegmentId,
    ],
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

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // FORMAT DISPATCH
  //
  // After bootstrap, the workspace dispatches to the right per-format editor:
  //
  //   talking_head            → <TalkingHeadEditor>   (./editors/talking-head/)
  //   carousel                → <CarouselEditor>      (./editors/carousel/)
  //   text_overlay/b_roll_reel → inline JSX below     (./editors/video/VideoEditor.tsx
  //                                                     is the planned home; the Studio
  //                                                     shell migration in Phase C will
  //                                                     replace the inline JSX entirely)
  //
  // The workspace still owns autosave/session lifecycle for all formats — extracted
  // editors take callbacks; the inline path uses them directly. See
  // `editors/README.md` for the full split status and rationale.
  // ────────────────────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────── talking_head minimal flow ───────────────────────────────
  if (isTalkingHead) {
    return (
      <TalkingHeadEditor
        scriptDraft={scriptDraft}
        setScriptDraft={setScriptDraft}
        contentInFlight={contentInFlight}
        regenBusyScope={regenBusyScope}
        onRegenSection={onRegenSection}
        copyText={copyText}
        hooks={hooks}
        coverOptions={coverOptions}
        coverRegenBusy={coverRegenBusy}
        onRegenerateCovers={onRegenerateCovers}
        images={images}
        thumbnailUrl={thumbnailUrl}
        thumbnailBusy={thumbnailBusy}
        coverText={coverText}
        coverImageId={coverImageId}
        selectedCoverTemplate={session.selected_cover_template ?? null}
        coverEdit={coverEdit}
        coverSpecInFlight={coverSpecInFlight}
        coverMode={coverMode}
        onCoverModeChange={setCoverMode}
        onCoverTextChange={setCoverText}
        onCoverEditChange={setCoverEdit}
        onSelectCoverImage={setCoverImageId}
        onGenerateThumbnail={onGenerateThumbnail}
        onComposeCoverFromImage={onComposeCoverFromImage}
        captionBody={session.caption_body ?? ""}
        hashtags={session.hashtags ?? []}
        captionFull={captionFull}
      />
    );
  }

  // ─────────────────────────────── carousel flow (PNG slides → ZIP) ───────────────────────────────
  if (isCarousel) {
    const snap = session.selected_carousel_template;
    const snapId = snap && typeof snap === "object" && typeof snap.id === "string" ? snap.id : "";
    const snapInLibrary =
      snapId !== "" && carouselTemplateLibrary.some((t) => t.id === snapId);
    const selectedTemplateSelectValue = snapInLibrary ? snapId : "";
    const snapSummary = carouselTemplateSummary(snap);
    const snapDescription =
      typeof snap?.description === "string" && snap.description.trim()
        ? snap.description.trim()
        : "";
    const snapSlides = snap?.slides?.length
      ? [...snap.slides].sort((a, b) => a.idx - b.idx)
      : [];

    return (
      <div className="space-y-4">
        <div className="glass rounded-2xl border border-app-divider/80 p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-app-fg-muted">
                Carousel template
                <HelpHint label="Carousel template">
                  Background style and slide order. Pick from your saved templates in Settings → Content defaults.
                </HelpHint>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-app-fg-muted">
                Background references from Media. Change anytime before slides exist; after that, use{" "}
                <span className="font-semibold text-app-fg-secondary">Switch template</span> (clears slides so new
                backgrounds apply).
              </p>
            </div>
            <Link
              href="/settings#content-defaults"
              className="shrink-0 text-[11px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
            >
              Edit templates →
            </Link>
          </div>
          {snap && typeof snap === "object" && typeof snap.name === "string" && snap.name.trim() ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm font-semibold text-app-fg">{snap.name.trim()}</p>
              {snapSummary ? (
                <p className="text-xs font-medium text-app-fg-muted">{snapSummary}</p>
              ) : null}
              {snapDescription ? (
                <p className="text-[11px] leading-relaxed text-app-fg-subtle">
                  {snapDescription}
                </p>
              ) : null}
              {snapSlides.some((slide) => slide.reference_image_url) ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {snapSlides.map((slide) => (
                    <div
                      key={`${slide.idx}-${slide.reference_image_id ?? slide.reference_image_url ?? "slide"}`}
                      className="w-20 shrink-0 overflow-hidden rounded-lg border border-app-divider/70 bg-surface-container/70"
                    >
                      {slide.reference_image_url ? (
                        <div
                          role="img"
                          aria-label={`Slide ${slide.idx + 1} ${CAROUSEL_ROLE_LABELS[slide.role] ?? slide.role}`}
                          className="h-24 w-full bg-cover bg-center"
                          style={{ backgroundImage: `url(${slide.reference_image_url})` }}
                        />
                      ) : (
                        <div className="h-24 w-full bg-app-soft" />
                      )}
                      <p className="truncate px-1.5 py-1 text-center text-[10px] font-semibold text-app-fg-muted">
                        {slide.idx + 1}. {CAROUSEL_ROLE_LABELS[slide.role] ?? slide.role}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-xs text-app-fg-muted">
              No reference template — slides use AI-generated backgrounds instead of your Media library.
            </p>
          )}
          {snapId !== "" && !snapInLibrary && carouselTemplateLibrary.length > 0 ? (
            <p className="mt-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300/90">
              This snapshot is not in your current template library. Pick a template below to replace it.
            </p>
          ) : null}

          {carouselTemplateLibrary.length > 0 && !carouselSlidesLocked ? (
            <label className="mt-3 block">
              <span className="mb-1.5 block text-[11px] font-semibold text-app-fg-muted">Change template</span>
              <span className="sr-only">Carousel template</span>
              <div className="relative">
                <select
                  className="w-full appearance-none rounded-xl border border-zinc-200/90 bg-white px-3 py-2.5 pr-9 text-sm text-zinc-900 shadow-sm disabled:opacity-60 dark:border-white/10 dark:bg-zinc-900/80 dark:text-app-fg"
                  value={selectedTemplateSelectValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    void onPatchCarouselTemplate(v);
                  }}
                  disabled={
                    carouselTemplateBusy || carouselGenBusy || carouselSlideBusy || loading
                  }
                >
                  {!snapInLibrary && snapId !== "" ? (
                    <option value="" disabled>
                      — Choose a template to replace snapshot —
                    </option>
                  ) : (
                    <option value="" disabled={snapInLibrary}>
                      {snapInLibrary ? "Change to…" : "Choose a template…"}
                    </option>
                  )}
                  {carouselTemplateLibrary.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-app-fg-muted"
                  aria-hidden
                />
              </div>
            </label>
          ) : null}

          {carouselTemplateLibrary.length > 0 && carouselSlidesLocked ? (
            <div className="mt-3 space-y-2">
              {!carouselStyleSwitchOpen ? (
                <button
                  type="button"
                  disabled={carouselTemplateBusy || carouselGenBusy || carouselSlideBusy || loading}
                  onClick={() => {
                    const first = carouselTemplateLibrary[0]?.id ?? "";
                    setCarouselStyleSwitchDraftId(snapInLibrary && snapId ? snapId : first);
                    setCarouselStyleSwitchOpen(true);
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-app-divider bg-app-chip-bg/40 px-3 py-2.5 text-xs font-bold text-app-fg transition-colors hover:bg-app-chip-bg/70 disabled:opacity-50 sm:w-auto"
                >
                  Switch carousel template…
                </button>
              ) : (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
                  <p className="text-[11px] leading-relaxed text-app-fg-muted">
                    Pick a new template, then confirm.{" "}
                    <span className="font-semibold text-app-fg">
                      All current slides (text and images) are removed
                    </span>{" "}
                    so new backgrounds can render. Hooks and caption stay as they are — use{" "}
                    <span className="font-semibold text-app-fg-secondary">Generate slides</span> below when ready.
                  </p>
                  <label className="mt-3 block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-app-fg-muted">New template</span>
                    <div className="relative">
                      <select
                        className="w-full appearance-none rounded-xl border border-zinc-200/90 bg-white px-3 py-2.5 pr-9 text-sm text-zinc-900 shadow-sm dark:border-white/10 dark:bg-zinc-900/80 dark:text-app-fg"
                        value={carouselStyleSwitchDraftId ?? ""}
                        onChange={(e) => setCarouselStyleSwitchDraftId(e.target.value || null)}
                        disabled={carouselTemplateBusy || carouselGenBusy || carouselSlideBusy || loading}
                      >
                        <option value="" disabled>
                          Select…
                        </option>
                        {carouselTemplateLibrary.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-app-fg-muted"
                        aria-hidden
                      />
                    </div>
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={
                        !carouselStyleSwitchDraftId ||
                        carouselTemplateBusy ||
                        carouselGenBusy ||
                        carouselSlideBusy ||
                        loading
                      }
                      onClick={() => {
                        const id = carouselStyleSwitchDraftId;
                        if (!id) return;
                        void onPatchCarouselTemplate(id, { clearSlides: true });
                      }}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-zinc-950 shadow-sm hover:opacity-95 disabled:opacity-50 sm:flex-none"
                    >
                      {carouselTemplateBusy ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                      ) : null}
                      Apply template &amp; clear slides
                    </button>
                    <button
                      type="button"
                      disabled={carouselTemplateBusy}
                      onClick={() => {
                        setCarouselStyleSwitchOpen(false);
                        setCarouselStyleSwitchDraftId(null);
                      }}
                      className="rounded-xl border border-app-divider px-4 py-2 text-xs font-semibold text-app-fg-muted hover:bg-white/5"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {carouselTemplateBusy ? (
            <p className="mt-2 flex items-center gap-2 text-[11px] text-app-fg-muted">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
              Updating template…
            </p>
          ) : null}
        </div>

        <CarouselEditor
          clientSlug={clientSlug}
          orgSlug={orgSlug}
          sessionId={session.id}
          slides={carouselDraft}
          images={images}
          busy={carouselSlideBusy || loading}
          bgCacheRevByIdx={carouselBgCacheRev}
          regeneratingIdx={carouselRegeneratingIdx}
          generating={carouselGenBusy}
          convertingEditable={carouselConvertBusy}
          count={carouselCount}
          countLocked={false}
          countHint={
            session.carousel_slide_count != null &&
            typeof session.carousel_slide_count === "number" &&
            Number.isFinite(session.carousel_slide_count)
              ? `Target length for this session: ${session.carousel_slide_count} slides (set on Generate).`
              : undefined
          }
          onCountChange={setCarouselCount}
          onGenerateAll={onGenerateCarouselSlides}
          onConvertToEditable={onConvertCarouselToEditable}
          onRegenerateOne={onRegenerateCarouselSlide}
          onTextEdit={onCarouselTextEdit}
          onLayoutCommit={onCarouselLayoutCommit}
          onTextBoxAdjust={onCarouselTextBoxAdjust}
          onBackgroundStyleAdjust={onCarouselBackgroundStyleAdjust}
          onBroadcastTextBoxField={onBroadcastCarouselTextBoxField}
          onBroadcastBackgroundField={onBroadcastCarouselBackgroundField}
          onBroadcastTextBoxDraft={onBroadcastCarouselTextBoxDraft}
          onBroadcastBackgroundDraft={onBroadcastCarouselBackgroundDraft}
          onApplyTextStyleToAll={onApplyCarouselTextStyleToAll}
          onApplyBackgroundToAll={onApplyCarouselBackgroundToAll}
          onRemoveSlide={onRemoveCarouselSlide}
          onError={(message) => show(message, "error")}
          inFlight={carouselInFlight}
        />

        <CaptionSection
          caption={session.caption_body ?? ""}
          hashtags={session.hashtags ?? []}
          onCopy={() => void copyText("caption + hashtags", captionFull)}
          regenInline={
            <RegenInline
              scope="caption"
              busy={regenBusyScope === "caption"}
              onRegen={async (s, fb) => onRegenSection(s, fb)}
              placeholder="Different angle, shorter, …"
            />
          }
        />

        <AiContextSection
          hooks={hooks}
          regenHooks={(fb) => onRegenSection("hooks", fb)}
          busy={regenBusyScope === "hooks"}
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
            busy={regenBusyScope === "hooks"}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl border border-app-divider/80 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <StudioFormatTabs
            value={videoSurface}
            onChange={setVideoSurface}
            tabs={[
              { id: "reel", label: "Reel" },
              { id: "cover", label: "Cover" },
              { id: "output", label: "Output" },
            ]}
          />
          <div className="ml-auto flex items-center gap-2 text-[10px] text-app-fg-muted">
            <SaveStatusPill inFlight={contentInFlight + specInFlight + coverSpecInFlight} />
            <span className="hidden sm:inline">Autosaved studio</span>
          </div>
        </div>
      </div>

      {videoSurface === "reel" ? (
      <div className="glass rounded-2xl border border-app-divider/80 p-3.5 md:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-app-divider/50 pb-3">
          <div>
            <p className="text-sm font-semibold text-app-fg">Reel studio</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-app-fg-muted">
              Edit the on-screen text, background, look, and timing while the preview stays visible.
            </p>
          </div>
          <button
            type="button"
            disabled={renderBusy || !step2Done}
            onClick={() => void onRender()}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-500/20 px-4 py-2 text-xs font-bold text-violet-200 hover:bg-violet-500/30 disabled:opacity-50"
          >
            {renderBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
            {session.rendered_video_url ? "Re-render" : renderBusy ? "Starting…" : "Render video"}
          </button>
        </div>

        {/* Preview column (sticky) + edit column: preview stays visible while scrolling
            template/look/layout/timing — matches NLE / Figma mental model. */}
        <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)] lg:items-start xl:grid-cols-[270px_minmax(0,1fr)]">
          <div className="mx-auto flex w-full max-w-[270px] shrink-0 flex-col gap-2 lg:sticky lg:top-4 lg:mx-0">
            {bgBusy ? (
              <div className="flex aspect-[9/16] w-full max-w-[250px] flex-col items-center justify-center gap-2 self-center rounded-xl border border-app-divider bg-app-chip-bg/40">
                <Loader2 className="h-6 w-6 animate-spin text-app-fg-subtle" />
                <p className="text-[10px] text-app-fg-muted">~30–60s</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    aria-pressed={safeZonePreview}
                    title="Instagram safe zone (4:5 crop)"
                    onClick={() => setSafeZonePreview((v) => !v)}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border text-app-fg-muted transition hover:text-app-fg ${
                      safeZonePreview
                        ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
                        : "border-app-divider/60 bg-app-chip-bg/30"
                    }`}
                  >
                    <Shield className="h-4 w-4" aria-hidden />
                    <span className="sr-only">Toggle IG safe zone overlay</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={layoutGuides}
                    title="Layout guides"
                    onClick={() => setLayoutGuides((v) => !v)}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border text-app-fg-muted transition hover:text-app-fg ${
                      layoutGuides
                        ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
                        : "border-app-divider/60 bg-app-chip-bg/30"
                    }`}
                  >
                    <Grid3x3 className="h-4 w-4" aria-hidden />
                    <span className="sr-only">Toggle layout guides</span>
                  </button>
                </div>
                <VideoSpecPreview
                  spec={livePreviewSpec}
                  playerSpec={playerSpec}
                  safeZone={safeZonePreview}
                  layoutGuides={layoutGuides}
                  width={250}
                  selectedSegmentId={selectedSegmentId}
                  onSelectSegment={setSelectedSegmentId}
                  onResizeLayerTimingDraft={onResizeLayerTimingDraftRaf}
                  onResizeLayerTimingCommit={onResizeLayerTimingCommit}
                  clipTrim={previewClipTrim}
                  timingDisabled={!session.background_url}
                />
              </>
            )}
          </div>

          <div className="flex min-w-0 flex-col rounded-2xl border border-app-divider/70 bg-app-chip-bg/10">
            <div className="z-10 shrink-0 border-b border-app-divider/40 bg-app-bg/95 p-3 backdrop-blur-sm">
              <SegmentedTabs<VideoEditorTab>
                value={videoEditorTab}
                onChange={setVideoEditorTab}
                tabs={[
                  { id: "text", label: "Text" },
                  { id: "background", label: "Background" },
                  { id: "look", label: "Look" },
                  { id: "timing", label: "Timing" },
                ]}
              />
            </div>
            <div className="space-y-4 px-3 pb-4 pt-3 md:px-4">
            {videoEditorTab === "text" ? (
              <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-app-fg-muted">On-screen text</p>
                  <p className="mt-0.5 text-[10px] text-app-fg-subtle">
                    Hook and beat text. Keep each line short enough to read in under 2 seconds.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <SaveStatusPill inFlight={contentInFlight} />
                  <button
                    type="button"
                    onClick={() => setTextDraft((prev) => [...prev, { text: "", isCTA: false }])}
                    disabled={textDraft.length >= 6}
                    className="inline-flex items-center gap-1 rounded-lg border border-app-divider px-2 py-1 text-[11px] font-semibold text-app-fg-muted hover:text-app-fg disabled:opacity-40"
                  >
                    <Plus className="h-3 w-3" /> Add beat
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {primaryHookText !== null && primaryHookText !== undefined ? (
                  <div className="flex items-center gap-2">
                    <div
                      className="glass-inset flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2"
                      title="Hook · burned into the first segment of the reel"
                    >
                      <span className="inline-flex shrink-0 rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                        Hook
                      </span>
                      <input
                        value={hookDraft}
                        onChange={(e) => setHookDraft(e.target.value)}
                        onBlur={() => void onCommitHookText()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            e.currentTarget.blur();
                          }
                        }}
                        placeholder="Stop-the-scroll opening line…"
                        className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-app-fg placeholder:text-app-fg-subtle focus:outline-none"
                      />
                    </div>
                    <RegenInline
                      scope="hooks"
                      busy={regenBusyScope === "hooks"}
                      onRegen={async (s, fb) => onRegenSection(s, fb)}
                      placeholder="More direct, shorter, …"
                    />
                  </div>
                ) : null}

                {textDraft.map((b, i) => (
                  <div key={i} className="flex items-center gap-2 group/item">
                    <div className="flex flex-col shrink-0">
                      <button
                        type="button"
                        disabled={i === 0}
                        onClick={() => moveTextBlock(i, -1)}
                        className="rounded p-0.5 text-app-fg-subtle hover:bg-white/10 hover:text-app-fg disabled:opacity-10 transition duration-150"
                        title="Move up"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={i === textDraft.length - 1}
                        onClick={() => moveTextBlock(i, 1)}
                        className="rounded p-0.5 text-app-fg-subtle hover:bg-white/10 hover:text-app-fg disabled:opacity-10 transition duration-150"
                        title="Move down"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                    <input
                      value={b.text}
                      onChange={(e) => {
                        const next = [...textDraft];
                        next[i] = { ...next[i], text: e.target.value };
                        setTextDraft(next);
                      }}
                      placeholder={b.isCTA ? "👇 Comment 'KEYWORD' to get …" : "Short punchy line…"}
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
                      onClick={() => void onRemoveTextBlock(i)}
                      className="rounded-lg p-2 text-app-fg-subtle hover:bg-red-500/10 hover:text-red-400"
                      aria-label="Remove block"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              </div>
            ) : null}

            {videoEditorTab === "background" ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-app-divider/60 bg-app-chip-bg/20 p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-app-fg-muted">
                        Active background
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-app-fg-muted">
                        {isBroll || session.background_type === "broll"
                          ? "Stock clip controls the reel timing. Trim range and beat duration stay tied to the usable clip window."
                          : session.background_type === "client_image"
                            ? "Client photo is used as the static reel backdrop."
                            : session.background_type === "generated_image"
                              ? "AI image is used as the static reel backdrop."
                              : "Pick a background source before rendering."}
                      </p>
                      {livePreviewSpec?.background.kind === "video" ? (
                        <p className="mt-1 text-[10px] text-app-fg-subtle">
                          Usable clip length:{" "}
                          <span className="font-semibold text-app-fg">
                            {(effectiveBackgroundDuration(livePreviewSpec.background) ?? livePreviewSpec.background.durationSec ?? 0).toFixed(1)}s
                          </span>
                        </p>
                      ) : null}
                    </div>
                    {session.background_url ? (
                      <a
                        href={session.background_url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded-lg border border-app-divider px-2 py-1 text-[10px] font-semibold text-app-fg-muted hover:border-amber-500/40 hover:text-amber-200"
                      >
                        Open asset ↗
                      </a>
                    ) : null}
                  </div>
                </div>

                {isTextOverlay ? (
                  <BackgroundPicker
                    source={bgSource ?? "ai"}
                    onSourceChange={onPickBgSource}
                    aiBusy={bgBusy}
                    hasGeneratedImage={
                      session.background_type === "generated_image" && Boolean(session.background_url)
                    }
                    onGenerateAi={onGenerateBg}
                    images={images}
                    selectedImageId={session.background_type === "client_image" ? selectedImageId : ""}
                    pickerBusy={loading}
                    onPickImage={(id) => void onSetBackgroundImage(id)}
                    clips={clips}
                    selectedClipId={selectedClipId}
                    sessionBrollClipId={session.broll_clip_id}
                    deletingClipId={deletingClipId}
                    onPickClip={(id) => void onSetBroll(id)}
                    onDeleteClip={(id) => void onDeleteClip(id)}
                    backgroundUrl={null}
                  />
                ) : isBroll ? (
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
                ) : null}
              </div>
            ) : null}

            {videoEditorTab === "look" ? (
            <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-divider/40 pb-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-app-fg-muted">Look & layout</p>
              <div className="flex items-center gap-2">
                <UndoPill
                  canUndo={undoStack.canUndo}
                  canRedo={undoStack.canRedo}
                  label={undoStack.lastLabel}
                  onUndo={onUndo}
                  onRedo={onRedo}
                />
                <SaveStatusPill inFlight={specInFlight} />
              </div>
            </div>

            {/* Phase D: legacy AI Refine prompt box was deleted. Refine, regen,
                hook variants, and other actions now live in the ⌘K command
                palette and are reachable via the visible pill below — same
                registry powers both surfaces (`editors/video/videoActions.ts`).
                The palette opens with ⌘K (or click the pill) and surfaces a
                contextual list of actions for whatever's selected. */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              disabled={aiRefineBusy}
              className="glass-inset mb-3 inline-flex w-full items-center gap-2 rounded-lg border border-app-divider/60 px-3 py-2 text-[11px] text-app-fg-subtle transition hover:border-amber-500/40 hover:text-app-fg disabled:opacity-50"
            >
              {aiRefineBusy ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
              ) : (
                <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate text-left">
                {aiRefineBusy
                  ? aiRefinePhase === "applying"
                    ? "Applying AI refine…"
                    : "Generating edits…"
                  : "Search actions — refine, vary hook, darken background…"}
              </span>
              <kbd className="shrink-0 rounded border border-app-divider bg-app-chip-bg/60 px-1 py-px font-mono text-[9px] text-app-fg-muted">
                ⌘K
              </kbd>
            </button>

            <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
              <div className="min-w-0 space-y-4">
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-app-fg-muted">Format</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        { id: "center" as const, label: "Center", title: "Headline stack in the middle" },
                        { id: "card" as const, label: "Card", title: "Caption on a card — use Position for top / middle / bottom" },
                        { id: "stack" as const, label: "Stack", title: "One card per beat in a vertical stack" },
                      ] as const
                    ).map((t) => {
                      const active = formatChipSelection === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          aria-pressed={active}
                          title={t.title}
                          disabled={!session.background_url}
                          onClick={() => void onSetUiFormat(t.id)}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-semibold transition disabled:opacity-40 ${
                            active ? STYLE_CHIP_ON : STYLE_CHIP_OFF
                          }`}
                        >
                          <FormatGlyph format={t.id} />
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {(formatChipSelection === "card" || formatChipSelection === "stack") && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-app-fg-muted">Position</p>
                    <div className="flex flex-wrap gap-1">
                      {(
                        [
                          { id: "top" as const, label: "Top" },
                          { id: "center" as const, label: "Middle" },
                          { id: "bottom" as const, label: "Bottom" },
                        ] as const
                      ).map((p) => {
                        const active = uiPinForPositionRow === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            aria-pressed={active}
                            disabled={!session.background_url}
                            title="Where the caption block sits vertically"
                            onClick={() => void onSetUiPin(p.id)}
                            className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition disabled:opacity-40 ${
                              active ? STYLE_CHIP_ON : STYLE_CHIP_OFF
                            }`}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="space-y-2 border-t border-app-divider/30 pt-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-app-fg-muted">Layout</p>
                        {(sessionLayout.verticalAnchor !== DEFAULT_LAYOUT.verticalAnchor ||
                          sessionLayout.verticalOffset !== DEFAULT_LAYOUT.verticalOffset ||
                          sessionLayout.scale !== DEFAULT_LAYOUT.scale ||
                          sessionLayout.sidePadding !== DEFAULT_LAYOUT.sidePadding ||
                          sessionLayout.textAlign !== DEFAULT_LAYOUT.textAlign ||
                          sessionLayout.stackGap !== DEFAULT_LAYOUT.stackGap ||
                          sessionLayout.stackGrowth !== DEFAULT_LAYOUT.stackGrowth) ? (
                          <span
                            className="rounded-sm bg-emerald-500/15 px-1 py-px text-[8px] font-semibold uppercase tracking-wide text-emerald-300"
                            title={`Saved: anchor ${sessionLayout.verticalAnchor ?? "bottom"}, vertical ${Math.round(sessionLayout.verticalOffset * 100)}%, size ${sessionLayout.scale.toFixed(2)}x, padding ${Math.round(sessionLayout.sidePadding * 100)}%, align ${sessionLayout.textAlign}, stack gap ${Math.round(sessionLayout.stackGap * 1920)}px, stack growth ${sessionLayout.stackGrowth}`}
                          >
                            Saved
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[9px] text-app-fg-subtle">
                        Alignment, nudge, and size — use Format → Position for top / middle / bottom on cards.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={
                        !session.background_url ||
                        (sessionLayout.verticalAnchor === DEFAULT_LAYOUT.verticalAnchor &&
                          sessionLayout.verticalOffset === DEFAULT_LAYOUT.verticalOffset &&
                          sessionLayout.scale === DEFAULT_LAYOUT.scale &&
                          sessionLayout.sidePadding === DEFAULT_LAYOUT.sidePadding &&
                          sessionLayout.textAlign === DEFAULT_LAYOUT.textAlign &&
                          sessionLayout.stackGap === DEFAULT_LAYOUT.stackGap &&
                          sessionLayout.stackGrowth === DEFAULT_LAYOUT.stackGrowth)
                      }
                      onClick={() => {
                        setLayoutDraft(DEFAULT_LAYOUT);
                        void Promise.all([
                          onCommitLayout("verticalAnchor", DEFAULT_LAYOUT.verticalAnchor),
                          onCommitLayout("verticalOffset", DEFAULT_LAYOUT.verticalOffset),
                          onCommitLayout("textPanX", DEFAULT_LAYOUT.textPanX ?? 0),
                          onCommitLayout("scale", DEFAULT_LAYOUT.scale),
                          onCommitLayout("sidePadding", DEFAULT_LAYOUT.sidePadding),
                          onCommitLayout("textAlign", DEFAULT_LAYOUT.textAlign),
                          onCommitLayout("stackGap", DEFAULT_LAYOUT.stackGap),
                          onCommitLayout("stackGrowth", DEFAULT_LAYOUT.stackGrowth),
                        ]);
                      }}
                      className="text-[9px] font-semibold uppercase tracking-wide text-app-fg-subtle hover:text-app-fg disabled:opacity-30"
                    >
                      Reset
                    </button>
                  </div>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-app-fg-muted">
                        Text alignment
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {(
                          [
                            { id: "left" as const, label: "Left" },
                            { id: "center" as const, label: "Center" },
                            { id: "right" as const, label: "Right" },
                          ] as const
                        ).map((opt) => {
                          const active = layoutDraft.textAlign === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              aria-pressed={active}
                              disabled={!session.background_url}
                              onClick={() => {
                                setLayoutDraft((s) => ({ ...s, textAlign: opt.id }));
                                void onCommitLayout("textAlign", opt.id);
                              }}
                              className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition disabled:opacity-40 ${
                                active
                                  ? "border-amber-500 bg-amber-500/15 text-amber-200"
                                  : "border-app-divider text-app-fg-muted hover:border-amber-500/40"
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <LayoutSlider
                      label="Nudge up / down"
                      title="Vertical move for the whole caption area as a fraction of frame height (-100% = one full frame up, +100% = one full frame down). Combines with Top / Middle / Bottom on card layouts."
                      leftHint="Top (-100%)"
                      rightHint="Bottom (+100%)"
                      min={LAYOUT_VERTICAL_OFFSET_MIN}
                      max={LAYOUT_VERTICAL_OFFSET_MAX}
                      step={0.005}
                      value={layoutDraft.verticalOffset}
                      disabled={!session.background_url}
                      formatValue={(v) =>
                        v === 0 ? "0" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`
                      }
                      onChange={(v) => setLayoutDraft((s) => ({ ...s, verticalOffset: v }))}
                      onCommit={(v) => void onCommitLayout("verticalOffset", v)}
                      showSteppers
                      stepperStep={0.02}
                    />
                    <LayoutSlider
                      label="Size"
                      title="Text size for the whole video. For one beat only, use Size under Look → Style."
                      leftHint="Smaller"
                      rightHint="Larger"
                      min={0.7}
                      max={1.3}
                      step={0.05}
                      value={layoutDraft.scale}
                      disabled={!session.background_url}
                      formatValue={(v) => `${v.toFixed(2)}x`}
                      onChange={(v) => setLayoutDraft((s) => ({ ...s, scale: v }))}
                      onCommit={(v) => void onCommitLayout("scale", v)}
                    />
                  </div>
                  <details className="group rounded-lg border border-app-divider/50 bg-app-chip-bg/10 px-2 py-1.5">
                    <summary className="cursor-pointer select-none text-[9px] font-bold uppercase tracking-wide text-app-fg-muted marker:text-app-fg-subtle">
                      Advanced layout
                    </summary>
                    <div className="mt-2 space-y-3 border-t border-app-divider/30 pt-2">
                      <LayoutSlider
                        label="Side padding"
                        title="Horizontal inset: space between the left/right frame edge and the text block (not top/bottom)."
                        leftHint="Tight"
                        rightHint="Roomy"
                        min={0.02}
                        max={0.12}
                        step={0.005}
                        value={layoutDraft.sidePadding}
                        disabled={!session.background_url}
                        formatValue={(v) => `${Math.round(v * 100)}%`}
                        onChange={(v) => setLayoutDraft((s) => ({ ...s, sidePadding: v }))}
                        onCommit={(v) => void onCommitLayout("sidePadding", v)}
                      />
                      <div
                        className={`space-y-1.5 rounded-md border px-2 py-2 ${
                          styleTemplateId === "stacked-cards"
                            ? "border-amber-500/25 bg-amber-500/5"
                            : "border-app-divider/60 bg-app-chip-bg/20"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[9px] font-semibold uppercase tracking-wide text-app-fg-muted">
                              Stack layout
                            </p>
                            <p className="mt-0.5 text-[9px] text-app-fg-subtle">
                              {styleTemplateId === "stacked-cards"
                                ? "Gap and growth between stacked caption cards."
                                : "Choose Stack in Format for one card per beat."}
                            </p>
                          </div>
                          {styleTemplateId !== "stacked-cards" && session.background_url ? (
                            <button
                              type="button"
                              onClick={() => void onPatchVideoTemplate("stacked-cards")}
                              className="shrink-0 rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-amber-200 hover:bg-amber-500/20"
                            >
                              Use Stack
                            </button>
                          ) : null}
                        </div>
                        <LayoutSlider
                          label="Gap between cards"
                          title="Vertical gap between stacked caption boxes (fraction of frame height). Only when template is Stacked."
                          leftHint="Tight"
                          rightHint="Spaced"
                          min={0}
                          max={0.06}
                          step={0.002}
                          value={layoutDraft.stackGap}
                          disabled={!session.background_url || styleTemplateId !== "stacked-cards"}
                          formatValue={(v) => `${Math.round(v * 1920)}px`}
                          onChange={(v) => setLayoutDraft((s) => ({ ...s, stackGap: v }))}
                          onCommit={(v) => void onCommitLayout("stackGap", v)}
                        />
                        {/* NOTE: the legacy "stackGrowth" control used to live here
                            but the stacked-cards template (templates/stackedCards.tsx)
                            intentionally ignores the field — cards always grow top→down
                            from the anchor. Removed in May 2026 so we don't show users
                            a knob that has no visual effect. */}
                      </div>
                    </div>
                  </details>
                </div>
              </div>
              <div className="min-w-0 space-y-4">
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-app-fg-muted">Look</p>
                  <div className="flex flex-wrap gap-1.5">
                    {LOOK_VISUAL.map((t) => {
                      const active = livePreviewSpec?.themeId === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          aria-pressed={active}
                          title={t.title}
                          disabled={!session.background_url}
                          onClick={() => void onPatchVideoTheme(t.id)}
                          className={`inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-semibold transition disabled:opacity-40 ${
                            active ? STYLE_CHIP_ON : STYLE_CHIP_OFF
                          }`}
                        >
                          <span className="flex shrink-0 gap-0.5" aria-hidden>
                            {t.swatches.map((c) => (
                              <span
                                key={c}
                                className="h-3 w-1.5 rounded-sm border border-white/10"
                                style={{ background: c }}
                              />
                            ))}
                          </span>
                          <span
                            className="text-[11px] font-bold leading-none text-app-fg-muted"
                            style={{ fontFamily: t.fontFamily }}
                          >
                            Aa
                          </span>
                          <span className="truncate">{t.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2 border-t border-app-divider/30 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-app-fg-muted">Style</p>
                      <p className="text-[9px] text-app-fg-subtle">
                        {selectedSegmentId === "hook"
                          ? "Applies to whole video"
                          : "Applies to selected beat"}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={!session.background_url || !styleResetEnabled}
                      title="Reset to look defaults"
                      onClick={() => void onClearAppearance()}
                      className="inline-flex items-center gap-1 rounded-md border border-app-divider/60 px-1.5 py-1 text-app-fg-muted transition hover:border-amber-500/40 hover:text-app-fg disabled:opacity-30"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden />
                      <span className="text-[9px] font-semibold uppercase tracking-wide">Reset</span>
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-app-fg-muted">
                        Text size
                      </p>
                      <button
                        type="button"
                        disabled={!session.background_url}
                        onClick={() => void onApplyFontScaleToAllBeats()}
                        className="text-[9px] font-semibold text-app-fg-muted underline decoration-app-divider underline-offset-2 hover:text-app-fg disabled:opacity-30"
                      >
                        Copy to all beats
                      </button>
                    </div>
                    <LayoutSlider
                      label="Size"
                      title={
                        selectedSegmentId === "hook"
                          ? "Hook text size on top of the global Size in Layout."
                          : "This beat only. Global Size in Layout still applies to every beat."
                      }
                      leftHint="Smaller"
                      rightHint="Larger"
                      min={0.5}
                      max={2}
                      step={0.05}
                      value={displayBeatFontScale}
                      disabled={!session.background_url}
                      formatValue={(v) =>
                        Math.abs(v - 1) < 0.02 ? "Default" : `${Math.round(v * 100)}%`
                      }
                      onChange={onChangeFontScale}
                      onCommit={(v) => void onCommitFontScale(v)}
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-app-fg-muted">Font</p>
                    <div className="flex flex-wrap gap-1">
                      {(
                        [
                          { id: "auto" as const, label: "Auto" },
                          { id: "modern" as const, label: "Modern" },
                          { id: "clean" as const, label: "Clean" },
                          { id: "editorial" as const, label: "Serif" },
                          { id: "hand" as const, label: "Hand" },
                        ] as const
                      ).map((row) => {
                        const active = styleFontMood === row.id;
                        return (
                          <button
                            key={row.id}
                            type="button"
                            aria-pressed={active}
                            disabled={!session.background_url}
                            onClick={() => void onCommitAppearanceOps(opsForFontMood(row.id))}
                            className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition disabled:opacity-40 ${
                              active ? STYLE_CHIP_ON : STYLE_CHIP_OFF
                            }`}
                          >
                            {row.label}
                          </button>
                        );
                      })}
                    </div>
                    {styleFontMood === "auto" ? (
                      <InheritanceHint>
                        Auto = {resolvedThemeFontLabel(styleThemeForCard)} (from{" "}
                        {resolvedThemeLookLabel(styleThemeForCard)} look)
                      </InheritanceHint>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-app-fg-muted">Contrast</p>
                    <div className="flex flex-wrap gap-1">
                      {(
                        [
                          { id: "auto" as const, label: "Auto" },
                          { id: "light" as const, label: "Light on dark" },
                          { id: "dark" as const, label: "Dark on light" },
                        ] as const
                      ).map((row) => {
                        const active = styleContrast === row.id;
                        return (
                          <button
                            key={row.id}
                            type="button"
                            aria-pressed={active}
                            disabled={!session.background_url}
                            onClick={() =>
                              void onCommitAppearanceOps(
                                opsForContrast(row.id, {
                                  templateId: styleTemplateId,
                                  themeId: styleThemeForCard,
                                }),
                              )
                            }
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition disabled:opacity-40 ${
                              active ? STYLE_CHIP_ON : STYLE_CHIP_OFF
                            }`}
                          >
                            {row.id !== "auto" ? (
                              <span
                                className="h-3 w-3 shrink-0 rounded-full border border-white/15"
                                style={{
                                  background:
                                    row.id === "light"
                                      ? "linear-gradient(90deg,#0a0a0a 50%,#f8fafc 50%)"
                                      : "linear-gradient(90deg,#f8fafc 50%,#0a0a0a 50%)",
                                }}
                                aria-hidden
                              />
                            ) : null}
                            {row.label}
                          </button>
                        );
                      })}
                    </div>
                    {styleContrast === "auto" ? (
                      <InheritanceHint>
                        {resolvedContrastLabel("auto", styleThemeForCard)}
                      </InheritanceHint>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-app-fg-muted">Text treatment</p>
                    <p className="text-[9px] text-app-fg-subtle">
                      Outline adds a heavy outer stroke on top of your format (Center, Card, or Stack).
                    </p>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        aria-pressed={!isBoldOutline}
                        disabled={!session.background_url}
                        title="Standard caption lettering for the selected format"
                        onClick={() => void onSetOutlineLayout(false)}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition disabled:opacity-40 ${
                          !isBoldOutline ? STYLE_CHIP_ON : STYLE_CHIP_OFF
                        }`}
                      >
                        Default
                      </button>
                      <button
                        type="button"
                        aria-pressed={isBoldOutline}
                        disabled={!session.background_url}
                        title="Punchy heavy-stroke lettering — works with Center, Card, and Stack"
                        onClick={() => void onSetOutlineLayout(true)}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold transition disabled:opacity-40 ${
                          isBoldOutline ? STYLE_CHIP_ON : STYLE_CHIP_OFF
                        }`}
                      >
                        <OutlineGlyph />
                        Outline
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            </div>
            </>
            ) : null}

            {videoEditorTab === "timing" ? (
            <div className="min-w-0 space-y-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-app-fg-muted font-mono tracking-wider">Timing Overview</p>
                {(() => {
                  if (!previewVideoSpec || !livePreviewSpec) return null;
                  const segId = selectedSegmentId;
                  const timelineSec = livePreviewSpec.totalSec;
                  const label = stableBlockLabelsRef.current[segId] || segmentLabel(previewVideoSpec, segId);
                  const excerpt = segmentExcerpt(previewVideoSpec, segId);
                  const layerDur = selectedLayer
                    ? (selectedLayer.endSec - selectedLayer.startSec).toFixed(1)
                    : segmentDurationSec(livePreviewSpec, segId).toFixed(1);
                  const autoFor = (id: string): number => {
                    if (id === "hook") return autoHookDurationSec();
                    const b = previewVideoSpec.blocks.find((x) => x.id === id);
                    return autoBlockDurationSec(b?.text ?? "");
                  };
                  const usableBackgroundSec =
                    livePreviewSpec.background.kind === "video"
                      ? (effectiveBackgroundDuration(livePreviewSpec.background) ??
                        livePreviewSpec.background.durationSec ??
                        null)
                      : null;
                  const durationMax = Math.max(
                    segmentDurationRange(segId).min,
                    Math.min(segmentDurationRange(segId).max, usableBackgroundSec ?? 20),
                  );
                  const autoDur = Math.min(durationMax, autoFor(segId));
                  const savedDur = segmentDurationSec(previewVideoSpec, segId);
                  const videoBg = livePreviewSpec.background.kind === "video" ? livePreviewSpec.background : null;
                  const effDur =
                    videoBg?.durationSec != null
                      ? (effectiveBackgroundDuration(videoBg) ?? Number(videoBg.durationSec))
                      : null;
                  const timelineOver = effDur != null ? timelineSec > effDur + 0.25 : false;
                  const timingDisabled = !session.background_url;

                  return (
                    <div className="space-y-4 border-t border-app-divider/30 pt-4">
                      {/* Reel Health & Summary Dashboard */}
                      <div className="grid grid-cols-2 gap-2 rounded-xl border border-app-divider/40 bg-app-chip-bg/10 p-2.5">
                        <div className="space-y-0.5">
                          <p className="text-[9px] font-bold uppercase tracking-wide text-app-fg-subtle">Reel Length</p>
                          <p className="text-sm font-black tabular-nums text-app-fg">{timelineSec.toFixed(1)}s</p>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[9px] font-bold uppercase tracking-wide text-app-fg-subtle">Text Beats</p>
                          <p className="text-sm font-black text-app-fg">{selectedLayerRows.length} Cards</p>
                        </div>
                        <div className="col-span-2 border-t border-app-divider/20 pt-1.5 mt-1.5 space-y-0.5">
                          <p className="text-[9px] font-bold uppercase tracking-wide text-app-fg-subtle">Background Source</p>
                          {videoBg ? (
                            <p className="text-[10px] font-semibold text-app-fg-muted truncate">
                              Video clip ({effDur?.toFixed(1) || "12"}s usable segment)
                            </p>
                          ) : (
                            <p className="text-[10px] font-semibold text-app-fg-muted">Static Image</p>
                          )}
                        </div>
                      </div>

                      {timelineOver ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
                          <p className="text-[10px] leading-relaxed text-amber-100">
                            Text beats are {(timelineSec - effDur!).toFixed(1)}s longer than the clip window.
                          </p>
                          <button
                            type="button"
                            disabled={timingDisabled}
                            onClick={() => void onFitBlocksToBroll()}
                            className="shrink-0 rounded-lg border border-amber-500/50 bg-amber-500/20 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-50 hover:bg-amber-500/30 disabled:opacity-30"
                          >
                            Fix timing
                          </button>
                        </div>
                      ) : null}

                      {/* Card Inspector (Properties of selected element) */}
                      <div className="rounded-xl border border-app-divider/50 bg-app-chip-bg/20 p-3 space-y-2.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-app-divider/20 pb-2">
                          <div className="min-w-0">
                            <p className="text-[9px] font-bold uppercase tracking-wide text-app-fg-subtle">
                              Selected text card
                            </p>
                            <p className="mt-0.5 text-xs font-black text-amber-300">{label}</p>
                          </div>
                          <span className="rounded bg-app-chip-bg/50 px-2 py-0.5 text-xs font-bold tabular-nums text-app-fg">
                            {layerDur}s
                          </span>
                        </div>
                        <p className="text-[11px] italic leading-relaxed text-app-fg-muted bg-black/15 p-2 rounded-lg truncate" title={excerpt}>
                          "{excerpt}"
                        </p>
                        
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <div className="space-y-0.5">
                            <p className="text-[8px] font-bold uppercase tracking-wider text-app-fg-subtle">Reading Speed recommendation</p>
                            <p className="text-[10px] font-semibold text-app-fg-muted">{autoDur.toFixed(1)}s</p>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <SaveStatusPill inFlight={specInFlight} />
                            <button
                              type="button"
                              disabled={timingDisabled || Math.abs(autoDur - savedDur) < 0.05}
                              onClick={() => void onCommitTiming(segId, autoDur)}
                              className="rounded border border-app-divider/80 bg-app-chip-bg/30 px-2 py-1 text-[10px] font-bold text-app-fg-muted hover:border-amber-500/50 hover:text-amber-200 transition disabled:opacity-30"
                              title={`Auto-fit from word count (~${autoDur.toFixed(1)}s)`}
                            >
                              Auto duration
                            </button>
                            {selectedLayer && selectedLayer.id !== "hook" ? (
                              <button
                                type="button"
                                disabled={timingDisabled}
                                onClick={() => void onDeleteSelectedLayer()}
                                className="rounded border border-red-500/30 bg-red-500/5 px-2.5 py-1 text-[10px] font-bold text-red-300 hover:bg-red-500/10 hover:text-red-200 transition disabled:opacity-30"
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
            </div>
            ) : null}
            </div>
          </div>
        </div>

        {/* Render footer — primary action lives in the same card as the visual decision
            that unblocks it, instead of a separate "Render" card that's empty 90% of the time. */}
        <div className="mt-5 border-t border-app-divider/50 pt-4">
          {!step2Done && !step3Done ? (
            <p className="text-xs text-app-fg-muted">Pick a background (clip, photo, or AI) to enable render.</p>
          ) : isRendering ? (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-app-fg">Rendering…</p>
                  <p className="text-xs text-app-fg-muted">
                    Usually 1–3 minutes (this page polls for up to ~10 min). You can leave and come back.
                  </p>
                  {typeof session.render_progress_pct === "number" ? (
                    <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-black/20 dark:bg-white/10">
                      <div
                        className="h-full rounded-full bg-amber-500 transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(0, session.render_progress_pct))}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    const r = await refreshSession();
                    if (!r.ok) {
                      show(r.error, "error");
                      return;
                    }
                    const rs = r.data.render_status;
                    if (rs === "done" || rs === "cleaned") {
                      show("Video ready — download below.", "success");
                    } else if (rs === "failed") {
                      show(r.data.render_error || "Render failed.", "error");
                    } else {
                      show("Still rendering — check again in a bit.", "success");
                    }
                  })();
                }}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-app-divider bg-black/10 px-3 py-2 text-xs font-semibold text-app-fg hover:bg-black/20 dark:bg-white/5 dark:hover:bg-white/10 sm:self-center"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Check status
              </button>
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
      ) : null}

      {videoSurface === "cover" ? (
      <CoverEditor
        hooks={hooks}
        coverOptions={coverOptions}
        coverRegenBusy={coverRegenBusy}
        onRegenerateCovers={onRegenerateCovers}
        images={images}
        thumbnailUrl={thumbnailUrl}
        thumbnailBusy={thumbnailBusy}
        coverText={coverText}
        selectedImageId={coverImageId}
        selectedCoverTemplate={session.selected_cover_template ?? null}
        coverEdit={coverEdit}
        coverSpecInFlight={coverSpecInFlight}
        mode={coverMode}
        onModeChange={setCoverMode}
        onCoverTextChange={setCoverText}
        onCoverEditChange={setCoverEdit}
        onSelectImage={setCoverImageId}
        onGenerateAi={onGenerateThumbnail}
        onComposeFromImage={onComposeCoverFromImage}
        step={1}
      />
      ) : null}

      {videoSurface === "output" && (step3Done || session.rendered_video_url) && (
        <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-app-divider/50 pb-3">
            <div>
              <p className="text-sm font-semibold text-app-fg">Output</p>
              <p className="mt-1 text-xs text-app-fg-muted">Final MP4, cover, caption, and post preview.</p>
            </div>
            {session.rendered_video_url ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : null}
          </div>

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
                {session.thumbnail_url ? (
                  <a
                    href={session.thumbnail_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block text-[10px] font-semibold text-app-fg-muted underline decoration-app-divider underline-offset-2 hover:text-amber-200/90"
                  >
                    Open cover full size ↗
                  </a>
                ) : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <div>
                  <p className="text-sm font-semibold text-app-fg">Your video is ready.</p>
                  <p className="mt-1 text-xs leading-relaxed text-app-fg-muted">
                    Download the MP4 and open it in Instagram. Add a trending sound before publishing — audio
                    boosts reach significantly.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={session.rendered_video_url}
                    download="reel.mp4"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-zinc-950 shadow-md shadow-emerald-900/25 hover:opacity-90"
                  >
                    <Download className="h-3.5 w-3.5" /> Download MP4
                  </a>
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-app-divider px-3 py-2 text-xs font-bold text-app-fg hover:bg-white/5"
                  >
                    <Eye className="h-3.5 w-3.5" /> Preview post
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyText("caption + hashtags", captionFull)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-app-divider px-3 py-2 text-xs font-bold text-app-fg hover:bg-white/5"
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy caption
                  </button>
                </div>

                {session.caption_body ? (
                  <p className="line-clamp-3 whitespace-pre-line rounded-lg border border-app-divider/60 bg-app-chip-bg/20 px-3 py-2 text-[13px] leading-relaxed text-app-fg-secondary">
                    {session.caption_body}
                  </p>
                ) : null}

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

      {videoSurface === "output" && !step3Done && !session.rendered_video_url ? (
        <div className="glass rounded-2xl border border-app-divider/80 p-5 md:p-6">
          <p className="text-sm font-semibold text-app-fg">Output not ready yet.</p>
          <p className="mt-1 text-xs leading-relaxed text-app-fg-muted">
            Go back to the Reel tab, choose a background, then render the video. The final MP4,
            cover, caption, and post preview will appear here.
          </p>
          <button
            type="button"
            onClick={() => setVideoSurface("reel")}
            className="mt-4 rounded-xl bg-violet-500/20 px-4 py-2 text-xs font-bold text-violet-200 hover:bg-violet-500/30"
          >
            Back to Reel
          </button>
        </div>
      ) : null}

      {/* ── Caption + hashtags (always after Cover; copy with a button) ── */}
      {videoSurface !== "cover" ? (
      <>
      <CaptionSection
        caption={session.caption_body ?? ""}
        hashtags={session.hashtags ?? []}
        onCopy={() => void copyText("caption + hashtags", captionFull)}
        regenInline={
          <RegenInline
            scope="caption"
            busy={regenBusyScope === "caption"}
            onRegen={async (s, fb) => onRegenSection(s, fb)}
            placeholder="Different angle, shorter, …"
          />
        }
      />

      <AiContextSection
        hooks={hooks}
        regenHooks={(fb) => onRegenSection("hooks", fb)}
        busy={regenBusyScope === "hooks"}
      />
      </>
      ) : null}

      <PostPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Post preview"
        caption={session.caption_body}
        hashtags={session.hashtags}
        thumbnailUrl={session.thumbnail_url}
        videoUrl={session.rendered_video_url}
      />

      {/* Phase D: ⌘K command palette. Bound globally inside its own effect so
          the user can hit ⌘K anywhere on /generate. Actions come from
          `videoActions` above; the visible "Search actions…" pill above the
          look controls also opens this. */}
      <EditorCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        selection={editorSelection.selection}
        actions={videoActions}
      />
    </div>
  );
}
