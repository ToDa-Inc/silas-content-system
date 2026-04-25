import { applyPatch, type Operation } from "fast-json-patch";
import { z } from "zod";

const templateIdZ = z.enum([
  "bottom-card",
  "centered-pop",
  "top-banner",
  "capcut-highlight",
  "stacked-cards",
]);
const themeIdZ = z.enum(["bold-modern", "editorial", "casual-hand", "clean-minimal"]);
const animationZ = z.enum(["pop", "fade", "slide-up", "none"]);

export const videoSpecBlockZ = z.object({
  id: z.string(),
  text: z.string(),
  isCTA: z.boolean(),
  startSec: z.number(),
  endSec: z.number(),
  animation: animationZ,
});

const verticalAnchorZ = z.enum(["bottom", "center", "top"]);
const textAlignZ = z.enum(["left", "center", "right"]);
const stackGrowthZ = z.enum(["up", "down"]);

/** Global layout modifiers (kept small on purpose — see backend models/video_spec.py). */
export const videoSpecLayoutZ = z.object({
  verticalAnchor: verticalAnchorZ.nullish().default("bottom"),
  verticalOffset: z.number().min(-0.2).max(0.2).default(0),
  scale: z.number().min(0.7).max(1.3).default(1),
  sidePadding: z.number().min(0.02).max(0.12).default(0.05),
  textAlign: textAlignZ.default("center"),
  stackGap: z.number().min(0).max(0.06).default(0.008),
  stackGrowth: stackGrowthZ.default("up"),
});

export type VideoSpecLayout = z.infer<typeof videoSpecLayoutZ>;

export const DEFAULT_LAYOUT: VideoSpecLayout = {
  verticalAnchor: "bottom",
  verticalOffset: 0,
  scale: 1,
  sidePadding: 0.05,
  textAlign: "center",
  stackGap: 0.008,
  stackGrowth: "up",
};

export const videoSpecZ = z.object({
  v: z.literal(1),
  templateId: templateIdZ,
  themeId: themeIdZ,
  brand: z.object({
    primary: z.string(),
    // Backend serializes `Optional[str]` as JSON `null`, NOT `undefined` — use
    // `.nullish()` (= nullable + optional) so the parse round-trips. Using bare
    // `.optional()` here silently failed every parse and fell through to the
    // default-spec builder, which IGNORED user edits to template/theme/layout.
    accent: z.string().nullish(),
  }),
  background: z.object({
    url: z.string(),
    kind: z.enum(["video", "image"]),
    focalPoint: z.enum(["top", "center", "bottom"]),
    /** B-roll / video asset length (seconds) when known — composition totalSec matches this.
     * Backend serializes `Optional[float]` as JSON `null`; use `.nullish()` so the
     * round-trip parse succeeds (same gotcha that bit `brand.accent` above). */
    durationSec: z.number().positive().max(600).nullish(),
  }),
  hook: z.object({
    text: z.string(),
    durationSec: z.number(),
  }),
  blocks: z.array(videoSpecBlockZ),
  // Older rows pre-date this field — Zod `.default()` backfills on parse so templates
  // can read `spec.layout` unconditionally (no scattered `?? DEFAULT_LAYOUT` checks).
  layout: videoSpecLayoutZ.default(DEFAULT_LAYOUT),
  /** Legacy: repeated when ``pausesSec`` is absent or wrong length. */
  gapBetweenBlocksSec: z.number().min(0).max(5).default(0),
  /** One value per text block (sorted by ``startSec``): silence before that block (index 0 = after hook). */
  pausesSec: z.array(z.number().min(0).max(5)).max(24).optional(),
  totalSec: z.number(),
});

export type VideoSpec = z.infer<typeof videoSpecZ>;

export function parseVideoSpec(raw: unknown): VideoSpec | null {
  const r = videoSpecZ.safeParse(raw);
  if (!r.success) {
    // Loud failure — silent fallthrough here previously masked nullability bugs
    // (e.g. `brand.accent: null` failing `.optional()`) for hours of debugging.
    if (typeof console !== "undefined") {
      console.warn("[video-spec] parseVideoSpec rejected payload:", r.error.flatten(), raw);
    }
    return null;
  }
  return r.data;
}

/** Same resolution order as backend ``_session_hook_text`` (video_spec_defaults.py):
 *  DB ``hooks[0].text`` → persisted ``video_spec.hook.text`` → chosen angle ``draft_hook``.
 *  Keeps Step 1 "Hook" row in sync with the Remotion preview when spec PATCH updated
 *  hook but ``hooks`` JSON was not written yet (legacy rows / race). */
export function sessionPrimaryHookText(s: {
  hooks?: Array<{ text?: string | null }> | null;
  video_spec?: unknown;
  angles?: unknown;
  chosen_angle_index?: number | null;
}): string {
  const fromHooks = String(s.hooks?.[0]?.text ?? "").trim();
  if (fromHooks) return fromHooks;
  const parsed = parseVideoSpec(s.video_spec);
  const fromSpec = String(parsed?.hook.text ?? "").trim();
  if (fromSpec) return fromSpec;
  const angles = Array.isArray(s.angles) ? s.angles : [];
  let idx = Number(s.chosen_angle_index ?? 0);
  if (!Number.isFinite(idx)) idx = 0;
  idx = Math.trunc(idx);
  const ang = angles[idx];
  if (ang && typeof ang === "object" && ang !== null) {
    const dh = String((ang as { draft_hook?: string | null }).draft_hook ?? "").trim();
    if (dh) return dh;
  }
  return "";
}

export function applyVideoSpecPatch(spec: VideoSpec, ops: Operation[]): VideoSpec {
  const next = applyPatch(structuredClone(spec), ops, false, true).newDocument;
  return videoSpecZ.parse(next);
}

/** Rough client preview when API has not persisted `video_spec` yet. */
export function buildPreviewSpecFromSession(s: {
  background_url?: string | null;
  background_type?: string | null;
  broll_clip_id?: string | null;
  hooks?: Array<{ text?: string | null }> | null;
  text_blocks?: Array<{ text?: string; isCTA?: boolean }> | null;
  source_format_key?: string | null;
  source_type?: string | null;
  video_spec?: unknown;
  angles?: unknown;
  chosen_angle_index?: number | null;
}): VideoSpec | null {
  const bg = (s.background_url ?? "").trim();
  if (!bg) return null;
  const hookText = sessionPrimaryHookText({
    hooks: s.hooks,
    video_spec: s.video_spec,
    angles: s.angles,
    chosen_angle_index: s.chosen_angle_index,
  });
  const tb = (s.text_blocks ?? []).filter((x) => x && String(x.text ?? "").trim());
  const hookS = 3;
  const gap = 0;
  let cursor = hookS;
  const blocks: VideoSpec["blocks"] = [];
  for (let i = 0; i < tb.length; i += 1) {
    const text = String(tb[i]?.text ?? "").trim();
    if (!text) continue;
    const w = text.split(/\s+/).filter(Boolean).length;
    const dur = Math.min(4.5, Math.max(1.4, w * 0.35 + 0.8));
    cursor += gap;
    const start = cursor;
    const end = start + dur;
    cursor = end;
    blocks.push({
      id: `preview-${i}`,
      text,
      isCTA: Boolean(tb[i]?.isCTA),
      startSec: start,
      endSec: end,
      animation: tb[i]?.isCTA ? "pop" : "fade",
    });
  }
  const fk = (s.source_format_key ?? "").toLowerCase();
  const templateId =
    fk === "b_roll_reel" || s.background_type === "broll" ? "bottom-card" : "centered-pop";
  const kind =
    s.background_type === "broll" || (s.broll_clip_id && !s.background_type) ? "video" : "image";
  const totalSec = Math.max(hookS + 2, cursor + 1);
  return {
    v: 1,
    templateId: templateId as VideoSpec["templateId"],
    themeId: "bold-modern",
    brand: { primary: "#ffffff" },
    background: { url: bg, kind, focalPoint: "center" },
    hook: { text: hookText, durationSec: hookS },
    blocks,
    layout: DEFAULT_LAYOUT,
    gapBetweenBlocksSec: 0,
    totalSec,
  };
}
