/** Shared Remotion metadata: duration + per-block appearAt/duration from timing props. */

export function calculateVisualMetadata({ props }) {
  const fps = 30;
  const hookS = props.hookDurationSeconds ?? 3;
  const per = props.secondsPerBlock ?? 2.5;
  const raw = props.textBlocks || [];
  const textBlocks = raw.map((b, i) => ({
    ...b,
    appearAt: Math.round((hookS + i * per) * fps),
    duration: Math.round((raw.length - i) * per * fps + fps),
  }));
  const durationInFrames = Math.round((hookS + raw.length * per + 1) * fps);
  return {
    durationInFrames,
    fps,
    props: {
      ...props,
      textBlocks,
    },
  };
}

export const defaultVisualProps = {
  hook: '',
  textBlocks: [],
  backgroundUrl: '',
  hookDurationSeconds: 3,
  secondsPerBlock: 2.5,
};
