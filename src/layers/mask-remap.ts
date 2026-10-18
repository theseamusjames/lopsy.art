import type { Layer, Point } from '../types';
import { getMaskDocOrigin } from './mask-origin';

/** Affine map `(x, y) ↦ (a·x + c·y + e, b·x + d·y + f)`, in continuous pixel coordinates. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function translation(dx: number, dy: number): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

export function scaling(sx: number, sy: number): Affine {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/** Document map of Rotate Image: CW sends (x, y) → (H − y, x), CCW (x, y) → (y, W − x). */
export function documentRotation90(direction: 'cw' | 'ccw', docWidth: number, docHeight: number): Affine {
  return direction === 'cw'
    ? { a: 0, b: 1, c: -1, d: 0, e: docHeight, f: 0 }
    : { a: 0, b: -1, c: 1, d: 0, e: 0, f: docWidth };
}

/**
 * Document map of `rotateLayer90` on a `width` x `height` texture at `from`
 * that is then placed at `to`: the texture-local turn (CW (u, v) → (H − v, u),
 * CCW (u, v) → (v, W − u)) between the two placements.
 */
export function layerRotation90(
  direction: 'cw' | 'ccw',
  from: Point,
  to: Point,
  width: number,
  height: number,
): Affine {
  return direction === 'cw'
    ? { a: 0, b: 1, c: -1, d: 0, e: to.x + height + from.y, f: to.y - from.x }
    : { a: 0, b: -1, c: 1, d: 0, e: to.x - from.y, f: to.y + width + from.x };
}

/**
 * Document map of `flipLayer` on a texture spanning `[from, from + size)` on
 * the flip axis that is then moved to start at `to`: every coordinate `p`
 * goes to `from + to + size − p`.
 */
export function layerFlip(axis: 'horizontal' | 'vertical', from: number, to: number, size: number): Affine {
  const k = from + to + size;
  return axis === 'horizontal'
    ? { a: -1, b: 0, c: 0, d: 1, e: k, f: 0 }
    : { a: 1, b: 0, c: 0, d: -1, e: 0, f: k };
}

/** `outer ∘ inner`: apply `inner` first. */
export function composeAffine(outer: Affine, inner: Affine): Affine {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

export function invertAffine(m: Affine): Affine | null {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0) return null;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

export function applyAffine(m: Affine, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

function isIdentity(m: Affine): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
}

/** Size of the new mask texture and the map from its texels back to the old mask's. */
export interface MaskRemapPlan {
  width: number;
  height: number;
  inverse: Affine;
}

/**
 * How a layer's mask must be resampled when an operation moves the layer's
 * content by `forward` (old document space → new document space), with
 * `before` / `after` the layer on either side of it. Null when the mask
 * already lines up (no mask, or a text layer that just moved with its mask).
 *
 * Document-anchored masks (raster, group) are rebuilt at the new document
 * size; layer-anchored ones keep the extent the transformed mask reaches
 * from the layer's new origin.
 */
export function planMaskRemap(
  before: Layer,
  after: Layer,
  forward: Affine,
  docWidth: number,
  docHeight: number,
): MaskRemapPlan | null {
  const mask = before.mask;
  if (!mask) return null;
  const from = getMaskDocOrigin(before);
  const to = getMaskDocOrigin(after);
  const local = composeAffine(translation(-to.x, -to.y), composeAffine(forward, translation(from.x, from.y)));
  const inverse = invertAffine(local);
  if (!inverse) return null;

  let width = docWidth;
  let height = docHeight;
  if (after.type !== 'raster' && after.type !== 'group') {
    const corners = [
      applyAffine(local, { x: 0, y: 0 }),
      applyAffine(local, { x: mask.width, y: 0 }),
      applyAffine(local, { x: 0, y: mask.height }),
      applyAffine(local, { x: mask.width, y: mask.height }),
    ];
    width = Math.max(1, Math.round(Math.max(...corners.map((p) => p.x))));
    height = Math.max(1, Math.round(Math.max(...corners.map((p) => p.y))));
  }
  if (isIdentity(local) && width === mask.width && height === mask.height) return null;
  return { width, height, inverse };
}
