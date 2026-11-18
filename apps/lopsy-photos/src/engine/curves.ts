/**
 * Tone-curve evaluation and LUT generation for the Curves group, ported
 * from lopsy-web's filters/curves.ts so both apps draw the same curve
 * (only the LUT builders; the CPU apply has no place here).
 *
 * A curve is a list of control points sorted by `x` (input intensity) with
 * `y` outputs in the unit interval. Endpoints at x=0 and x=1 are required.
 * Identity is `[{x:0,y:0},{x:1,y:1}]`.
 *
 * Interpolation uses the Fritsch–Carlson monotone cubic Hermite scheme so
 * a curve can never overshoot the [0,1] band between adjacent points —
 * critical for adjustments where overshoot causes clipping/inversion.
 */

export interface CurvePoint {
  /** Input intensity in [0, 1]. */
  readonly x: number;
  /** Output intensity in [0, 1]. */
  readonly y: number;
}

/** The four channels a Curves adjustment can target. */
export type CurveChannel = 'rgb' | 'r' | 'g' | 'b';

export interface Curves {
  readonly rgb: readonly CurvePoint[];
  readonly r: readonly CurvePoint[];
  readonly g: readonly CurvePoint[];
  readonly b: readonly CurvePoint[];
}

export const IDENTITY_POINTS: readonly CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

export const IDENTITY_CURVES: Curves = {
  rgb: IDENTITY_POINTS,
  r: IDENTITY_POINTS,
  g: IDENTITY_POINTS,
  b: IDENTITY_POINTS,
};

/** True when the curve has only the two endpoints at (0,0) and (1,1). */
export function isIdentityCurve(points: readonly CurvePoint[]): boolean {
  if (points.length !== 2) return false;
  const a = at(points, 0);
  const b = at(points, 1);
  return a.x === 0 && a.y === 0 && b.x === 1 && b.y === 1;
}

export function isIdentityCurves(curves: Curves | undefined | null): boolean {
  if (!curves) return true;
  return (
    isIdentityCurve(curves.rgb)
    && isIdentityCurve(curves.r)
    && isIdentityCurve(curves.g)
    && isIdentityCurve(curves.b)
  );
}

/**
 * Sort, clamp, and normalise control points so endpoints are always present.
 * Drops duplicate-x entries (last one wins).
 */
export function normalizePoints(points: readonly CurvePoint[]): CurvePoint[] {
  const clamped = points
    .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }))
    .sort((a, b) => a.x - b.x);

  // Dedupe by x (last write wins so callers can patch a point).
  const byX = new Map<number, CurvePoint>();
  for (const p of clamped) byX.set(p.x, p);
  const out = Array.from(byX.values()).sort((a, b) => a.x - b.x);

  // Ensure x=0 and x=1 anchors exist.
  if (!out.length || at(out, 0).x > 0) out.unshift({ x: 0, y: out[0]?.y ?? 0 });
  const last = at(out, out.length - 1);
  if (last.x < 1) out.push({ x: 1, y: last.y });
  return out;
}

/**
 * Compute monotonic Hermite tangents (Fritsch–Carlson). Returns one tangent
 * per point. Pure function — separated so it's easy to test.
 */
export function computeTangents(points: readonly CurvePoint[]): number[] {
  const n = points.length;
  if (n < 2) return [0];
  const slopes: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const dx = at(points, i + 1).x - at(points, i).x;
    slopes[i] = dx === 0 ? 0 : (at(points, i + 1).y - at(points, i).y) / dx;
  }

  const tangents: number[] = new Array(n);
  tangents[0] = at(slopes, 0);
  tangents[n - 1] = at(slopes, n - 2);
  for (let i = 1; i < n - 1; i++) {
    const s0 = at(slopes, i - 1);
    const s1 = at(slopes, i);
    tangents[i] = s0 * s1 <= 0 ? 0 : (s0 + s1) / 2;
  }

  // Monotonicity correction.
  for (let i = 0; i < n - 1; i++) {
    const sk = at(slopes, i);
    if (sk === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = at(tangents, i) / sk;
    const b = at(tangents, i + 1) / sk;
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      tangents[i] = t * a * sk;
      tangents[i + 1] = t * b * sk;
    }
  }
  return tangents;
}

/** Evaluate the curve at input `x` ∈ [0,1], returning `y` ∈ [0,1]. */
export function evaluateCurve(points: readonly CurvePoint[], x: number): number {
  const pts = normalizePoints(points);
  const t = computeTangents(pts);
  const xi = clamp01(x);

  // Binary search for the segment.
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at(pts, mid).x <= xi) lo = mid;
    else hi = mid;
  }
  return clamp01(hermite(at(pts, lo), at(pts, hi), at(t, lo), at(t, hi), xi));
}

function hermite(p0: CurvePoint, p1: CurvePoint, m0: number, m1: number, x: number): number {
  const h = p1.x - p0.x;
  if (h === 0) return p1.y;
  const t = (x - p0.x) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * p0.y + h10 * h * m0 + h01 * p1.y + h11 * h * m1;
}

/** Build a 256-entry [0,255] LUT by sampling the curve at every input. */
export function buildCurveLUT(points: readonly CurvePoint[]): Uint8Array {
  const lut = new Uint8Array(256);
  const pts = normalizePoints(points);
  if (isIdentityCurve(pts)) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  const t = computeTangents(pts);
  let seg = 0;
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    while (seg < pts.length - 2 && at(pts, seg + 1).x < x) seg++;
    const y = clamp01(hermite(at(pts, seg), at(pts, seg + 1), at(t, seg), at(t, seg + 1), x));
    lut[i] = Math.round(y * 255);
  }
  return lut;
}

/**
 * Pack the four per-channel LUTs into the 256×1 RGBA texture the GPU
 * shader samples. Layout: R=red curve, G=green curve, B=blue curve,
 * A=master RGB curve.
 */
export function buildCurvesLutRgba(curves: Curves): Uint8Array {
  const r = buildCurveLUT(curves.r);
  const g = buildCurveLUT(curves.g);
  const b = buildCurveLUT(curves.b);
  const rgb = buildCurveLUT(curves.rgb);
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    out[i * 4] = at(r, i);
    out[i * 4 + 1] = at(g, i);
    out[i * 4 + 2] = at(b, i);
    out[i * 4 + 3] = at(rgb, i);
  }
  return out;
}

/** An element that the surrounding logic guarantees exists. */
function at<T>(items: ArrayLike<T>, index: number): T {
  const value = items[index];
  if (value === undefined) throw new RangeError(`No element ${index}`);
  return value;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
