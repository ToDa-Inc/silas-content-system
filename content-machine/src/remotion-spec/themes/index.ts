import type { VideoSpec } from '../schema';

export type ThemeTokens = {
  cardBg: string;
  cardText: string;
  overlayText: string;
  overlayStroke: string;
  bodyFontStack: string;
  hookFontStack: string;
  ctaScale: number;
  bodyScale: number;
};

const boldModern: ThemeTokens = {
  cardBg: '#ffffff',
  cardText: '#0a0a0a',
  overlayText: '#ffffff',
  overlayStroke: '#000000',
  bodyFontStack: 'system-ui, sans-serif',
  hookFontStack: 'system-ui, sans-serif',
  ctaScale: 0.87,
  bodyScale: 1,
};

const editorial: ThemeTokens = {
  cardBg: '#faf8f5',
  cardText: '#1a1a1a',
  overlayText: '#faf8f5',
  overlayStroke: '#1a1a1a',
  bodyFontStack: 'Georgia, "Times New Roman", serif',
  hookFontStack: 'Georgia, "Times New Roman", serif',
  ctaScale: 0.85,
  bodyScale: 0.95,
};

const casualHand: ThemeTokens = {
  cardBg: 'transparent',
  cardText: '#ffffff',
  overlayText: '#ffffff',
  overlayStroke: '#000000',
  bodyFontStack: '"Comic Sans MS", "Segoe Print", cursive',
  hookFontStack: '"Comic Sans MS", "Segoe Print", cursive',
  ctaScale: 0.9,
  bodyScale: 1,
};

const cleanMinimal: ThemeTokens = {
  cardBg: 'rgba(20,20,20,0.55)',
  cardText: '#ffffff',
  overlayText: '#ffffff',
  overlayStroke: 'rgba(0,0,0,0.6)',
  bodyFontStack: 'system-ui, sans-serif',
  hookFontStack: 'system-ui, sans-serif',
  ctaScale: 0.88,
  bodyScale: 1,
};

export function resolveTheme(spec: VideoSpec): ThemeTokens {
  switch (spec.themeId) {
    case 'editorial':
      return editorial;
    case 'casual-hand':
      return casualHand;
    case 'clean-minimal':
      return cleanMinimal;
    case 'bold-modern':
    default:
      return boldModern;
  }
}
