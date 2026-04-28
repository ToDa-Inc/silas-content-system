import { AbsoluteFill } from 'remotion';
import type { VideoSpecWithTimeline } from '../templateProps';
import { resolveAppearance } from '../appearance';
import { blockEntranceStyle } from '../animations';
import { flexAlignForTextAlign } from '../alignLayout';
import { resolveLayoutPx } from '../layout';
import { isBoldOutlineTreatment, overlayBoldOutlineCaptionStyle } from '../textTreatment';
import { activeCaptionLayers } from '../activeLayers';

export default function CenteredPopTemplate({ spec, frame, fps }: VideoSpecWithTimeline) {
  const sec = frame / fps;
  const theme = resolveAppearance(spec);
  const layout = resolveLayoutPx(spec);
  const layers = activeCaptionLayers(spec, sec);
  const ta = layout.textAlign;
  const cross = flexAlignForTextAlign(ta);

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: cross,
      }}
    >
      <AbsoluteFill
        style={{
          background: isBoldOutlineTreatment(spec)
            ? 'radial-gradient(ellipse at center, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.55) 100%)'
            : 'radial-gradient(ellipse at center, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.5) 100%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          zIndex: 10,
          textAlign: ta,
          width: '100%',
          maxWidth: '100%',
          paddingLeft: layout.paddingPx,
          paddingRight: layout.paddingPx,
          boxSizing: 'border-box',
          transform: layout.translateY,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: layout.stackGapPx, alignItems: cross }}>
          {layers.map((layer) => {
            const startFrame = Math.round(layer.startSec * fps);
            const animStyle = blockEntranceStyle(frame, fps, startFrame, layer.animation);
            const baseSize = layer.kind === 'hook' ? 68 : 60;
            const ctaScaled = layer.isCTA ? Math.round(baseSize * theme.ctaScale) : baseSize;
            const fontSize = Math.round(ctaScaled * layout.scale);
            return (
              <p
                key={layer.key}
              style={{
                fontSize,
                fontWeight: 900,
                color: theme.overlayText,
                margin: 0,
                padding: 0,
                fontFamily: theme.bodyFontStack,
                lineHeight: layer.kind === 'hook' ? 1.1 : 1.15,
                letterSpacing: layer.kind === 'hook' ? '-1.5px' : '-1px',
                maxWidth: '100%',
                opacity: animStyle.opacity,
                transform: animStyle.transform,
                ...(isBoldOutlineTreatment(spec)
                  ? overlayBoldOutlineCaptionStyle(spec)
                  : {
                      WebkitTextStroke: `2.5px ${theme.overlayStroke}`,
                      paintOrder: 'stroke fill' as const,
                    }),
                WebkitFontSmoothing: 'antialiased',
                textRendering: 'optimizeLegibility',
                wordWrap: 'break-word',
                overflowWrap: 'break-word',
              }}
            >
              {layer.text}
            </p>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}
