import { AbsoluteFill } from 'remotion';
import type { VideoSpecWithTimeline } from '../templateProps';
import { resolveTheme } from '../themes';
import { blockEntranceStyle } from '../animations';
import { flexAlignForTextAlign } from '../alignLayout';
import { resolveLayoutPx } from '../layout';

export default function CenteredPopTemplate({ spec, frame, fps }: VideoSpecWithTimeline) {
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

  const baseSize = showHook ? 68 : 60;
  const ctaScaled = isCTA ? Math.round(baseSize * theme.ctaScale) : baseSize;
  const fontSize = Math.round(ctaScaled * layout.scale);
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
          background:
            'radial-gradient(ellipse at center, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.5) 100%)',
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
        {activeText ? (
          <div
            style={{
              opacity: animStyle.opacity,
              transform: animStyle.transform,
            }}
          >
            <p
              style={{
                fontSize,
                fontWeight: 900,
                color: theme.overlayText,
                margin: 0,
                padding: 0,
                fontFamily: theme.bodyFontStack,
                lineHeight: showHook ? 1.1 : 1.15,
                letterSpacing: showHook ? '-1.5px' : '-1px',
                maxWidth: '100%',
                WebkitTextStroke: `2.5px ${theme.overlayStroke}`,
                paintOrder: 'stroke fill',
                WebkitFontSmoothing: 'antialiased',
                textRendering: 'optimizeLegibility',
                wordWrap: 'break-word',
                overflowWrap: 'break-word',
              }}
            >
              {activeText}
            </p>
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}
