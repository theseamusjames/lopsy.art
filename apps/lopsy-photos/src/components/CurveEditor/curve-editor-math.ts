/** The editing rules of CurveEditor: adding, moving and removing points. */

import { evaluateCurve, normalizePoints, type CurvePoint } from '../../engine/curves';

/** Closest two points may come in x. */
export const MIN_GAP = 0.01;
/** How near (as a share of the box) a press must be to grab a point. */
export const HIT_RADIUS = 0.04;

/** The index of the point nearest (x, y) within the hit radius, or null. */
export function hitPoint(points: readonly CurvePoint[], x: number, y: number, radius = HIT_RADIUS): number | null {
  let best: number | null = null;
  let bestDistance = radius;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Adds a point at x on the curve's current height (or at y when given); returns the points and its index. */
export function addPoint(points: readonly CurvePoint[], x: number, y?: number): { points: CurvePoint[]; index: number } {
  const sorted = normalizePoints(points);
  const px = clamp01(x);
  if (sorted.some((p) => Math.abs(p.x - px) < MIN_GAP)) {
    const index = sorted.findIndex((p) => Math.abs(p.x - px) < MIN_GAP);
    return { points: sorted, index };
  }
  const point = { x: px, y: clamp01(y ?? evaluateCurve(sorted, px)) };
  const next = [...sorted, point].sort((a, b) => a.x - b.x);
  return { points: next, index: next.indexOf(point) };
}

/**
 * Moves point `index` to (x, y). End points move only up and down; inner
 * points stay between their neighbours.
 */
export function movePoint(points: readonly CurvePoint[], index: number, x: number, y: number): CurvePoint[] {
  const next = points.map((p) => ({ ...p }));
  const point = next[index];
  if (!point) return next;
  const isEnd = index === 0 || index === next.length - 1;
  const left = next[index - 1];
  const right = next[index + 1];
  const nx = isEnd ? point.x : Math.min((right?.x ?? 1) - MIN_GAP, Math.max((left?.x ?? 0) + MIN_GAP, x));
  next[index] = { x: nx, y: clamp01(y) };
  return next;
}

/** Removes an inner point; end points stay. */
export function removePoint(points: readonly CurvePoint[], index: number): CurvePoint[] {
  if (index <= 0 || index >= points.length - 1) return [...points];
  return points.filter((_, i) => i !== index);
}

/** An SVG polyline of the curve in a `size`×`size` box, y up. */
export function curvePath(points: readonly CurvePoint[], size: number, samples = 64): string {
  const fmt = (v: number) => Number(v.toFixed(2)).toString();
  const parts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const x = i / samples;
    const y = evaluateCurve(points, x);
    parts.push(`${i === 0 ? 'M' : 'L'}${fmt(x * size)},${fmt((1 - y) * size)}`);
  }
  return parts.join('');
}

/** Whether the points are the straight line. */
export function isStraight(points: readonly CurvePoint[]): boolean {
  const p = normalizePoints(points);
  return p.length === 2 && p[0]?.y === 0 && p[1]?.y === 1;
}
