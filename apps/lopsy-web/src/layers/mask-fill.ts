import type { Color } from '../types';

/** Mask value (0 = hide, 1 = reveal) a colour paints into a layer mask. */
export function maskValueForColor(color: Pick<Color, 'r' | 'g' | 'b'>): number {
  return (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255;
}
