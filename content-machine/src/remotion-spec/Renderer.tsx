import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { normalizeVideoSpecForRender, parseVideoSpec } from '@/lib/video-spec';
import { coerceLibVideoSpecForRemotion } from './schema';
import Background from './Background';
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
  const timeline = { spec, frame, fps };

  // Per-template overlay. Templates intentionally no longer render their own
  // <Video>/<Img> — that lives in <Background> above the switch so swapping
  // template / theme / layout never unmounts the media element.
  let overlay: React.ReactNode = null;
  switch (spec.templateId) {
    case 'bottom-card':
      overlay = <BottomCardTemplate {...timeline} />;
      break;
    case 'top-banner':
      overlay = <TopBannerTemplate {...timeline} />;
      break;
    case 'stacked-cards':
      overlay = <StackedCardsTemplate {...timeline} />;
      break;
    case 'centered-pop':
    default:
      overlay = <CenteredPopTemplate {...timeline} />;
  }

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Background spec={spec} />
      {overlay}
    </AbsoluteFill>
  );
}
