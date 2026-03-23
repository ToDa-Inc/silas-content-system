import React from 'react';
import { useCurrentFrame } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Poppins';

const { fontFamily } = loadFont('normal', { weights: ['700'] });

// Single-card bottom caption — Instagram native style
// ✅ One phrase at a time
// ✅ Positioned at bottom so creator's face is never covered
// ✅ Transparent background — composited over B-roll with ffmpeg
const CardBrollSimple = ({ hook, textBlocks }) => {
  const frame = useCurrentFrame();

  // Find the most recently started text block — this ensures only one card
  // is visible at a time. Blocks that started earlier are replaced by newer ones.
  const activeBlock = [...textBlocks]
    .filter((block) => frame >= block.appearAt)
    .sort((a, b) => b.appearAt - a.appearAt)[0];

  // Show hook text before the first text block appears
  const firstBlockStart = textBlocks[0]?.appearAt ?? Infinity;
  const showHook = frame < firstBlockStart;

  const activeText = showHook ? hook : activeBlock?.text;
  const isCTA = !showHook && !!activeBlock?.isCTA;
  const fontSize = isCTA ? '52px' : '60px';

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: 'transparent',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',    // ← push card to BOTTOM of frame
        alignItems: 'flex-start',
        paddingBottom: '160px',         // ← safe zone above nav bar area
        boxSizing: 'border-box',
        pointerEvents: 'none',
      }}
    >
      {activeText ? (
        <div
          style={{
            paddingLeft: '54px',
            paddingRight: '54px',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              display: 'inline-block',
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              padding: '24px 32px',
              maxWidth: '900px',
            }}
          >
            <p
              style={{
                fontSize,
                fontWeight: '700',
                fontFamily,
                color: '#0a0a0a',
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
        </div>
      ) : null}
    </div>
  );
};

export default CardBrollSimple;
