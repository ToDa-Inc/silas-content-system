/**
 * Media framing inside the 1080×1920 canvas, kept clear of Instagram's own UI.
 *
 * Instagram safe area (same model as the editor's safe-zone overlay): text stays between
 * y 160 and y 1680, and clear of the right action column (x ≥ 880 for y 520–1420).
 *
 * - full:      media fills the frame (default); templates place the text.
 * - letterbox: 16:9 band centred vertically. Hook in the safe part of the top bar,
 *              captions in the safe part of the bottom bar.
 * - four_five: 4:5 picture (1080×1350) centred. Its 285px bars are too thin to hold text
 *              safely, so the chosen template places hook and captions over the picture.
 */
import type { VideoFraming } from './schema';

const W = 1080;
const H = 1920;
export const SAFE_TOP = 160;
export const SAFE_BOTTOM = 1680;
/** Side padding for bar text: clears the right action column (1080 − 880). */
export const BAR_SIDE_PAD = 200;

export type FramingBox = { top: number; height: number };

export type FramingGeometry = {
  media: FramingBox;
  /** Where hook text goes; null = the template places it over the picture. */
  hookBar: FramingBox | null;
  /** Where caption text goes; null = the template places it over the picture. */
  captionBar: FramingBox | null;
};

export function resolveFraming(framing: VideoFraming | undefined | null): VideoFraming {
  return framing === 'letterbox' || framing === 'four_five' ? framing : 'full';
}

export function framingGeometry(framing: VideoFraming | undefined | null): FramingGeometry | null {
  const f = resolveFraming(framing);
  if (f === 'full') return null;
  const mediaH = f === 'letterbox' ? Math.round((W * 9) / 16) : Math.round((W * 5) / 4);
  const top = Math.round((H - mediaH) / 2);
  const media = { top, height: mediaH };
  if (f === 'four_five') return { media, hookBar: null, captionBar: null };
  const bottomOfMedia = top + mediaH;
  return {
    media,
    hookBar: { top: SAFE_TOP, height: top - SAFE_TOP },
    captionBar: { top: bottomOfMedia, height: SAFE_BOTTOM - bottomOfMedia },
  };
}
