import type { CSSProperties } from 'react';
import type { VideoSpec } from './schema';

export function isBoldOutlineTreatment(spec: VideoSpec): boolean {
  return spec.textTreatment === 'bold-outline';
}

export function overlayBoldOutlineCaptionStyle(spec: VideoSpec): CSSProperties {
  if (!isBoldOutlineTreatment(spec)) return {};
  return {
    WebkitTextStroke: '4px rgba(0,0,0,0.92)',
    paintOrder: 'stroke fill',
    textShadow: '0 6px 22px rgba(0,0,0,0.55)',
  };
}

export function cardBoldOutlineCaptionStyle(spec: VideoSpec): CSSProperties {
  if (!isBoldOutlineTreatment(spec)) return {};
  return {
    WebkitTextStroke: '3px rgba(0,0,0,0.85)',
    paintOrder: 'stroke fill',
    textShadow: '0 4px 16px rgba(0,0,0,0.28)',
  };
}
