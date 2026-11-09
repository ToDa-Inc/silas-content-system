import { AbsoluteFill } from 'remotion';
import type { VideoSpecWithTimeline } from '../templateProps';
import { mergeLayerAppearance } from '../appearance';
import { blockEntranceStyle } from '../animations';
import { flexAlignForTextAlign } from '../alignLayout';
import { resolveLayoutPx } from '../layout';
import { isBoldOutlineLayer, overlayBoldOutlineCaptionStyle } from '../textTreatment';
import { activeCaptionLayers, beatFontScaleMult } from '../activeLayers';

export default function CenteredPopTemplate({ spec, frame, fps, canvasH }: VideoSpecWithTimeline) {
  const sec = frame / fps;
  const layout = resolveLayoutPx(spec, canvasH);
  const layers = activeCaptionLayers(spec, sec);
  const strongBg = layers.some((l) => isBoldOutlineLayer(spec, l));
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
          background: strongBg
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
            const layerTheme = mergeLayerAppearance(spec, layer.kind === 'block' ? layer.appearance : null);
            const startFrame = Math.round(layer.startSec * fps);
            const animStyle = blockEntranceStyle(frame, fps, startFrame, layer.animation);
            const baseSize = layer.kind === 'hook' ? 68 : 60;
            const ctaScaled = layer.isCTA ? Math.round(baseSize * layerTheme.ctaScale) : baseSize;
            const fontSize = Math.round(ctaScaled * beatFontScaleMult(layer) * layout.scale);
            return (
              <p
                key={layer.key}
                style={{
                  fontSize,
                  fontWeight: 900,
                  color: layerTheme.overlayText,
                  margin: 0,
                  padding: 0,
                  fontFamily: layerTheme.bodyFontStack,
                  lineHeight: layer.kind === 'hook' ? 1.1 : 1.15,
                  letterSpacing: layer.kind === 'hook' ? '-1.5px' : '-1px',
                  maxWidth: '100%',
                  opacity: animStyle.opacity,
                  transform: animStyle.transform,
                  ...(isBoldOutlineLayer(spec, layer)
                    ? overlayBoldOutlineCaptionStyle()
                    : {
                        WebkitTextStroke: `2.5px ${layerTheme.overlayStroke}`,
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
