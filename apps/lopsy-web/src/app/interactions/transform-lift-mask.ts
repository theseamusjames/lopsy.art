import type { Rect } from '../../types';
import { applyTransformToMask, type TransformState } from '../../tools/transform/transform';

/**
 * A selection carried through a Move-tool scale or rotate frames pixels the
 * float resampled. Both edges come out of the same bilinear filter, so where
 * the box edge falls between pixels the mask and the pixels' alpha are both
 * partial. Lifting those pixels through that mask takes `alpha × mask` and
 * leaves `alpha × (1 − mask)` behind: once the float was gone (Undo → Redo,
 * or any edit that bakes it), the next Move drag left a faint outline of the
 * box where it had been (#1675).
 *
 * The edge's partial coverage is the resampling's, not the selection's, so
 * the lift divides it back out: the original mask is carried through the
 * transform once more with every selected pixel made fully selected, and the
 * lift mask is the transformed mask over that coverage. A hard selection
 * lifts every pixel it touches whole; a feathered one keeps its feather.
 */

interface TransformedSelection {
  layerId: string;
  originalMask: Uint8ClampedArray;
  maskWidth: number;
  maskHeight: number;
  transform: TransformState;
  liftMask: Uint8ClampedArray | null;
}

/** Keyed by the transformed mask array: any other selection is a new array. */
const transformed = new WeakMap<Uint8ClampedArray, TransformedSelection>();

/**
 * Carry `originalMask` through `transform` (as `applyTransformToMask` does)
 * and remember that the result frames pixels of `layerId` resampled by the
 * same transform, so a later lift of that layer through it leaves no fringe.
 */
export function transformSelectionOfLayer(
  layerId: string,
  originalMask: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
  transform: TransformState,
): { mask: Uint8ClampedArray; bounds: Rect | null } {
  const result = applyTransformToMask(originalMask, maskWidth, maskHeight, transform);
  if (result.bounds) {
    transformed.set(result.mask, {
      layerId,
      originalMask,
      maskWidth,
      maskHeight,
      transform,
      liftMask: null,
    });
  }
  return result;
}

/**
 * The mask to lift `layerId`'s pixels through when the selection is `mask`:
 * null for an ordinary selection (lift through `mask` itself).
 */
export function transformLiftMask(layerId: string, mask: Uint8ClampedArray): Uint8ClampedArray | null {
  const entry = transformed.get(mask);
  if (!entry || entry.layerId !== layerId) return null;
  entry.liftMask ??= buildLiftMask(entry, mask);
  return entry.liftMask;
}

function buildLiftMask(entry: TransformedSelection, mask: Uint8ClampedArray): Uint8ClampedArray {
  const { originalMask, maskWidth, maskHeight, transform } = entry;
  const lift = new Uint8ClampedArray(mask.length);
  if (isBinary(originalMask)) {
    for (let i = 0; i < mask.length; i++) if ((mask[i] ?? 0) > 0) lift[i] = 255;
    return lift;
  }
  const solid = new Uint8ClampedArray(originalMask.length);
  for (let i = 0; i < originalMask.length; i++) if ((originalMask[i] ?? 0) > 0) solid[i] = 255;
  const coverage = applyTransformToMask(solid, maskWidth, maskHeight, transform).mask;
  for (let i = 0; i < mask.length; i++) {
    const m = mask[i] ?? 0;
    if (m === 0) continue;
    const c = coverage[i] ?? 0;
    lift[i] = c > 0 ? Math.round((m * 255) / c) : m;
  }
  return lift;
}

function isBinary(mask: Uint8ClampedArray): boolean {
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ?? 0;
    if (v !== 0 && v !== 255) return false;
  }
  return true;
}
