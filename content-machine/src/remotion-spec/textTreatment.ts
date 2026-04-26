import type { CSSProperties } from "react";
import type { VideoSpec } from "./schema";

export function isBoldOutlineTreatment(spec: VideoSpec): boolean {
  return spec.textTreatment === "bold-outline";
}

/** Centered / overlay captions (no card shell). */
export function overlayBoldOutlineCaptionStyle(spec: VideoSpec): CSSProperties {
  if (!isBoldOutlineTreatment(spec)) return {};
  return {
    WebkitTextStroke: "4px rgba(0,0,0,0.92)",
    paintOrder: "stroke fill",
    textShadow: "0 6px 22px rgba(0,0,0,0.55)",
  };
}

/** Text inside a filled card (bottom-card, stack, top-banner). */
export function cardBoldOutlineCaptionStyle(spec: VideoSpec): CSSProperties {
  if (!isBoldOutlineTreatment(spec)) return {};
  return {
    WebkitTextStroke: "3px rgba(0,0,0,0.85)",
    paintOrder: "stroke fill",
    textShadow: "0 4px 16px rgba(0,0,0,0.28)",
  };
}
