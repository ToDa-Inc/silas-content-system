import React from 'react';
import { useCurrentFrame } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Poppins';

const { fontFamily } = loadFont('normal', { weights: ['700'] });

const CardCaption = ({ text, appearAt, isCTA }) => {
  const frame = useCurrentFrame();
  const isVisible = frame >= appearAt;

  const marginTop = isCTA ? '48px' : '14px';
  const fontSize = isCTA ? '52px' : '58px';

  return (
    <div
      style={{
        pointerEvents: 'none',
        paddingLeft: '54px',
        paddingRight: '54px',
        marginTop,
        boxSizing: 'border-box',
        width: '100%',
        opacity: isVisible ? 1 : 0,
      }}
    >
      {/* White card */}
      <div
        style={{
          display: 'inline-block',
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          padding: '20px 30px',
          maxWidth: '840px',
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
          {text}
        </p>
      </div>
    </div>
  );
};

export default CardCaption;
