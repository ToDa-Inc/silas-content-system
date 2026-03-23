import React from 'react';

const HookText = ({ text }) => {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        textAlign: 'center',
        pointerEvents: 'none',
        padding: '30px 30px 50px 30px',
        boxSizing: 'border-box'
      }}
    >
      <p
        style={{
          fontSize: '68px',
          fontWeight: '900',
          color: '#ffffff',
          margin: 0,
          padding: '0',
          fontFamily: 'Arial, sans-serif',
          lineHeight: 1.1,
          letterSpacing: '-1.5px',
          // Clean text stroke outline
          WebkitTextStroke: '2.5px #000000',
          paintOrder: 'stroke fill',
          WebkitFontSmoothing: 'antialiased',
          textRendering: 'optimizeLegibility',
          wordWrap: 'break-word',
          overflowWrap: 'break-word',
          maxWidth: '100%'
        }}
      >
        {text}
      </p>
    </div>
  );
};

export default HookText;
