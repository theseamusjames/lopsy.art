/**
 * The Finish group (vignette shape and grain) as the engine's
 * `setImageFinish` takes it: nine floats, `[vignetteAmount −100..100,
 * size 0..100, roundness −100..100, feather 0..100, grainAmount 0..150,
 * grainSize 0..150, grainRoughness 0..100, seed, pixelScale]`.
 *
 * The recipe's `finish.vignette` darkens when positive; the engine's
 * amount darkens when negative, so it is sent negated.
 *
 * Grain is seeded per photo, from its asset ID, so every render and export
 * of a photo has the same grain.
 */

import { DEFAULT_VIGNETTE_FEATHER, DEFAULT_VIGNETTE_SIZE } from '@lopsy/photos-core/library/recipe';

/** The recipe's finish fields; the shape ones are optional for recipes saved before they existed. */
export interface FinishFields {
  readonly vignette: number;
  readonly vignetteSize?: number;
  readonly vignetteRoundness?: number;
  readonly vignetteFeather?: number;
  readonly grain?: { readonly amount: number; readonly size: number; readonly roughness: number };
}

/** The recipe's defaults (they reproduce the earlier vignette's shape). */
export const FINISH_DEFAULTS = {
  vignetteSize: DEFAULT_VIGNETTE_SIZE,
  vignetteRoundness: 0,
  vignetteFeather: DEFAULT_VIGNETTE_FEATHER,
  grainSize: 25,
  grainRoughness: 50,
} as const;

/** The largest integer a float32 holds exactly, so the seed survives the trip into the engine. */
const SEED_MASK = 0xffffff;

/** A stable 24-bit seed from the asset ID (FNV-1a). */
export function grainSeed(assetId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < assetId.length; i++) {
    hash ^= assetId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash & SEED_MASK;
}

/** The nine floats, or null when there is no vignette and no grain (the engine's pass is then cleared). */
export function finishValues(finish: FinishFields, seed: number, pixelScale: number): Float32Array | null {
  const grain = finish.grain;
  const grainAmount = grain?.amount ?? 0;
  if (finish.vignette === 0 && grainAmount === 0) return null;
  return Float32Array.from([
    -finish.vignette,
    finish.vignetteSize ?? FINISH_DEFAULTS.vignetteSize,
    finish.vignetteRoundness ?? FINISH_DEFAULTS.vignetteRoundness,
    finish.vignetteFeather ?? FINISH_DEFAULTS.vignetteFeather,
    grainAmount,
    grain?.size ?? FINISH_DEFAULTS.grainSize,
    grain?.roughness ?? FINISH_DEFAULTS.grainRoughness,
    seed & SEED_MASK,
    pixelScale,
  ]);
}

/** Changes whenever the engine's finish pass must be set again. */
export function finishKey(finish: FinishFields, seed: number, pixelScale: number): string {
  const values = finishValues(finish, seed, pixelScale);
  return values ? Array.from(values).join(',') : 'none';
}
