import { spring } from 'remotion';

export type AnimStyle = { opacity: number; transform: string };

export function blockEntranceStyle(
  frame: number,
  fps: number,
  startFrame: number,
  kind: 'pop' | 'fade' | 'slide-up' | 'none',
): AnimStyle {
  const rel = frame - startFrame;
  if (rel < 0) {
    return { opacity: 0, transform: 'translateY(12px) scale(0.96)' };
  }
  if (kind === 'none') {
    return { opacity: 1, transform: 'none' };
  }
  if (kind === 'fade') {
    const t = Math.min(1, rel / 8);
    return { opacity: t, transform: 'none' };
  }
  if (kind === 'slide-up') {
    const t = Math.min(1, rel / 8);
    const y = (1 - t) * 24;
    return { opacity: t, transform: `translateY(${y}px)` };
  }
  const scale = spring({
    frame: rel,
    fps,
    config: { damping: 14, mass: 0.7, stiffness: 220 },
    from: 0.88,
    to: 1,
  });
  const op = spring({
    frame: rel,
    fps,
    config: { damping: 18, mass: 0.5, stiffness: 200 },
    from: 0,
    to: 1,
  });
  return { opacity: op, transform: `scale(${scale})` };
}
