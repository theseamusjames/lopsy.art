import type { Point, Rect } from '../../types';
import type { TransformState } from './transform';
import { getCornerPositions } from './transform';

/**
 * Forward-transform a point through the affine chain:
 * translate(-origCenter) → skew → scale → rotate → translate(origCenter + offset)
 */
function forwardPoint(px: number, py: number, state: TransformState): Point {
  const origCx = state.originalBounds.x + state.originalBounds.width / 2;
  const origCy = state.originalBounds.y + state.originalBounds.height / 2;

  let x = px - origCx;
  let y = py - origCy;

  const tanSkewX = Math.tan(state.skewX);
  const tanSkewY = Math.tan(state.skewY);
  const sx = x + y * tanSkewX;
  const sy = x * tanSkewY + y;
  x = sx * state.scaleX;
  y = sy * state.scaleY;

  const cos = Math.cos(state.rotation);
  const sin = Math.sin(state.rotation);
  return {
    x: x * cos - y * sin + origCx + state.translateX,
    y: x * sin + y * cos + origCy + state.translateY,
  };
}

/**
 * Inverse-transform: given an output pixel, find the original source pixel.
 */
function inversePoint(px: number, py: number, state: TransformState): Point {
  const origCx = state.originalBounds.x + state.originalBounds.width / 2;
  const origCy = state.originalBounds.y + state.originalBounds.height / 2;

  let x = px - origCx - state.translateX;
  let y = py - origCy - state.translateY;

  const cos = Math.cos(-state.rotation);
  const sin = Math.sin(-state.rotation);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;

  x = rx / state.scaleX;
  y = ry / state.scaleY;

  const tanSkewX = Math.tan(state.skewX);
  const tanSkewY = Math.tan(state.skewY);
  const det = 1 - tanSkewX * tanSkewY;
  const ux = (x - y * tanSkewX) / det;
  const uy = (y - x * tanSkewY) / det;

  return { x: ux + origCx, y: uy + origCy };
}

/**
 * Inverse bilinear: given a point in the destination quad, find the (u,v)
 * in [0,1]² that maps to it via bilinear interpolation of the 4 corners.
 * Returns null if the point is outside the quad.
 */
function inverseBilinear(
  p: Point,
  tl: Point, tr: Point, br: Point, bl: Point,
  ob: Rect,
): Point | null {
  // Solve for (u,v) such that:
  // p = (1-v)*((1-u)*tl + u*tr) + v*((1-u)*bl + u*br)
  // Use iterative approach for robustness
  const e = { x: tr.x - tl.x, y: tr.y - tl.y };
  const f = { x: bl.x - tl.x, y: bl.y - tl.y };
  const g = { x: tl.x - tr.x + br.x - bl.x, y: tl.y - tr.y + br.y - bl.y };
  const h = { x: p.x - tl.x, y: p.y - tl.y };

  const k2 = g.x * f.y - g.y * f.x;
  const k1 = e.x * f.y - e.y * f.x + h.x * g.y - h.y * g.x;
  const k0 = h.x * e.y - h.y * e.x;

  let v: number;
  if (Math.abs(k2) < 1e-10) {
    if (Math.abs(k1) < 1e-10) return null;
    v = -k0 / k1;
  } else {
    const disc = k1 * k1 - 4 * k0 * k2;
    if (disc < 0) return null;
    const sqrtDisc = Math.sqrt(disc);
    const v1 = (-k1 + sqrtDisc) / (2 * k2);
    const v2 = (-k1 - sqrtDisc) / (2 * k2);
    v = (v1 >= -0.01 && v1 <= 1.01) ? v1 : v2;
  }

  const denom = e.x + g.x * v;
  const denomY = e.y + g.y * v;
  const u = Math.abs(denom) > Math.abs(denomY)
    ? (h.x - f.x * v) / denom
    : (h.y - f.y * v) / denomY;

  if (u < -0.01 || u > 1.01 || v < -0.01 || v > 1.01) return null;

  return {
    x: ob.x + u * ob.width,
    y: ob.y + v * ob.height,
  };
}

export function applyTransformToMask(
  originalMask: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
  state: TransformState,
): { mask: Uint8ClampedArray; bounds: Rect | null } {
  const result = new Uint8ClampedArray(maskWidth * maskHeight);
  const ob = state.originalBounds;
  const isCornerMode = state.mode === 'distort' || state.mode === 'perspective';

  let corners: [Point, Point, Point, Point] | null = null;
  let c0: Point, c1: Point, c2: Point, c3: Point;

  if (isCornerMode) {
    corners = getCornerPositions(state);
    [c0, c1, c2, c3] = corners; // TL, TR, BR, BL
  } else {
    c0 = forwardPoint(ob.x, ob.y, state);
    c1 = forwardPoint(ob.x + ob.width, ob.y, state);
    c2 = forwardPoint(ob.x + ob.width, ob.y + ob.height, state);
    c3 = forwardPoint(ob.x, ob.y + ob.height, state);
  }

  const minX = Math.max(0, Math.floor(Math.min(c0.x, c1.x, c2.x, c3.x) - 1));
  const minY = Math.max(0, Math.floor(Math.min(c0.y, c1.y, c2.y, c3.y) - 1));
  const maxX = Math.min(maskWidth, Math.ceil(Math.max(c0.x, c1.x, c2.x, c3.x) + 1));
  const maxY = Math.min(maskHeight, Math.ceil(Math.max(c0.y, c1.y, c2.y, c3.y) + 1));

  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      let orig: Point | null;
      if (corners) {
        orig = inverseBilinear({ x, y }, corners[0], corners[1], corners[2], corners[3], ob);
      } else {
        orig = inversePoint(x, y, state);
      }
      if (!orig) continue;
      const ix = Math.round(orig.x);
      const iy = Math.round(orig.y);
      if (ix >= 0 && ix < maskWidth && iy >= 0 && iy < maskHeight) {
        const val = originalMask[iy * maskWidth + ix] ?? 0;
        if (val > 0) {
          result[y * maskWidth + x] = val;
        }
      }
    }
  }

  // Compute bounds of result
  let bMinX = maskWidth;
  let bMinY = maskHeight;
  let bMaxX = -1;
  let bMaxY = -1;
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      if ((result[y * maskWidth + x] ?? 0) > 0) {
        if (x < bMinX) bMinX = x;
        if (x > bMaxX) bMaxX = x;
        if (y < bMinY) bMinY = y;
        if (y > bMaxY) bMaxY = y;
      }
    }
  }

  const newBounds = bMaxX >= 0
    ? { x: bMinX, y: bMinY, width: bMaxX - bMinX + 1, height: bMaxY - bMinY + 1 }
    : null;

  return { mask: result, bounds: newBounds };
}
