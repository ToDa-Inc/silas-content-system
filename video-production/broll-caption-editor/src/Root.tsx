import { Composition, registerRoot } from 'remotion';
// Remotion CLI entry; ./remotion-spec is the render-time copy. Next.js preview imports the
// parallel tree under content-machine/src/remotion-spec — keep types/defaults aligned (see schema.ts).
import Renderer from './remotion-spec/Renderer';
import { defaultStudioSpec } from './remotion-spec/schema';

registerRoot(() => (
  <Composition
    id="video-spec"
    component={Renderer}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={defaultStudioSpec}
    calculateMetadata={({ props }) => {
      const total = typeof props.totalSec === 'number' ? props.totalSec : 12;
      return {
        durationInFrames: Math.max(1, Math.ceil(total * 30)),
        fps: 30,
        props,
      };
    }}
  />
));
