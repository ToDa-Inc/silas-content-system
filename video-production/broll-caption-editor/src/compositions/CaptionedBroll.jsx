import React from 'react';
import { Video, useVideoConfig } from 'remotion';
import TextOverlay from '../components/TextOverlay';
import HookText from '../components/HookText';

const CaptionedBroll = ({ videoPath, hook, textBlocks }) => {
  const { fps, durationInFrames } = useVideoConfig();

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
        alignItems: 'center'
      }}
    >
      {/* Video Background */}
      <Video
        src={videoPath}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          position: 'absolute',
          top: 0,
          left: 0
        }}
      />

      {/* Dark Overlay for Text Readability */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.5) 100%)',
          pointerEvents: 'none'
        }}
      />

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

export default CaptionedBroll;
