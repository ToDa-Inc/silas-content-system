import React from 'react';
import { loadFont } from '@remotion/google-fonts/Poppins';

// Poppins 700 — the font behind CapCut's viral white-card caption style,
// closest free match to Instagram's native caption rendering (SF Pro Bold on iOS)
const { fontFamily } = loadFont('normal', { weights: ['700'] });

const CardHook = ({ text }) => {
  return (
    <div
      style={{
        pointerEvents: 'none',
        paddingLeft: '54px',
        paddingRight: '54px',
        paddingTop: '80px',
        paddingBottom: '0px',
        boxSizing: 'border-box',
        width: '100%',
      }}
    >
      {/* White card */}
      <div
        style={{
          display: 'inline-block',
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          padding: '28px 34px',
          maxWidth: '840px',
        }}
      >
        <p
          style={{
            fontSize: '68px',
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

export default CardHook;
