import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { normalizeVideoSpecForRender, parseVideoSpec } from '@/lib/video-spec';
import { coerceLibVideoSpecForRemotion, type VideoSpec } from './schema';
import Background from './Background';
import { framingGeometry, resolveFraming } from './framing';
import BarText from './BarText';
import BottomCardTemplate from './templates/bottomCard';
import CenteredPopTemplate from './templates/centeredPop';
import TopBannerTemplate from './templates/topBanner';
import StackedCardsTemplate from './templates/stackedCards';

export default function Renderer(props: unknown) {
  const parsed = parseVideoSpec(props);
  if (!parsed) {
    throw new Error('Remotion Renderer: invalid VideoSpec (parseVideoSpec failed)');
  }
  const spec = coerceLibVideoSpecForRemotion(normalizeVideoSpecForRender(parsed));
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Per-template overlay. Templates intentionally no longer render their own
  // <Video>/<Img> — that lives in <Background> above the switch so swapping
  // template / theme / layout never unmounts the media element.
  const geo = framingGeometry(spec.framing);
  let overlay: React.ReactNode;
  if (!geo) {
    overlay = renderTemplate(spec, frame, fps);
  } else {
    // Framed: the hook sits in the top bar. Captions go in the bottom bar (letterbox)
    // or over the 4:5 picture, where the chosen template still applies.
    const hookOnly = { ...spec, blocks: [] };
    const captionsOnly = { ...spec, hook: { ...spec.hook, text: '' } };
    const captionsInBar = resolveFraming(spec.framing) === 'letterbox';
    overlay = (
      <>
        <div style={{ ...BOX, top: geo.hook.top, height: geo.hook.height }}>
          <BarText spec={hookOnly} frame={frame} fps={fps} barHeight={geo.hook.height} />
        </div>
        <div style={{ ...BOX, top: geo.captions.top, height: geo.captions.height }}>
          {captionsInBar ? (
            <BarText spec={captionsOnly} frame={frame} fps={fps} barHeight={geo.captions.height} />
          ) : (
            renderTemplate(captionsOnly, frame, fps)
          )}
        </div>
      </>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Background spec={spec} />
      {overlay}
    </AbsoluteFill>
  );
}

const BOX: React.CSSProperties = { position: 'absolute', left: 0, width: '100%', overflow: 'hidden' };

function renderTemplate(spec: VideoSpec, frame: number, fps: number): React.ReactNode {
  const timeline = { spec, frame, fps };
  switch (spec.templateId) {
    case 'bottom-card':
      return <BottomCardTemplate {...timeline} />;
    case 'top-banner':
      return <TopBannerTemplate {...timeline} />;
    case 'stacked-cards':
      return <StackedCardsTemplate {...timeline} />;
    case 'centered-pop':
    default:
      return <CenteredPopTemplate {...timeline} />;
  }
}
