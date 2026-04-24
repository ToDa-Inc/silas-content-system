import React from 'react';
import { AbsoluteFill } from 'remotion';
import type { VideoSpecWithTimeline } from '../templateProps';
import { resolveTheme } from '../themes';
import { blockEntranceStyle } from '../animations';
import { resolveLayoutPx } from '../layout';

/**
 * "Bold stroke" template.
 *
 * Originally rendered word-by-word like CapCut auto-captions, which only makes
 * sense for spoken-word/voiceover videos where each word syncs with audio.
 * For text-overlay posts the whole punchline must land at once with impact —
 * this version keeps the dramatic visual signature (heavy stroke + bold weight
 * + brand-color highlight) but renders the full sentence as a single beat,
 * so it works as a legit fourth template option rather than a misfit.
 */
export default function CapcutHighlightTemplate({ spec, frame, fps }: VideoSpecWithTimeline) {
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
  const anim = (showHook ? 'fade' : activeBlock?.animation ?? 'pop') as
    | 'pop'
    | 'fade'
    | 'slide-up'
    | 'none';
  const animStyle = blockEntranceStyle(frame, fps, startFrame, anim);

  if (!activeText?.trim()) return null;

  const baseSize = showHook ? 70 : 60;
  const ctaScaled = isCTA ? Math.round(baseSize * theme.ctaScale) : baseSize;
  const fontSize = Math.round(ctaScaled * layout.scale);
  const primary = spec.brand?.primary || '#ffffff';
  const highlightColor = isCTA ? primary : '#ffffff';

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <AbsoluteFill
        style={{
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.55) 100%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          zIndex: 2,
          textAlign: 'center',
          paddingLeft: layout.paddingPx,
          paddingRight: layout.paddingPx,
          maxWidth: layout.innerWidth + layout.paddingPx * 2,
          boxSizing: 'border-box',
          transform: layout.translateY,
        }}
      >
        <p
          style={{
            fontSize,
            fontWeight: 900,
            fontFamily: theme.bodyFontStack,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            margin: 0,
            color: highlightColor,
            // Heavy outer stroke = the visual "CapCut" signature without the
            // word-by-word reveal that breaks reading flow on text overlays.
            WebkitTextStroke: '4px rgba(0,0,0,0.92)',
            paintOrder: 'stroke fill',
            textShadow: '0 6px 22px rgba(0,0,0,0.55)',
            opacity: animStyle.opacity,
            transform: animStyle.transform,
            wordWrap: 'break-word',
            overflowWrap: 'break-word',
          }}
        >
          {activeText}
        </p>
      </div>
    </AbsoluteFill>
  );
}
