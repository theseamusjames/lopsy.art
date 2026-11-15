import type { Point, PixelSurface } from '../../types';

export interface HealedPatch {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** Top-left doc-space position of the patch. */
  x: number;
  y: number;
}

/**
 * Compute the mean RGBA (RGB only used for color correction) of all opaque
 * pixels within a circular region of a pixel surface.
 */
function computeCircularMean(
  surface: PixelSurface,
  cx: number,
  cy: number,
  radius: number,
): { r: number; g: number; b: number } {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  const r = Math.floor(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = surface.getPixel(cx + dx, cy + dy);
      if (px.a > 0) {
        sumR += px.r;
        sumG += px.g;
        sumB += px.b;
        count++;
      }
    }
  }
  if (count === 0) return { r: 0, g: 0, b: 0 };
  return { r: sumR / count, g: sumG / count, b: sumB / count };
}

/**
 * Apply one healing dab.
 *
 * Algorithm:
 *  1. Sample source patch pixels.
 *  2. Compute source mean color.
 *  3. Compute destination mean color.
 *  4. For each source pixel: healed = source - sourceMean + destMean
 *     This preserves the texture (high-frequency) from source while
 *     matching the color/tone (low-frequency) from the destination.
 *  5. Composite the healed patch onto dest.
 */
export function applyHealingDab(
  dest: PixelSurface,
  source: PixelSurface,
  pos: Point,
  offset: Point,
  size: number,
  opacity: number,
): void {
  const radius = Math.floor(size / 2);
  const cx = Math.round(pos.x);
  const cy = Math.round(pos.y);

  // Source center in source texture
  const srcCx = cx + Math.round(offset.x);
  const srcCy = cy + Math.round(offset.y);

  // Compute mean colors for color correction
  const srcMean = computeCircularMean(source, srcCx, srcCy, radius);
  const destMean = computeCircularMean(dest, cx, cy, radius);

  const alpha = Math.max(0, Math.min(1, opacity));

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;

      const destX = cx + dx;
      const destY = cy + dy;
      const srcX = srcCx + dx;
      const srcY = srcCy + dy;

      const srcPixel = source.getPixel(srcX, srcY);
      if (srcPixel.a === 0) continue;

      // Color correction: shift source texture to match dest tone
      const healedR = Math.max(0, Math.min(255, srcPixel.r - srcMean.r + destMean.r));
      const healedG = Math.max(0, Math.min(255, srcPixel.g - srcMean.g + destMean.g));
      const healedB = Math.max(0, Math.min(255, srcPixel.b - srcMean.b + destMean.b));

      // Soft falloff near edge of brush
      const distSq = dx * dx + dy * dy;
      const radiusSq = radius * radius;
      const falloff = radius > 0 ? Math.max(0, 1 - distSq / radiusSq) : 1;
      const blendAlpha = alpha * falloff * srcPixel.a;

      if (blendAlpha <= 0) continue;

      const existing = dest.getPixel(destX, destY);
      const inv = 1 - blendAlpha;

      dest.setPixel(destX, destY, {
        r: Math.round(healedR * blendAlpha + existing.r * inv),
        g: Math.round(healedG * blendAlpha + existing.g * inv),
        b: Math.round(healedB * blendAlpha + existing.b * inv),
        a: Math.min(1, existing.a + blendAlpha * (1 - existing.a)),
      });
    }
  }
}
