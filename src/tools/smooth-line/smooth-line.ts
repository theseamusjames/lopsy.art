/**
 * Smooth-line logic: detects whether a freehand stroke can be simplified
 * to a straight line or a smooth spline, and produces evenly-spaced points
 * along the simplified path.
 *
 * All functions are pure — no DOM, no React, no side effects.
 */

import type { Point } from '../../types';

/** How long the cursor must stay still during a stroke to trigger smoothing. */
export const HOLD_TIMEOUT_MS = 1500;

// ── Ramer-Douglas-Peucker simplification ────────────────────────────

function perpendicularDistance(
  pt: Point,
  lineStart: Point,
  lineEnd: Point,
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) {
    const ex = pt.x - lineStart.x;
    const ey = pt.y - lineStart.y;
    return Math.sqrt(ex * ex + ey * ey);
  }
  const t = Math.max(0, Math.min(1, ((pt.x - lineStart.x) * dx + (pt.y - lineStart.y) * dy) / lenSq));
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;
  const ex = pt.x - projX;
  const ey = pt.y - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

/**
 * Ramer-Douglas-Peucker polyline simplification.
 * Returns a subset of the input points that approximates the shape
 * within `epsilon` perpendicular distance.
 */
export function rdpSimplify(points: ReadonlyArray<Point>, epsilon: number): Point[] {
  if (points.length <= 2) return points.slice();

  const first = points[0]!;
  const last = points[points.length - 1]!;

  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist <= epsilon) {
    return [first, last];
  }

  const left = rdpSimplify(points.slice(0, maxIdx + 1), epsilon);
  const right = rdpSimplify(points.slice(maxIdx), epsilon);
  return left.slice(0, -1).concat(right);
}

// ── Straightness detection ──────────────────────────────────────────

/**
 * Returns true when all points lie within `tolerance` pixels of the
 * line from the first to the last point. The tolerance is the larger
 * of the fixed minimum and a percentage of the stroke length, so that
 * long strokes with small relative wobble are still classified as
 * straight.
 */
export function isStraightStroke(
  points: ReadonlyArray<Point>,
  tolerance: number = 4,
): boolean {
  if (points.length <= 2) return true;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const strokeLen = Math.sqrt(dx * dx + dy * dy);

  // Use the larger of: fixed tolerance OR 10% of stroke length
  const effectiveTolerance = Math.max(tolerance, strokeLen * 0.1);

  for (let i = 1; i < points.length - 1; i++) {
    if (perpendicularDistance(points[i]!, first, last) > effectiveTolerance) {
      return false;
    }
  }
  return true;
}

// ── Catmull-Rom spline interpolation ────────────────────────────────

function catmullRomPoint(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number,
): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

/**
 * Walk a Catmull-Rom spline through `controlPoints`, emitting samples
 * every `spacing` pixels (approximately).
 */
function sampleCatmullRom(
  controlPoints: ReadonlyArray<Point>,
  spacing: number,
): Point[] {
  if (controlPoints.length < 2) return controlPoints.slice();
  if (controlPoints.length === 2) {
    return interpolateLine(controlPoints[0]!, controlPoints[1]!, spacing);
  }

  const result: Point[] = [controlPoints[0]!];
  let accumDist = 0;
  let prev = controlPoints[0]!;

  const n = controlPoints.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = controlPoints[Math.max(i - 1, 0)]!;
    const p1 = controlPoints[i]!;
    const p2 = controlPoints[Math.min(i + 1, n - 1)]!;
    const p3 = controlPoints[Math.min(i + 2, n - 1)]!;

    // Estimate segment arc length for adaptive step count
    const segDx = p2.x - p1.x;
    const segDy = p2.y - p1.y;
    const segLen = Math.sqrt(segDx * segDx + segDy * segDy);
    const steps = Math.max(2, Math.ceil(segLen / (spacing * 0.5)));

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const pt = catmullRomPoint(p0, p1, p2, p3, t);
      const dx = pt.x - prev.x;
      const dy = pt.y - prev.y;
      accumDist += Math.sqrt(dx * dx + dy * dy);
      prev = pt;

      if (accumDist >= spacing) {
        result.push(pt);
        accumDist = 0;
      }
    }
  }

  // Always include the endpoint
  const last = controlPoints[n - 1]!;
  const tail = result[result.length - 1]!;
  if (Math.abs(tail.x - last.x) > 0.01 || Math.abs(tail.y - last.y) > 0.01) {
    result.push(last);
  }

  return result;
}

// ── Straight-line interpolation ─────────────────────────────────────

function interpolateLine(from: Point, to: Point, spacing: number): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-6) return [from];

  const count = Math.max(1, Math.ceil(dist / spacing));
  const pts: Point[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    pts.push({ x: from.x + dx * t, y: from.y + dy * t });
  }
  return pts;
}

// ── Public API ──────────────────────────────────────────────────────

export interface SmoothResult {
  /** The simplified control points (RDP output). */
  controlPoints: Point[];
  /** Whether the stroke was classified as straight. */
  isStraight: boolean;
  /** Evenly-spaced sample points ready for re-drawing. */
  sampledPoints: Point[];
}

/**
 * Analyse a raw freehand stroke and produce a smoothed version.
 *
 * - If the stroke is approximately collinear, returns a straight line
 *   from first to last point.
 * - Otherwise, simplifies with RDP then interpolates a Catmull-Rom
 *   spline through the simplified control points.
 *
 * @param rawPoints  The recorded freehand stroke (layer-space).
 * @param spacing    Distance between emitted sample points (pixels).
 * @param epsilon    RDP simplification tolerance (pixels).  Default 9.
 * @param straightTolerance  Max perpendicular deviation for "straight" (pixels).  Default 4.
 */
export function smoothStroke(
  rawPoints: ReadonlyArray<Point>,
  spacing: number,
  epsilon: number = 9,
  straightTolerance: number = 4,
): SmoothResult {
  if (rawPoints.length <= 1) {
    return {
      controlPoints: rawPoints.slice(),
      isStraight: true,
      sampledPoints: rawPoints.slice(),
    };
  }

  const first = rawPoints[0]!;
  const last = rawPoints[rawPoints.length - 1]!;

  if (isStraightStroke(rawPoints, straightTolerance)) {
    return {
      controlPoints: [first, last],
      isStraight: true,
      sampledPoints: interpolateLine(first, last, spacing),
    };
  }

  const simplified = rdpSimplify(rawPoints, epsilon);
  const sampled = sampleCatmullRom(simplified, spacing);

  return {
    controlPoints: simplified,
    isStraight: false,
    sampledPoints: sampled,
  };
}
