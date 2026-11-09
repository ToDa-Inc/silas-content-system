import React from 'react';
import {
  Img,
  OffthreadVideo,
  useRemotionEnvironment,
  useVideoConfig,
  Video,
} from 'remotion';
import type { VideoSpec } from './schema';
import { framingGeometry } from './framing';

const FILL: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  position: 'absolute',
  top: 0,
  left: 0,
};

/**
 * Background lives ABOVE `<Renderer>`'s template switch so it stays mounted
 * when the user changes template / theme / layout. Without this, every UI tweak
 * unmounts the active template subtree → unmounts the video element → forces a full
 * media re-buffer (the "everything is loading on every click" symptom).
 *
 * `key={url}` only resets when the URL itself changes (e.g. the user picks a
 * different clip / image), which is the only legitimate reason to re-load media.
 *
 * NOTE: We intentionally do NOT pass `loop`. Looping a short b-roll under a
 * longer composition makes the clip visibly "rotate" (jump back to frame 0
 * mid-text). Without `loop`, Remotion plays the clip through once and naturally
 * holds the last frame for the remainder of the composition — the standard
 * cinematic behavior.
 */
function BrollVideo({
  url,
  trimStartSec,
  trimEndSec,
  mediaKey,
  style,
}: {
  url: string;
  trimStartSec: number;
  trimEndSec: number | undefined;
  mediaKey: string;
  style: React.CSSProperties;
}) {
  const { fps } = useVideoConfig();
  const { isRendering } = useRemotionEnvironment();
  const trimBefore = Math.round(trimStartSec * fps);
  const trimAfter =
    trimEndSec != null ? Math.round(trimEndSec * fps) : undefined;
  const common = { key: mediaKey, src: url, muted: true as const, style };

  if (isRendering) {
    return (
      <OffthreadVideo
        {...common}
        trimBefore={trimBefore}
        trimAfter={trimAfter}
        toneMapped
        delayRenderTimeoutInMilliseconds={120000}
      />
    );
  }

  return (
    <Video
      {...common}
      startFrom={trimBefore}
      endAt={trimAfter}
    />
  );
}

export default function Background({ spec }: { spec: VideoSpec }) {
  const { url } = spec.background;
  if (!url) return null;
  const geo = framingGeometry(spec.framing);
  if (!geo) return <BackgroundMedia spec={spec} />;
  // Framed: media is cropped to its box; the Renderer's black canvas shows as bars.
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        width: '100%',
        top: geo.media.top,
        height: geo.media.height,
        overflow: 'hidden',
      }}
    >
      <BackgroundMedia spec={spec} objectPosition={FOCAL[spec.background.focalPoint ?? 'center'] ?? 'center'} />
    </div>
  );
}

/** Crop position inside a framed box (letterbox / 4:5). */
const FOCAL: Record<string, string> = { top: 'center 15%', center: 'center', bottom: 'center 85%' };

function BackgroundMedia({ spec, objectPosition }: { spec: VideoSpec; objectPosition?: string }) {
  const { url, kind } = spec.background;
  const style: React.CSSProperties = objectPosition ? { ...FILL, objectPosition } : FILL;
  if (kind === 'video') {
    const trimStart = Number(spec.background.trimStartSec ?? 0);
    const trimEnd =
      spec.background.trimEndSec != null ? Number(spec.background.trimEndSec) : undefined;
    const mediaKey = `${url}|${trimStart}|${trimEnd ?? 'end'}`;
    return (
      <BrollVideo
        url={url}
        trimStartSec={trimStart}
        trimEndSec={trimEnd}
        mediaKey={mediaKey}
        style={style}
      />
    );
  }
  return <Img key={url} src={url} style={style} />;
}
