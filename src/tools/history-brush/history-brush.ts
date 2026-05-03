import type { PixelSurface } from '../../types';
import type { Color } from '../../types/color';

export interface HistoryBrushDabParams {
  /** Center of the dab in destination layer coordinates. */
  destX: number;
  destY: number;
  /** The source snapshot surface to sample from (layer-aligned). */
  source: PixelSurface;
  /** Destination surface to paint onto. */
  dest: PixelSurface;
  /** Brush radius in pixels. */
  radius: number;
  /** Brush hardness 0–1. 1 = hard edge, 0 = fully feathered. */
  hardness: number;
  /** Brush opacity 0–1. */
  opacity: number;
}

/**
 * Compute the soft-brush coverage weight for a pixel at distance `d`
 * from center, given a brush of `radius` and `hardness` (0–1).
 *
 * Weight is 1 at the hard core (d <= hardRadius) and falls off
 * smoothly to 0 at the outer radius edge.
 */
export function brushWeight(d: number, radius: number, hardness: number): number {
  if (radius <= 0) return 0;
  if (d >= radius) return 0;
  const hardRadius = radius * hardness;
  if (d <= hardRadius) return 1;
  // Smooth falloff from hardRadius to radius
  const t = (d - hardRadius) / Math.max(1e-6, radius - hardRadius);
  return 1 - t * t;
}

/**
 * Apply a single history-brush dab: sample each pixel from the source
 * snapshot and composite it over the destination at the given brush weight.
 *
 * Coordinates are in the destination layer's local space. The source surface
 * is assumed to be co-registered with the destination (same document origin).
 */
export function applyHistoryBrushDab(params: HistoryBrushDabParams): void {
  const { destX, destY, source, dest, radius, hardness, opacity } = params;
  const r = Math.floor(radius);
  const cx = Math.round(destX);
  const cy = Math.round(destY);

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy);
      const weight = brushWeight(d, radius, hardness);
      if (weight <= 0) continue;

      const px = cx + dx;
      const py = cy + dy;

      const srcPixel = source.getPixel(px, py);
      if (srcPixel.a <= 0) continue;

      const dstPixel = dest.getPixel(px, py);
      const alpha = weight * opacity * srcPixel.a;

      const blended: Color = {
        r: Math.round(srcPixel.r * alpha + dstPixel.r * (1 - alpha)),
        g: Math.round(srcPixel.g * alpha + dstPixel.g * (1 - alpha)),
        b: Math.round(srcPixel.b * alpha + dstPixel.b * (1 - alpha)),
        a: Math.min(1, dstPixel.a + alpha * (1 - dstPixel.a)),
      };
      dest.setPixel(px, py, blended);
    }
  }
}
