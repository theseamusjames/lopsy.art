import type { Point } from '../../types';

/** 3×3 row-major projective matrix. */
export type Homography = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/**
 * The projective map taking the unit square (0,0) (1,0) (1,1) (0,1) onto the
 * quad tl, tr, br, bl (Heckbert's closed form). Unlike bilinear
 * interpolation of the corners, this foreshortens: equal steps in v along a
 * receding edge land closer together on the narrow side (#927).
 */
export function squareToQuad(tl: Point, tr: Point, br: Point, bl: Point): Homography {
  const sx = tl.x - tr.x + br.x - bl.x;
  const sy = tl.y - tr.y + br.y - bl.y;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    return [
      tr.x - tl.x, bl.x - tl.x, tl.x,
      tr.y - tl.y, bl.y - tl.y, tl.y,
      0, 0, 1,
    ];
  }
  const dx1 = tr.x - br.x;
  const dx2 = bl.x - br.x;
  const dy1 = tr.y - br.y;
  const dy2 = bl.y - br.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = den === 0 ? 0 : (sx * dy2 - dx2 * sy) / den;
  const h = den === 0 ? 0 : (dx1 * sy - sx * dy1) / den;
  return [
    tr.x - tl.x + g * tr.x, bl.x - tl.x + h * bl.x, tl.x,
    tr.y - tl.y + g * tr.y, bl.y - tl.y + h * bl.y, tl.y,
    g, h, 1,
  ];
}

/**
 * True inverse (adjugate / det). Dividing by the determinant keeps w > 0 for
 * points inside a convex quad.
 */
export function invertHomography(m: Homography): Homography | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ];
}

/**
 * Apply a homography to a point. Returns null for points on or behind the
 * horizon (w ≤ 0), which have no pre-image inside a convex quad.
 */
export function applyHomography(m: Homography, x: number, y: number): Point | null {
  const w = m[6] * x + m[7] * y + m[8];
  if (w <= 1e-12) return null;
  return {
    x: (m[0] * x + m[1] * y + m[2]) / w,
    y: (m[3] * x + m[4] * y + m[5]) / w,
  };
}
