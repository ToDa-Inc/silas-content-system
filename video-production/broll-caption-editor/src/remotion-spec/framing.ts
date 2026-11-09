/**
 * Media framing inside the 1080×1920 canvas.
 *
 * - full:      media fills the frame (default).
 * - letterbox: 16:9 band centred vertically, black bars above/below.
 *              Hook sits in the top bar, captions in the bottom bar.
 * - four_five: 4:5 picture (1080×1350) centred, black bars of 285px.
 *              Hook sits in the top bar, captions over the picture.
 */
import type { VideoFraming } from './schema';

const W = 1080;
const H = 1920;

export type FramingBox = { top: number; height: number };

export type FramingGeometry = {
  media: FramingBox;
  hook: FramingBox;
  captions: FramingBox;
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
  const hook = { top: 0, height: top };
  const captions =
    f === 'letterbox' ? { top: top + mediaH, height: H - top - mediaH } : media;
  return { media, hook, captions };
}
