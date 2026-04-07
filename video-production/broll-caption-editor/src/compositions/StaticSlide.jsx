import React from 'react';
import { Img } from 'remotion';
import TextOverlay from '../components/TextOverlay';
import HookText from '../components/HookText';

const StaticSlide = ({ backgroundUrl, hook, textBlocks }) => {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#000',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Img
        src={backgroundUrl}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background:
            'radial-gradient(ellipse at center, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.5) 100%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          textAlign: 'center',
          width: '100%',
          maxWidth: '100%',
        }}
      >
        <HookText text={hook} />
        {(textBlocks || []).map((block, index) => (
          <TextOverlay
            key={index}
            text={block.text}
            appearAt={block.appearAt}
            duration={block.duration}
            blockIndex={index}
            isCTA={block.isCTA}
          />
        ))}
      </div>
    </div>
  );
};

export default StaticSlide;
