import React from 'react';
import { AbsoluteFill } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Poppins';
import type { VideoSpecWithTimeline } from '../templateProps';
import { resolveTheme } from '../themes';
import { blockEntranceStyle } from '../animations';
import { resolveLayoutPx } from '../layout';

const { fontFamily } = loadFont('normal', { weights: ['700', '800'] });

export default function BottomCardTemplate({ spec, frame, fps }: VideoSpecWithTimeline) {
  const sec = frame / fps;
  const theme = resolveTheme(spec);
  const layout = resolveLayoutPx(spec);
  const hookDur = spec.hook.durationSec;
  const showHook = sec < hookDur;

  const inWindow = spec.blocks.filter((b) => sec >= b.startSec && sec < b.endSec);
  const activeBlock = [...inWindow].sort((a, b) => b.startSec - a.startSec)[0];

  const activeText = showHook ? spec.hook.text : activeBlock?.text;
  const isCTA = !showHook && !!activeBlock?.isCTA;
  const startFrame = showHook ? 0 : Math.round((activeBlock?.startSec ?? 0) * fps);
  const anim = (showHook ? 'fade' : activeBlock?.animation ?? 'fade') as
    | 'pop'
    | 'fade'
    | 'slide-up'
    | 'none';
  const animStyle = blockEntranceStyle(frame, fps, startFrame, anim);

  const baseSize = 60;
  const ctaScaled = isCTA ? Math.round(baseSize * theme.ctaScale) : baseSize;
  const fontSize = Math.round(ctaScaled * layout.scale);

  const anchor = layout.verticalAnchor;
  const pad = '160px';

  const textShell = activeText ? (
    <div
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
          fontFamily,
          color: theme.cardText,
          margin: 0,
          lineHeight: 1.25,
          letterSpacing: '-0.01em',
          WebkitFontSmoothing: 'antialiased',
          textRendering: 'optimizeLegibility',
          wordWrap: 'break-word',
          overflowWrap: 'break-word',
        }}
      >
        {activeText}
      </p>
    </div>
  ) : null;

  const bottomGradient = activeText ? (
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

  const centerVignette = activeText ? (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.45) 100%)',
        pointerEvents: 'none',
      }}
    />
  ) : null;

  const topGradient = activeText ? (
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
        {textShell}
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
        {textShell}
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
        {textShell}
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
