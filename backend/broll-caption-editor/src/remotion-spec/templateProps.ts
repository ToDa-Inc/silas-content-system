import type { VideoSpec } from './schema';

/** Timeline values computed in `Renderer` (Player / composition root) so templates stay hook-free. */
export type VideoSpecWithTimeline = {
  spec: VideoSpec;
  frame: number;
  fps: number;
};
