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

/**
 * True when the transform changes the content's shape — rotation, scale,
 * skew or a dragged corner — rather than only (or not even) translating it.
 */
export function isShapeChangingTransform(t: TransformState): boolean {
  if (t.rotation !== 0 || t.scaleX !== 1 || t.scaleY !== 1) return true;
  if (t.skewX !== 0 || t.skewY !== 0) return true;
  return t.corners.some((c) => c.x !== 0 || c.y !== 0);
}

/**
 * Shift a transform by (dx, dy) in document space, keeping its shape.
 * Corner modes place their corners relative to `originalBounds` and ignore
 * `translateX/Y`, so the corners themselves are offset there.
 */
export function translateTransform(t: TransformState, dx: number, dy: number): TransformState {
  if (t.mode === 'distort' || t.mode === 'perspective') {
    return {
      ...t,
      corners: t.corners.map((c) => ({ x: c.x + dx, y: c.y + dy })) as unknown as CornerOffsets,
    };
  }
  return { ...t, translateX: t.translateX + dx, translateY: t.translateY + dy };
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
 * A document-space affine map in canvas `setTransform` order:
 * `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
 */
export interface DocumentAffine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

/** How far (document px) a corner may sit off the parallelogram before a corner map counts as non-affine. */
const PARALLELOGRAM_TOLERANCE = 0.01;

/**
 * The document-space map `t` applies to the content, when it is affine:
 * always in Free / Skew, and in Distort / Perspective only while the four
 * corners still form a parallelogram (untouched, moved, or flipped). Null
 * for a true corner distortion, or an empty box in a corner mode.
 */
export function documentAffineOf(t: TransformState): DocumentAffine | null {
  const ob = t.originalBounds;
  if (t.mode === 'distort' || t.mode === 'perspective') {
    if (ob.width <= 0 || ob.height <= 0) return null;
    const [tl, tr, br, bl] = getCornerPositions(t);
    const offX = tr.x + bl.x - tl.x - br.x;
    const offY = tr.y + bl.y - tl.y - br.y;
    if (Math.hypot(offX, offY) > PARALLELOGRAM_TOLERANCE) return null;
    const a = (tr.x - tl.x) / ob.width;
    const b = (tr.y - tl.y) / ob.width;
    const c = (bl.x - tl.x) / ob.height;
    const d = (bl.y - tl.y) / ob.height;
    return { a, b, c, d, e: tl.x - a * ob.x - c * ob.y, f: tl.y - b * ob.x - d * ob.y };
  }
  // forwardAffine2x2 is row-major `[x'; y'] = [m0 m1; m2 m3] · [x; y]`.
  const [m0, m1, m2, m3] = forwardAffine2x2(t);
  const cx = ob.x + ob.width / 2;
  const cy = ob.y + ob.height / 2;
  return {
    a: m0,
    b: m2,
    c: m1,
    d: m3,
    e: cx + t.translateX - (m0 * cx + m1 * cy),
    f: cy + t.translateY - (m2 * cx + m3 * cy),
  };
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
  hitTestBoxHandle,
  isScaleHandle,
  isRotateHandle,
  getCursorForHandle,
} from './transform-handles';

export { computeScale, computeRotation } from './transform-compute';

export { computeSkew } from './transform-skew';

export { applyTransformToMask } from './transform-mask';

export { computeDistort, computePerspective } from './transform-distort';
