import React from 'react';
import { Video, useCurrentFrame } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Poppins';

const { fontFamily } = loadFont('normal', { weights: ['700'] });

/**
 * B-roll background + bottom white card captions — Instagram native style.
 *
 * One phrase visible at a time:
 *   - Hook shown from frame 0 until the first textBlock's appearAt
 *   - Each textBlock replaces the previous (most recently started wins)
 *   - Card is always at the bottom, leaving the creator's face untouched
 *   - No dark vignette — white card reads against any B-roll
 */
const CaptionedBroll = ({ backgroundUrl, hook, textBlocks }) => {
  const frame = useCurrentFrame();
  const blocks = textBlocks || [];

  const firstBlockStart = blocks[0]?.appearAt ?? Infinity;
  const showHook = frame < firstBlockStart;

  // Most recently started block that has already appeared
  const activeBlock = [...blocks]
    .filter((b) => frame >= b.appearAt)
    .sort((a, b) => b.appearAt - a.appearAt)[0];

  const activeText = showHook ? hook : activeBlock?.text;
  const isCTA = !showHook && !!activeBlock?.isCTA;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#000',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Looping B-roll background */}
      <Video
        src={backgroundUrl}
        loop
        muted
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      />

      {/* Bottom caption card */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          paddingBottom: '160px',
          paddingLeft: '54px',
          paddingRight: '54px',
          boxSizing: 'border-box',
          pointerEvents: 'none',
        }}
      >
        {activeText ? (
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
                fontSize: isCTA ? '52px' : '60px',
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
        ) : null}
      </div>
    </div>
  );
};

export default CaptionedBroll;
