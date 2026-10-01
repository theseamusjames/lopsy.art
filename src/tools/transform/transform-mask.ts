import type { Point, Rect } from '../../types';
import type { TransformState } from './transform';
import { getCornerPositions } from './transform';
import { applyHomography, invertHomography, squareToQuad, type Homography } from './homography';

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
 * Map a destination point back through the quad's projective map to the
 * original bounds. Returns null outside the quad, where the GPU writes
 * nothing either.
 */
function inverseProjective(p: Point, quadToSquare: Homography, ob: Rect): Point | null {
  const uv = applyHomography(quadToSquare, p.x, p.y);
  if (!uv) return null;
  const { x: u, y: v } = uv;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return {
    x: ob.x + u * ob.width,
    y: ob.y + v * ob.height,
  };
}

function maskAt(mask: Uint8ClampedArray, width: number, height: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return mask[y * width + x] ?? 0;
}

/**
 * Bilinear sample of the mask at a document point, with texel centres at
 * +0.5 — the same filter `samplePremulBilinear` applies to the pixels.
 */
function sampleMask(mask: Uint8ClampedArray, width: number, height: number, p: Point): number {
  const px = p.x - 0.5;
  const py = p.y - 0.5;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;
  const top = maskAt(mask, width, height, x0, y0) * (1 - fx) + maskAt(mask, width, height, x0 + 1, y0) * fx;
  const bottom = maskAt(mask, width, height, x0, y0 + 1) * (1 - fx) + maskAt(mask, width, height, x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Carry a selection mask through a transform exactly as the GPU carries the
 * pixels (`transform_affine.glsl` / `transform_perspective.glsl`): each
 * output pixel centre maps back into the original and the mask is sampled
 * bilinearly there. The anti-aliased edge then matches the transformed
 * pixels' alpha, so clearing or filling the result leaves no fringe.
 */
export function applyTransformToMask(
  originalMask: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
  state: TransformState,
): { mask: Uint8ClampedArray; bounds: Rect | null } {
  const result = new Uint8ClampedArray(maskWidth * maskHeight);
  const ob = state.originalBounds;
  const isCornerMode = state.mode === 'distort' || state.mode === 'perspective';

  let quadToSquare: Homography | null = null;
  let c0: Point, c1: Point, c2: Point, c3: Point;

  if (isCornerMode) {
    [c0, c1, c2, c3] = getCornerPositions(state); // TL, TR, BR, BL
    quadToSquare = invertHomography(squareToQuad(c0, c1, c2, c3));
    if (!quadToSquare) return { mask: result, bounds: null };
  } else {
    c0 = forwardPoint(ob.x, ob.y, state);
    c1 = forwardPoint(ob.x + ob.width, ob.y, state);
    c2 = forwardPoint(ob.x + ob.width, ob.y + ob.height, state);
    c3 = forwardPoint(ob.x, ob.y + ob.height, state);
  }

  // Bilinear filtering reaches up to a pixel past the transformed box.
  const minX = Math.max(0, Math.floor(Math.min(c0.x, c1.x, c2.x, c3.x) - 2));
  const minY = Math.max(0, Math.floor(Math.min(c0.y, c1.y, c2.y, c3.y) - 2));
  const maxX = Math.min(maskWidth, Math.ceil(Math.max(c0.x, c1.x, c2.x, c3.x) + 2));
  const maxY = Math.min(maskHeight, Math.ceil(Math.max(c0.y, c1.y, c2.y, c3.y) + 2));

  let bMinX = maskWidth;
  let bMinY = maskHeight;
  let bMaxX = -1;
  let bMaxY = -1;
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const centre = { x: x + 0.5, y: y + 0.5 };
      const orig = quadToSquare
        ? inverseProjective(centre, quadToSquare, ob)
        : inversePoint(centre.x, centre.y, state);
      if (!orig) continue;
      const val = Math.round(sampleMask(originalMask, maskWidth, maskHeight, orig));
      if (val <= 0) continue;
      result[y * maskWidth + x] = val;
      if (x < bMinX) bMinX = x;
      if (x > bMaxX) bMaxX = x;
      if (y < bMinY) bMinY = y;
      if (y > bMaxY) bMaxY = y;
    }
  }

  const newBounds = bMaxX >= 0
    ? { x: bMinX, y: bMinY, width: bMaxX - bMinX + 1, height: bMaxY - bMinY + 1 }
    : null;

  return { mask: result, bounds: newBounds };
}
