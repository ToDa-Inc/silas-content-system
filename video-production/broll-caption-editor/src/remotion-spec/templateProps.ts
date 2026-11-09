import type { VideoSpec } from './schema';

/** Timeline values computed in `Renderer` (Player / composition root) so templates stay hook-free. */
export type VideoSpecWithTimeline = {
  spec: VideoSpec;
  frame: number;
  fps: number;
  /** Height of the box the template renders in; defaults to the full 1920 canvas. */
  canvasH?: number;
};
