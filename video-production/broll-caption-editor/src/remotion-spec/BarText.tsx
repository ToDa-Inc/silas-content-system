import { AbsoluteFill } from 'remotion';
import type { VideoSpec } from './schema';
import { resolveAppearance } from './appearance';
import { blockEntranceStyle } from './animations';
import { activeCaptionLayers, beatFontScaleMult } from './activeLayers';
import { resolveLayoutPx } from './layout';
import { BAR_SIDE_PAD } from './framing';

/**
 * Text for the black bars of framed layouts (letterbox / 4:5). Templates position text
 * with full-canvas pixel math, so inside a short bar they would land off-box. Here the
 * active layers are simply centred in the bar, using the spec's theme font and colours.
 */
export default function BarText({
  spec,
  frame,
  fps,
  barHeight,
}: {
  spec: VideoSpec;
  frame: number;
  fps: number;
  barHeight: number;
}) {
  const sec = frame / fps;
  const theme = resolveAppearance(spec);
  const layout = resolveLayoutPx(spec);
  const layers = activeCaptionLayers(spec, sec);
  if (!layers.length) return null;
  // Fit up to ~4 lines (line-height 1.15) inside the bar with vertical padding.
  const padY = Math.round(barHeight * 0.08);
  const maxSize = Math.max(28, Math.min(64, Math.round((barHeight - padY * 2) / (4 * 1.15))));

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        paddingLeft: Math.max(layout.paddingPx, BAR_SIDE_PAD),
        paddingRight: Math.max(layout.paddingPx, BAR_SIDE_PAD),
        paddingTop: padY,
        paddingBottom: padY,
        boxSizing: 'border-box',
        gap: layout.stackGapPx,
        pointerEvents: 'none',
      }}
    >
      {layers.map((layer) => {
        const startFrame = Math.round(layer.startSec * fps);
        const anim = blockEntranceStyle(frame, fps, startFrame, layer.animation);
        const base = layer.kind === 'hook' ? maxSize : Math.round(maxSize * 0.85);
        const ctaScaled = layer.isCTA ? Math.round(base * theme.ctaScale) : base;
        const fontSize = Math.round(ctaScaled * beatFontScaleMult(layer) * layout.scale);
        return (
          <p
            key={layer.key}
            style={{
              margin: 0,
              maxWidth: 1080 - 2 * Math.max(layout.paddingPx, BAR_SIDE_PAD),
              fontSize,
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
              color: '#ffffff',
              fontFamily: layer.kind === 'hook' ? theme.hookFontStack : theme.bodyFontStack,
              textAlign: layout.textAlign,
              wordWrap: 'break-word',
              overflowWrap: 'break-word',
              opacity: anim.opacity,
              transform: anim.transform,
            }}
          >
            {layer.text}
          </p>
        );
      })}
    </AbsoluteFill>
  );
}
