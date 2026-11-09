import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { normalizeVideoSpecForRender, type VideoSpec } from './schema';
import Background from './Background';
import { framingGeometry } from './framing';
import BarText from './BarText';
import BottomCardTemplate from './templates/bottomCard';
import CenteredPopTemplate from './templates/centeredPop';
import TopBannerTemplate from './templates/topBanner';
import StackedCardsTemplate from './templates/stackedCards';

export default function Renderer(props: VideoSpec) {
  const spec = normalizeVideoSpecForRender(props);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Per-template overlay. Templates intentionally no longer render their own
  // <Video>/<Img> — that lives in <Background> above the switch so swapping
  // template / theme / layout never unmounts the media element.
  const geo = framingGeometry(spec.framing);
  let overlay: React.ReactNode;
  if (!geo) {
    overlay = renderTemplate(spec, frame, fps);
  } else if (!geo.hookBar || !geo.captionBar) {
    // 4:5 — the template places hook and captions over the picture (bars are too thin).
    overlay = (
      <div style={{ ...BOX, top: geo.media.top, height: geo.media.height }}>
        {renderTemplate(spec, frame, fps, geo.media.height)}
      </div>
    );
  } else {
    // Letterbox — hook in the top bar, captions in the bottom bar, both inside the safe area.
    const hookOnly = { ...spec, blocks: [] };
    const captionsOnly = { ...spec, hook: { ...spec.hook, text: '' } };
    overlay = (
      <>
        <div style={{ ...BOX, top: geo.hookBar.top, height: geo.hookBar.height }}>
          <BarText spec={hookOnly} frame={frame} fps={fps} barHeight={geo.hookBar.height} />
        </div>
        <div style={{ ...BOX, top: geo.captionBar.top, height: geo.captionBar.height }}>
          <BarText spec={captionsOnly} frame={frame} fps={fps} barHeight={geo.captionBar.height} />
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

function renderTemplate(spec: VideoSpec, frame: number, fps: number, canvasH?: number): React.ReactNode {
  const timeline = { spec, frame, fps, canvasH };
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
