import React from 'react';
import { useVideoConfig } from 'remotion';
import TextOverlay from '../components/TextOverlay';
import HookText from '../components/HookText';

const CaptionedBrollSimple = ({ hook, textBlocks }) => {
  const { fps, durationInFrames } = useVideoConfig();

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: 'transparent',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center'
      }}
    >
      {/* Centered Content Container */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          textAlign: 'center',
          width: '100%',
          maxWidth: '100%'
        }}
      >
        {/* Hook Text - Top */}
        <HookText text={hook} />

        {/* Dynamic Text Blocks - Stacked Vertically Below Hook */}
        {textBlocks.map((block, index) => (
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

export default CaptionedBrollSimple;
