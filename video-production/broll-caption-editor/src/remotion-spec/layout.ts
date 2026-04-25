/**
 * Layout math shared by every template + the preview overlay.
 *
 * Templates render at native composition resolution (1080×1920) so layout values
 * always resolve to absolute pixels — `<Player>` scales the result for us.
 */
import {
  resolveLayout,
  type StackGrowth,
  type TextAlign,
  type VideoSpec,
  type VideoSpecLayout,
} from './schema';

export const COMP_W = 1080;
export const COMP_H = 1920;

export type ResolvedLayout = {
  /** Per-side horizontal padding in px (mirrors `paddingLeft` / `paddingRight`). */
  paddingPx: number;
  /** Inner content width in px after subtracting both side paddings. */
  innerWidth: number;
  /** Coarse anchor for templates that support it (e.g. bottom-card). */
  verticalAnchor: NonNullable<VideoSpecLayout['verticalAnchor']>;
  /** Vertical translate in px applied to the text container (negative = up). */
  offsetPx: number;
  /** Multiplier applied to template `fontSize`. */
  scale: number;
  /** Fine nudge only: ``translateY(offsetPx)`` — templates compose with anchor geometry. */
  translateY: string;
  /** Caption line alignment (all templates). */
  textAlign: TextAlign;
  /** Vertical gap between stacked caption cards, in px. */
  stackGapPx: number;
  /** stacked-cards list growth (see schema). */
  stackGrowth: StackGrowth;
  /** Raw resolved layout (mirrors VideoSpecLayout). */
  raw: VideoSpecLayout;
};

export function resolveLayoutPx(spec: VideoSpec): ResolvedLayout {
  const raw = resolveLayout(spec);
  const paddingPx = Math.round(raw.sidePadding * COMP_W);
  const offsetPx = Math.round(raw.verticalOffset * COMP_H);
  const verticalAnchor = raw.verticalAnchor ?? 'bottom';
  const stackGapPx = Math.round(raw.stackGap * COMP_H);
  return {
    paddingPx,
    innerWidth: COMP_W - paddingPx * 2,
    verticalAnchor,
    offsetPx,
    scale: raw.scale,
    translateY: `translateY(${offsetPx}px)`,
    textAlign: raw.textAlign,
    stackGapPx,
    stackGrowth: raw.stackGrowth,
    raw,
  };
}
