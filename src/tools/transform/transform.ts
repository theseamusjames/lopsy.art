import type { Point, Rect } from '../../types';

export type TransformHandle =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'right'
  | 'bottom-right'
  | 'bottom'
  | 'bottom-left'
  | 'left'
  | 'rotate-top-left'
  | 'rotate-top-right'
  | 'rotate-bottom-right'
  | 'rotate-bottom-left';

export type TransformMode = 'free' | 'skew' | 'distort' | 'perspective';

/** Per-corner offsets for distort/perspective modes (TL, TR, BR, BL) */
export type CornerOffsets = [Point, Point, Point, Point];

export interface TransformState {
  readonly originalBounds: Rect;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number; // radians
  readonly translateX: number;
  readonly translateY: number;
  readonly skewX: number; // radians
  readonly skewY: number; // radians
  readonly mode: TransformMode;
  /** Per-corner offsets from the original rect corners (distort/perspective) */
  readonly corners: CornerOffsets;
}

export function createTransformState(bounds: Rect, mode: TransformMode = 'free'): TransformState {
  return {
    originalBounds: bounds,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    translateX: 0,
    translateY: 0,
    skewX: 0,
    skewY: 0,
    mode,
    corners: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
  };
}

/** Get the 4 absolute corner positions for distort/perspective modes */
export function getCornerPositions(state: TransformState): [Point, Point, Point, Point] {
  const ob = state.originalBounds;
  const c = state.corners;
  return [
    { x: ob.x + c[0].x, y: ob.y + c[0].y },                           // TL
    { x: ob.x + ob.width + c[1].x, y: ob.y + c[1].y },                // TR
    { x: ob.x + ob.width + c[2].x, y: ob.y + ob.height + c[2].y },    // BR
    { x: ob.x + c[3].x, y: ob.y + ob.height + c[3].y },               // BL
  ];
}

export function getTransformedBounds(state: TransformState): Rect {
  const { originalBounds, scaleX, scaleY, translateX, translateY } = state;
  const cx = originalBounds.x + originalBounds.width / 2 + translateX;
  const cy = originalBounds.y + originalBounds.height / 2 + translateY;
  const w = originalBounds.width * Math.abs(scaleX);
  const h = originalBounds.height * Math.abs(scaleY);
  return {
    x: cx - w / 2,
    y: cy - h / 2,
    width: w,
    height: h,
  };
}

/**
 * Build the inverse 3×3 affine matrix for a TransformState.
 * Forward chain: T(cx+tx, cy+ty) · R(rot) · S(sx, sy) · Skew(kx, ky) · T(-cx, -cy)
 * Returns column-major Float32Array(9) for the GLSL mat3 uniform.
 */
/** Forward 2×2 `[a b; c d]` = R · S · Skew, applied about the bounds centre. */
function forwardAffine2x2(t: TransformState): [number, number, number, number] {
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  const kx = Math.tan(t.skewX);
  const ky = Math.tan(t.skewY);
  const sx = t.scaleX;
  const sy = t.scaleY;

  // Skew matrix: [1 kx; ky 1]
  // S · Skew: [sx  sx*kx; sy*ky  sy]
  // R · S · Skew:
  return [
    cos * sx + (-sin) * sy * ky,
    cos * sx * kx + (-sin) * sy,
    sin * sx + cos * sy * ky,
    sin * sx * kx + cos * sy,
  ];
}

/**
 * Axis-aligned document-space bounds of the transformed content: where the
 * pixels of `originalBounds` land once rotation, scale, skew, translation or
 * per-corner distortion is applied. Unlike `getTransformedBounds` this
 * accounts for rotation and skew, so it covers the whole rendered result.
 */
export function getTransformedContentBounds(t: TransformState): Rect {
  const ob = t.originalBounds;
  let points: Point[];
  if (t.mode === 'distort' || t.mode === 'perspective') {
    points = getCornerPositions(t);
  } else {
    const [a, b, c, d] = forwardAffine2x2(t);
    const cx = ob.x + ob.width / 2;
    const cy = ob.y + ob.height / 2;
    const corners: Point[] = [
      { x: ob.x, y: ob.y },
      { x: ob.x + ob.width, y: ob.y },
      { x: ob.x + ob.width, y: ob.y + ob.height },
      { x: ob.x, y: ob.y + ob.height },
    ];
    points = corners.map((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      return {
        x: a * dx + b * dy + cx + t.translateX,
        y: c * dx + d * dy + cy + t.translateY,
      };
    });
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/**
 * Axis-aligned bounds of `rect` after the transform whose INVERSE is `inv`
 * (column-major mat3, as passed to compositeFloatAffine), applied about the
 * rect's centre. Used for the instant flip / rotate-90° buttons, which only
 * hold the inverse matrix.
 */
export function mapRectThroughInverse(rect: Rect, inv: Float32Array): Rect {
  const ia = inv[0] ?? 1;
  const ic = inv[1] ?? 0;
  const ib = inv[3] ?? 0;
  const id = inv[4] ?? 1;
  const det = ia * id - ib * ic;
  if (Math.abs(det) < 1e-12) return { ...rect };
  const a = id / det;
  const b = -ib / det;
  const c = -ic / det;
  const d = ia / det;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  const extentX = Math.abs(a) * hw + Math.abs(b) * hh;
  const extentY = Math.abs(c) * hw + Math.abs(d) * hh;
  return { x: cx - extentX, y: cy - extentY, width: 2 * extentX, height: 2 * extentY };
}

export function computeInverseAffineMatrix(t: TransformState): Float32Array {
  const [a, b, c, d] = forwardAffine2x2(t);

  // Forward 3×3 (with translation folded in):
  // [a b tx+cx; c d ty+cy; 0 0 1] where the translate(-cx,-cy) is pre-applied
  // But we pass the center separately to the shader, so we just need the 2×2 inverse.

  // Inverse of 2×2 [a b; c d]
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) {
    return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  }
  const invDet = 1 / det;
  const ia = d * invDet;
  const ib = -b * invDet;
  const ic = -c * invDet;
  const id = a * invDet;

  // Column-major mat3 for GLSL:
  // col0 = (ia, ic, 0), col1 = (ib, id, 0), col2 = (0, 0, 1)
  return new Float32Array([
    ia, ic, 0,
    ib, id, 0,
    0, 0, 1,
  ]);
}

export {
  getHandlePositions,
  hitTestHandle,
  isScaleHandle,
  isRotateHandle,
  getCursorForHandle,
} from './transform-handles';

export { computeScale, computeRotation } from './transform-compute';

export { computeSkew } from './transform-skew';

export { applyTransformToMask } from './transform-mask';

export { computeDistort, computePerspective } from './transform-distort';
