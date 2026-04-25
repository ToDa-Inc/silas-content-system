import { Composition, registerRoot } from 'remotion';
// Bundled next to Root so `remotion render` works in Docker (backend-only context has no
// ../content-machine). Keep in sync with content-machine via scripts/sync-broll-vendor.sh.
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
