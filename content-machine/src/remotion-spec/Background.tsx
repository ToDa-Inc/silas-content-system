import React from 'react';
import {
  Img,
  OffthreadVideo,
  useRemotionEnvironment,
  useVideoConfig,
  Video,
} from 'remotion';
import type { VideoSpec } from './schema';

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
}: {
  url: string;
  trimStartSec: number;
  trimEndSec: number | undefined;
  mediaKey: string;
}) {
  const { fps } = useVideoConfig();
  const { isRendering } = useRemotionEnvironment();
  const trimBefore = Math.round(trimStartSec * fps);
  const trimAfter =
    trimEndSec != null ? Math.round(trimEndSec * fps) : undefined;
  const common = { key: mediaKey, src: url, muted: true as const, style: FILL };

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
  const { url, kind } = spec.background;
  if (!url) return null;
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
      />
    );
  }
  return <Img key={url} src={url} style={FILL} />;
}
