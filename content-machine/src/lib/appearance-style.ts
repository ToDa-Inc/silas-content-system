/**
 * Curated “Style” UI → low-level `VideoSpec.appearance` values.
 * Keep hex/rgba here only — never surface these strings in the dashboard UI.
 */

import type { VideoSpecAppearance } from "./video-spec";

export type VideoThemeId = "bold-modern" | "editorial" | "casual-hand" | "clean-minimal";

export type FontMoodId = "auto" | "modern" | "clean" | "editorial" | "hand";
export type ContrastId = "auto" | "light" | "dark";

export const GLASS_CARD_BG = "rgba(20,20,20,0.55)";

/** Text stack for light-on-dark (high legibility on dark surfaces). */
export const LIGHT_ON_DARK_TEXT: Pick<VideoSpecAppearance, "cardTextColor" | "overlayTextColor" | "overlayStroke"> = {
  cardTextColor: "#ffffff",
  overlayTextColor: "#ffffff",
  overlayStroke: "#000000",
};

/** Text stack for dark-on-light (high legibility on light surfaces). */
export const DARK_ON_LIGHT_TEXT: Pick<VideoSpecAppearance, "cardTextColor" | "overlayTextColor" | "overlayStroke"> = {
  cardTextColor: "#0a0a0a",
  overlayTextColor: "#0a0a0a",
  overlayStroke: "rgba(255,255,255,0.9)",
};

/** Dark card surface paired with LIGHT_ON_DARK_TEXT (atomic preset). */
export const LIGHT_ON_DARK_CARD_BG = "rgba(20,20,20,0.72)";

/**
 * Light card surface for the “Dark on light” contrast preset — always a light
 * panel so dark text stays readable (never a dark fill).
 */
export function lightReadableCardBgForTheme(themeId: VideoThemeId): string {
  switch (themeId) {
    case "editorial":
      return "#faf8f5";
    case "casual-hand":
      return "#fffef8";
    case "clean-minimal":
      return "#f4f4f5";
    case "bold-modern":
    default:
      return "#ffffff";
  }
}

/** Templates where text sits on a filled “card” surface (contrast must set cardBg too). */
export function templateUsesCardSurface(templateId: string): boolean {
  return templateId === "bottom-card" || templateId === "top-banner" || templateId === "stacked-cards";
}

function normColor(s: string | null | undefined): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function colorsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  return normColor(a) === normColor(b);
}

export function inferFontMood(a: VideoSpecAppearance): FontMoodId {
  const f = a.fontId;
  if (!f) return "auto";
  if (f === "poppins") return "modern";
  if (f === "inter") return "clean";
  if (f === "playfair") return "editorial";
  if (f === "patrick") return "hand";
  return "auto";
}

export function inferContrast(
  a: VideoSpecAppearance,
  templateId: string,
  themeId: VideoThemeId,
): ContrastId {
  const cardLike = templateUsesCardSurface(templateId);
  const hasText = Boolean(
    (a.cardTextColor && a.cardTextColor.trim()) ||
      (a.overlayTextColor && a.overlayTextColor.trim()) ||
      (a.overlayStroke && a.overlayStroke.trim()),
  );
  const hasBg = Boolean(a.cardBg && a.cardBg.trim());
  if (!hasText && (!cardLike || !hasBg)) return "auto";

  const lightText =
    colorsEqual(a.cardTextColor, LIGHT_ON_DARK_TEXT.cardTextColor) &&
    colorsEqual(a.overlayTextColor, LIGHT_ON_DARK_TEXT.overlayTextColor) &&
    colorsEqual(a.overlayStroke, LIGHT_ON_DARK_TEXT.overlayStroke);
  const darkText =
    colorsEqual(a.cardTextColor, DARK_ON_LIGHT_TEXT.cardTextColor) &&
    colorsEqual(a.overlayTextColor, DARK_ON_LIGHT_TEXT.overlayTextColor) &&
    colorsEqual(a.overlayStroke, DARK_ON_LIGHT_TEXT.overlayStroke);

  if (lightText && (!cardLike || colorsEqual(a.cardBg, LIGHT_ON_DARK_CARD_BG))) return "light";
  if (darkText && (!cardLike || colorsEqual(a.cardBg, lightReadableCardBgForTheme(themeId)))) return "dark";
  return "auto";
}

export type AppearanceOp = { key: keyof VideoSpecAppearance; value: string | null };

export type ContrastContext = {
  templateId: string;
  themeId: VideoThemeId;
};

export function opsForContrast(id: ContrastId, ctx: ContrastContext): AppearanceOp[] {
  if (id === "auto") {
    return [
      { key: "cardTextColor", value: null },
      { key: "overlayTextColor", value: null },
      { key: "overlayStroke", value: null },
      { key: "cardBg", value: null },
    ];
  }
  const cardLike = templateUsesCardSurface(ctx.templateId);
  if (id === "light") {
    const t = LIGHT_ON_DARK_TEXT;
    const base: AppearanceOp[] = [
      { key: "cardTextColor", value: t.cardTextColor ?? null },
      { key: "overlayTextColor", value: t.overlayTextColor ?? null },
      { key: "overlayStroke", value: t.overlayStroke ?? null },
    ];
    if (cardLike) base.push({ key: "cardBg", value: LIGHT_ON_DARK_CARD_BG });
    else base.push({ key: "cardBg", value: null });
    return base;
  }
  const t = DARK_ON_LIGHT_TEXT;
  const base: AppearanceOp[] = [
    { key: "cardTextColor", value: t.cardTextColor ?? null },
    { key: "overlayTextColor", value: t.overlayTextColor ?? null },
    { key: "overlayStroke", value: t.overlayStroke ?? null },
  ];
  if (cardLike) base.push({ key: "cardBg", value: lightReadableCardBgForTheme(ctx.themeId) });
  else base.push({ key: "cardBg", value: null });
  return base;
}

export function opsForFontMood(id: FontMoodId): AppearanceOp[] {
  if (id === "auto") return [{ key: "fontId", value: null }];
  const map: Record<Exclude<FontMoodId, "auto">, VideoSpecAppearance["fontId"]> = {
    modern: "poppins",
    clean: "inter",
    editorial: "playfair",
    hand: "patrick",
  };
  const fontId = map[id];
  return [{ key: "fontId", value: fontId ?? null }];
}

/** All appearance fields cleared (JSON Patch replace → null). */
export const APPEARANCE_CLEAR_OPS: AppearanceOp[] = [
  { key: "fontId", value: null },
  { key: "cardTextColor", value: null },
  { key: "overlayTextColor", value: null },
  { key: "cardBg", value: null },
  { key: "overlayStroke", value: null },
];

export function appearanceOpsToPatchOps(ops: AppearanceOp[]): { op: "replace"; path: string; value: string | null }[] {
  return ops.map(({ key, value }) => ({
    op: "replace" as const,
    path: `/appearance/${String(key)}`,
    value,
  }));
}

export function mergeAppearanceOpsIntoDraft(
  prev: VideoSpecAppearance,
  ops: AppearanceOp[],
): VideoSpecAppearance {
  const next: VideoSpecAppearance = { ...prev };
  const rec = next as Record<string, string | undefined>;
  for (const { key, value } of ops) {
    if (value === null || value === "") {
      delete rec[String(key)];
    } else {
      rec[String(key)] = value;
    }
  }
  return next;
}
