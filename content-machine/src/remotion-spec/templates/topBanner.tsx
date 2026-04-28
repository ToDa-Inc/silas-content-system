import { AbsoluteFill } from 'remotion';
import type { VideoSpecWithTimeline } from '../templateProps';
import { resolveAppearance } from '../appearance';
import { blockEntranceStyle } from '../animations';
import { flexAlignForTextAlign } from '../alignLayout';
import { resolveLayoutPx } from '../layout';
import { cardBoldOutlineCaptionStyle, isBoldOutlineTreatment } from '../textTreatment';
import { activeCaptionLayers } from '../activeLayers';

export default function TopBannerTemplate({ spec, frame, fps }: VideoSpecWithTimeline) {
  const sec = frame / fps;
  const theme = resolveAppearance(spec);
  const layout = resolveLayoutPx(spec);
  const layers = activeCaptionLayers(spec, sec);
  const ta = layout.textAlign;
  const cross = flexAlignForTextAlign(ta);

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          maxHeight: '50%',
          background: 'transparent',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          alignItems: cross,
          paddingTop: '100px',
          paddingLeft: layout.paddingPx,
          paddingRight: layout.paddingPx,
          boxSizing: 'border-box',
          pointerEvents: 'none',
          transform: layout.translateY,
          gap: layout.stackGapPx,
        }}
      >
        {layers.map((layer) => {
          const startFrame = Math.round(layer.startSec * fps);
          const animStyle = blockEntranceStyle(frame, fps, startFrame, layer.animation);
          const baseSize = layer.kind === 'hook' ? 56 : 50;
          const ctaScaled = layer.isCTA ? Math.round(baseSize * theme.ctaScale) : baseSize;
          const fontSize = Math.round(ctaScaled * layout.scale);
          return (
            <div
              key={layer.key}
              style={{
                display: 'inline-block',
                maxWidth: layout.innerWidth,
                backgroundColor: theme.cardBg === 'transparent' ? 'rgba(255,255,255,0.94)' : theme.cardBg,
                borderRadius: '14px',
                padding: '22px 28px',
                opacity: animStyle.opacity,
                transform: animStyle.transform,
              }}
            >
              <p
                style={{
                  fontSize,
                  fontWeight: 800,
                  fontFamily: theme.bodyFontStack,
                  color: theme.cardText,
                  margin: 0,
                  lineHeight: 1.2,
                  letterSpacing: '-0.02em',
                  ...(isBoldOutlineTreatment(spec) ? cardBoldOutlineCaptionStyle(spec) : {}),
                  wordWrap: 'break-word',
                  overflowWrap: 'break-word',
                  textAlign: ta,
                }}
              >
                {layer.text}
              </p>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
