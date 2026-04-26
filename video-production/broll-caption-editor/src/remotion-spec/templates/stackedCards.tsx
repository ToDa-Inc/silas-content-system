import React from 'react';
import { AbsoluteFill } from 'remotion';
import type { VideoSpecWithTimeline } from '../templateProps';
import { resolveAppearance } from '../appearance';
import { blockEntranceStyle } from '../animations';
import { flexAlignForTextAlign } from '../alignLayout';
import { resolveLayoutPx } from '../layout';
import { cardBoldOutlineCaptionStyle, isBoldOutlineTreatment } from '../textTreatment';

export default function StackedCardsTemplate({ spec, frame, fps }: VideoSpecWithTimeline) {
  const sec = frame / fps;
  const theme = resolveAppearance(spec);
  const layout = resolveLayoutPx(spec);

  type Row = {
    key: string;
    text: string;
    isCTA: boolean;
    startSec: number;
    anim: 'pop' | 'fade' | 'slide-up' | 'none';
  };

  const rows: Row[] = [];
  const hookText = String(spec.hook.text ?? '').trim();
  // Cumulative stack: hook is always the first card (when present); beats that have
  // started by ``sec`` append below. Previously we used if/else so the hook vanished
  // after ``hookDur`` and only blocks stacked — that excluded the hook from the stack.
  if (hookText) {
    rows.push({ key: 'hook', text: spec.hook.text, isCTA: false, startSec: 0, anim: 'fade' });
  }
  const sorted = [...spec.blocks].sort((a, b) => a.startSec - b.startSec);
  for (const b of sorted) {
    if (b.startSec <= sec && String(b.text ?? '').trim()) {
      rows.push({
        key: b.id,
        text: b.text,
        isCTA: b.isCTA,
        startSec: b.startSec,
        anim: (b.animation ?? 'fade') as Row['anim'],
      });
    }
  }

  const baseSize = 60;
  const ta = layout.textAlign;
  const colAlign = flexAlignForTextAlign(ta);
  const pad = '160px';

  const card = (row: Row) => {
    const startFrame = Math.round(row.startSec * fps);
    const animStyle = blockEntranceStyle(frame, fps, startFrame, row.anim);
    const fontSize = Math.round((row.isCTA ? baseSize * theme.ctaScale : baseSize) * layout.scale);
    return (
      <div
        key={row.key}
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
          {row.text}
        </p>
      </div>
    );
  };

  const stack =
    rows.length === 0 ? null : (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: colAlign,
          gap: layout.stackGapPx,
          width: '100%',
        }}
      >
        {rows.map((r) => card(r))}
      </div>
    );

  const bottomGradient = stack ? (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: '48%',
        background: 'linear-gradient(to top, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0) 100%)',
        pointerEvents: 'none',
      }}
    />
  ) : null;

  /** Same visual weight as the 48% edge bands — avoids full-frame scrim when Pin = middle. */
  const centerBandOverlay = stack ? (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: '26%',
        height: '48%',
        background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.12) 55%, rgba(0,0,0,0) 100%)',
        pointerEvents: 'none',
      }}
    />
  ) : null;

  const topGradient = stack ? (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        height: '48%',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0) 100%)',
        pointerEvents: 'none',
      }}
    />
  ) : null;

  const anchor = layout.verticalAnchor;

  let overlay: React.ReactNode = null;
  if (anchor === 'center') {
    overlay = centerBandOverlay;
  } else if (anchor === 'top') {
    overlay = topGradient;
  } else {
    overlay = bottomGradient;
  }

  let textWrap: React.ReactNode = null;
  if (anchor === 'top') {
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
        {stack}
      </div>
    );
  } else if (anchor === 'center') {
    textWrap = (
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          paddingTop: pad,
          paddingBottom: pad,
          paddingLeft: layout.paddingPx,
          paddingRight: layout.paddingPx,
          boxSizing: 'border-box',
          pointerEvents: 'none',
          transform: layout.translateY,
        }}
      >
        {stack}
      </div>
    );
  } else {
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
        {stack}
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
