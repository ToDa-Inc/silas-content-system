import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadPatrickHand } from '@remotion/google-fonts/PatrickHand';
import { loadFont as loadPlayfairDisplay } from '@remotion/google-fonts/PlayfairDisplay';
import { loadFont as loadPoppins } from '@remotion/google-fonts/Poppins';
import type { VideoSpec } from '../schema';

const { fontFamily: poppins } = loadPoppins('normal', { weights: ['700', '800', '900'], subsets: ['latin', 'latin-ext'] });
const { fontFamily: inter } = loadInter('normal', { weights: ['700', '800', '900'], subsets: ['latin', 'latin-ext'] });
const { fontFamily: playfair } = loadPlayfairDisplay('normal', { weights: ['700', '800'], subsets: ['latin', 'latin-ext'] });
const { fontFamily: patrickHand } = loadPatrickHand('normal', { weights: ['400'], subsets: ['latin', 'latin-ext'] });

const emojiFallback = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji"';

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
  bodyFontStack: `"${poppins}", ${emojiFallback}, sans-serif`,
  hookFontStack: `"${poppins}", ${emojiFallback}, sans-serif`,
  ctaScale: 0.87,
  bodyScale: 1,
};

const editorial: ThemeTokens = {
  cardBg: '#faf8f5',
  cardText: '#1a1a1a',
  overlayText: '#faf8f5',
  overlayStroke: '#1a1a1a',
  bodyFontStack: `"${playfair}", ${emojiFallback}, Georgia, serif`,
  hookFontStack: `"${playfair}", ${emojiFallback}, Georgia, serif`,
  ctaScale: 0.85,
  bodyScale: 0.95,
};

const casualHand: ThemeTokens = {
  cardBg: 'transparent',
  cardText: '#ffffff',
  overlayText: '#ffffff',
  overlayStroke: '#000000',
  bodyFontStack: `"${patrickHand}", ${emojiFallback}, cursive`,
  hookFontStack: `"${patrickHand}", ${emojiFallback}, cursive`,
  ctaScale: 0.9,
  bodyScale: 1,
};

const cleanMinimal: ThemeTokens = {
  cardBg: 'rgba(20,20,20,0.55)',
  cardText: '#ffffff',
  overlayText: '#ffffff',
  overlayStroke: 'rgba(0,0,0,0.6)',
  bodyFontStack: `"${inter}", ${emojiFallback}, sans-serif`,
  hookFontStack: `"${inter}", ${emojiFallback}, sans-serif`,
  ctaScale: 0.88,
  bodyScale: 1,
};

/** Font family override (same faces loaded as theme presets). */
export type AppearanceFontId = 'poppins' | 'inter' | 'playfair' | 'patrick';

function fontPair(face: string, generic: string): Pick<ThemeTokens, 'bodyFontStack' | 'hookFontStack'> {
  const stack = `"${face}", ${emojiFallback}, ${generic}`;
  return { bodyFontStack: stack, hookFontStack: stack };
}

export function fontStacksForAppearanceFontId(id: AppearanceFontId): Pick<ThemeTokens, 'bodyFontStack' | 'hookFontStack'> {
  switch (id) {
    case 'inter':
      return fontPair(inter, 'sans-serif');
    case 'playfair':
      return fontPair(playfair, 'Georgia, serif');
    case 'patrick':
      return fontPair(patrickHand, 'cursive');
    case 'poppins':
    default:
      return fontPair(poppins, 'sans-serif');
  }
}

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
