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
  /** Horizontal translate in px (from ``textPanX`` × canvas width). */
  offsetXPx: number;
  /** Multiplier applied to template `fontSize`. */
  scale: number;
  /** Fine nudge: ``translate(offsetXPx, offsetY)`` in px (templates may compose with calc). */
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

export function resolveLayoutPx(spec: VideoSpec, canvasH: number = COMP_H): ResolvedLayout {
  const raw = resolveLayout(spec);
  const paddingPx = Math.round(raw.sidePadding * COMP_W);
  const offsetPx = Math.round(raw.verticalOffset * canvasH);
  const offsetXPx = Math.round(raw.textPanX * COMP_W);
  const verticalAnchor = raw.verticalAnchor ?? 'bottom';
  const stackGapPx = Math.round(raw.stackGap * canvasH);
  return {
    paddingPx,
    innerWidth: COMP_W - paddingPx * 2,
    verticalAnchor,
    offsetPx,
    offsetXPx,
    scale: raw.scale,
    translateY: `translate(${offsetXPx}px, ${offsetPx}px)`,
    textAlign: raw.textAlign,
    stackGapPx,
    stackGrowth: raw.stackGrowth,
    raw,
  };
}
