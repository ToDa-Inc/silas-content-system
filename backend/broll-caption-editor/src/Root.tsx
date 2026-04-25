import { Composition, registerRoot } from 'remotion';
// Spec source lives under content-machine so the dashboard's <Player> and the
// Remotion CLI render share one physical install of `remotion` + `react`.
// Two copies break Player context (useCurrentFrame returns the default frame).
import Renderer from '../../../content-machine/src/remotion-spec/Renderer';
import { defaultStudioSpec } from '../../../content-machine/src/remotion-spec/schema';

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
