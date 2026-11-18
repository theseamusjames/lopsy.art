/**
 * Sharpening, noise reduction, local contrast and haze mapped onto the
 * engine (`setImageDetail`, `setImageLocalContrast`). Radii are in
 * full-resolution pixels; `pixelScale` is the working image's width over
 * the full image's (below 1 for the first view of a RAW file), so a preview
 * looks like the export. Each answers null when the recipe leaves it off.
 */

import type { Recipe } from '@lopsy/photos-core/library/recipe';

/** `[amount, radius, edges, nrLuminance, nrColor, nrDetail, pixelScale]`. */
export function detailValues(recipe: Recipe, pixelScale: number): Float32Array | null {
  const { amount, radius, edges } = recipe.sharpness;
  const { luminance, color, detail } = recipe.noise;
  if (amount === 0 && luminance === 0 && color === 0) return null;
  return Float32Array.from([amount, radius, edges, luminance, color, detail, pixelScale]);
}

/** `[large, small, haze, pixelScale]`. */
export function localContrastValues(recipe: Recipe, pixelScale: number): Float32Array | null {
  const { large, small, haze } = recipe.localContrast;
  if (large === 0 && small === 0 && haze === 0) return null;
  return Float32Array.from([large, small, haze, pixelScale]);
}

export function detailKey(recipe: Recipe, pixelScale: number): string {
  const s = recipe.sharpness;
  const n = recipe.noise;
  const l = recipe.localContrast;
  return [s.amount, s.radius, s.edges, n.luminance, n.color, n.detail, l.large, l.small, l.haze, pixelScale].join(',');
}
