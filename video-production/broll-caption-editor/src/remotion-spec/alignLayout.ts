import type { TextAlign } from './schema';

/** Map caption text alignment to flex cross-axis (row of one card / line). */
export function flexAlignForTextAlign(ta: TextAlign): 'flex-start' | 'center' | 'flex-end' {
  if (ta === 'left') return 'flex-start';
  if (ta === 'right') return 'flex-end';
  return 'center';
}
