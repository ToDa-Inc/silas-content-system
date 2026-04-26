import { AbsoluteFill } from 'remotion';
import type { VideoSpecWithTimeline } from '../templateProps';
import { resolveAppearance } from '../appearance';
import { blockEntranceStyle } from '../animations';
import { flexAlignForTextAlign } from '../alignLayout';
import { resolveLayoutPx } from '../layout';
import { cardBoldOutlineCaptionStyle, isBoldOutlineTreatment } from '../textTreatment';

export default function TopBannerTemplate({ spec, frame, fps }: VideoSpecWithTimeline) {
  const sec = frame / fps;
  const theme = resolveAppearance(spec);
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
  const baseSize = showHook ? 56 : 50;
  const ctaScaled = isCTA ? Math.round(baseSize * theme.ctaScale) : baseSize;
  const fontSize = Math.round(ctaScaled * layout.scale);
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
        }}
      >
        {activeText ? (
          <div
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
              {activeText}
            </p>
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}
