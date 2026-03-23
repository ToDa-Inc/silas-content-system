import React from 'react';
import { useCurrentFrame } from 'remotion';

const TextOverlay = ({ text, appearAt, blockIndex, isCTA }) => {
  const frame = useCurrentFrame();

  // Simple visibility: show instantly when appearAt is reached, stay visible
  const isVisible = frame >= appearAt;
  const opacity = isVisible ? 1 : 0;

  // Add extra spacing before CTA for visual hierarchy
  const paddingTop = isCTA ? '60px' : '20px';
  const paddingBottom = isCTA ? '20px' : '20px';

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        textAlign: 'center',
        opacity,
        pointerEvents: 'none',
        paddingTop,
        paddingBottom,
        paddingLeft: '30px',
        paddingRight: '30px',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {/* Text with emoji inline - clean stroke outline */}
      <p
        style={{
          fontSize: isCTA ? '52px' : '60px',
          fontWeight: '900',
          color: '#ffffff',
          margin: 0,
          padding: '0',
          fontFamily: 'Arial, sans-serif',
          lineHeight: 1.15,
          letterSpacing: '-1px',
          maxWidth: '100%',
          // Clean text stroke outline
          WebkitTextStroke: '2.5px #000000',
          paintOrder: 'stroke fill',
          WebkitFontSmoothing: 'antialiased',
          textRendering: 'optimizeLegibility',
          wordWrap: 'break-word',
          overflowWrap: 'break-word'
        }}
      >
        {text}
      </p>
    </div>
  );
};

export default TextOverlay;
