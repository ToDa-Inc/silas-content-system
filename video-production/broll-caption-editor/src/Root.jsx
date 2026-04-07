import { Composition, registerRoot } from 'remotion';
import CaptionedBroll from './compositions/CaptionedBroll';
import StaticSlide from './compositions/StaticSlide';
import { calculateVisualMetadata, defaultVisualProps } from './calculateVisualMetadata';

registerRoot(() => (
  <>
    <Composition
      id="captioned-broll"
      component={CaptionedBroll}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaultVisualProps}
      calculateMetadata={calculateVisualMetadata}
    />
    <Composition
      id="static-slide"
      component={StaticSlide}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaultVisualProps}
      calculateMetadata={calculateVisualMetadata}
    />
  </>
));
