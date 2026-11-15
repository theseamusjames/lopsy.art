import type { Point } from '../../types';
import type { TransformState } from './transform';
import { getCornerPositions } from './transform';
import { applyHomography, squareToQuad } from './homography';
import { transformPoint } from './transform-handles';

export type TransformPointMapper = (x: number, y: number) => Point | null;

/**
 * Forward-map document points the way the floated pixels are mapped: the
 * affine chain (translate, rotate, scale, skew) in Free/Skew, and the
 * homography taking `originalBounds` onto the four corners in
 * Distort/Perspective. Returns null for a point with no image (behind the
 * horizon of a self-crossing quad).
 */
export function createTransformPointMapper(state: TransformState): TransformPointMapper {
  if (state.mode !== 'distort' && state.mode !== 'perspective') {
    return (x, y) => transformPoint(x, y, state);
  }
  const ob = state.originalBounds;
  if (ob.width <= 0 || ob.height <= 0) return () => null;
  const [tl, tr, br, bl] = getCornerPositions(state);
  const h = squareToQuad(tl, tr, br, bl);
  return (x, y) => applyHomography(h, (x - ob.x) / ob.width, (y - ob.y) / ob.height);
}

/**
 * Map flat `[x0, y0, x1, y1, …]` polylines through a transform. Both maps
 * send straight lines to straight lines, so mapping the vertices is exact.
 * A vertex with no image splits its polyline in two.
 */
export function transformPolylines(polylines: readonly number[][], state: TransformState): number[][] {
  const map = createTransformPointMapper(state);
  const out: number[][] = [];
  for (const pts of polylines) {
    let current: number[] = [];
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const p = map(pts[i] ?? 0, pts[i + 1] ?? 0);
      if (!p) {
        if (current.length >= 4) out.push(current);
        current = [];
        continue;
      }
      current.push(p.x, p.y);
    }
    if (current.length >= 4) out.push(current);
  }
  return out;
}
