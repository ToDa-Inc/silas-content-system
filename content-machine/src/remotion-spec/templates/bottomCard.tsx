import React from 'react';
import { AbsoluteFill } from 'remotion';
import type { VideoSpecWithTimeline } from '../templateProps';
import { resolveAppearance } from '../appearance';
import { blockEntranceStyle } from '../animations';
import { flexAlignForTextAlign } from '../alignLayout';
import { resolveLayoutPx } from '../layout';
import { cardBoldOutlineCaptionStyle, isBoldOutlineTreatment } from '../textTreatment';
import { activeCaptionLayers, type ActiveCaptionLayer } from '../activeLayers';

export default function BottomCardTemplate({ spec, frame, fps }: VideoSpecWithTimeline) {
  const sec = frame / fps;
  const theme = resolveAppearance(spec);
  const layout = resolveLayoutPx(spec);
  const layers = activeCaptionLayers(spec, sec);
  const baseSize = 60;

  const anchor = layout.verticalAnchor;
  const pad = '160px';
  const ta = layout.textAlign;
  const rowAlign = flexAlignForTextAlign(ta);

  const textShell = (layer: ActiveCaptionLayer) => {
    const startFrame = Math.round(layer.startSec * fps);
    const animStyle = blockEntranceStyle(frame, fps, startFrame, layer.animation);
    const ctaScaled = layer.isCTA ? Math.round(baseSize * theme.ctaScale) : baseSize;
    const fontSize = Math.round(ctaScaled * layout.scale);
    return (
    <div
      key={layer.key}
      style={{
        display: 'inline-block',
        backgroundColor: theme.cardBg === 'transparent' ? '#ffffff' : theme.cardBg,
        borderRadius: '12px',
        padding: '24px 32px',
        maxWidth: layout.innerWidth,
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
          lineHeight: 1.25,
          letterSpacing: '-0.01em',
          ...(isBoldOutlineTreatment(spec) ? cardBoldOutlineCaptionStyle(spec) : {}),
          WebkitFontSmoothing: 'antialiased',
          textRendering: 'optimizeLegibility',
          wordWrap: 'break-word',
          overflowWrap: 'break-word',
          textAlign: ta,
        }}
      >
        {layer.text}
      </p>
    </div>
    );
  };

  const textRow = layers.length > 0 ? (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: rowAlign,
        gap: layout.stackGapPx,
        width: '100%',
      }}
    >
      {layers.map((layer) => textShell(layer))}
    </div>
  ) : null;

  const bottomGradient = layers.length > 0 ? (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: '48%',
        background: 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)',
        pointerEvents: 'none',
      }}
    />
  ) : null;

  const centerVignette = layers.length > 0 ? (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.45) 100%)',
        pointerEvents: 'none',
      }}
    />
  ) : null;

  const topGradient = layers.length > 0 ? (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        height: '48%',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)',
        pointerEvents: 'none',
      }}
    />
  ) : null;

  let overlay: React.ReactNode = null;
  let textWrap: React.ReactNode = null;

  if (anchor === 'center') {
    overlay = centerVignette;
    textWrap = (
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          paddingLeft: layout.paddingPx,
          paddingRight: layout.paddingPx,
          boxSizing: 'border-box',
          pointerEvents: 'none',
          transform: `translateY(calc(-50% + ${layout.offsetPx}px))`,
        }}
      >
        {textRow}
      </div>
    );
  } else if (anchor === 'top') {
    overlay = topGradient;
    textWrap = (
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          paddingTop: pad,
          paddingLeft: layout.paddingPx,
          paddingRight: layout.paddingPx,
          boxSizing: 'border-box',
          pointerEvents: 'none',
          transform: layout.translateY,
        }}
      >
        {textRow}
      </div>
    );
  } else {
    overlay = bottomGradient;
    textWrap = (
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          paddingBottom: pad,
          paddingLeft: layout.paddingPx,
          paddingRight: layout.paddingPx,
          boxSizing: 'border-box',
          pointerEvents: 'none',
          transform: layout.translateY,
        }}
      >
        {textRow}
      </div>
    );
  }

  return (
    <AbsoluteFill>
      {overlay}
      {textWrap}
    </AbsoluteFill>
  );
}
