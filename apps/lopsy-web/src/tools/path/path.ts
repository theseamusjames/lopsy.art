import type { Point } from '../../types';

export interface PathAnchor {
  point: Point;
  handleIn: Point | null;
  handleOut: Point | null;
}

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Returns the index of the anchor nearest to `pt` within `threshold`, or -1. */
export function hitTestAnchor(
  anchors: readonly PathAnchor[],
  pt: Point,
  threshold: number,
): number {
  let closest = -1;
  let closestDist = threshold;
  for (let i = 0; i < anchors.length; i++) {
    const d = dist(pt, anchors[i]!.point);
    if (d < closestDist) {
      closestDist = d;
      closest = i;
    }
  }
  return closest;
}

export interface HandleHit {
  anchorIndex: number;
  handle: 'in' | 'out';
}

/** Returns the anchor index and handle type nearest to `pt` within `threshold`, or null. */
export function hitTestHandle(
  anchors: readonly PathAnchor[],
  pt: Point,
  threshold: number,
): HandleHit | null {
  let best: HandleHit | null = null;
  let bestDist = threshold;
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i]!;
    if (anchor.handleIn) {
      const d = dist(pt, anchor.handleIn);
      if (d < bestDist) {
        bestDist = d;
        best = { anchorIndex: i, handle: 'in' };
      }
    }
    if (anchor.handleOut) {
      const d = dist(pt, anchor.handleOut);
      if (d < bestDist) {
        bestDist = d;
        best = { anchorIndex: i, handle: 'out' };
      }
    }
  }
  return best;
}

function bezierPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/**
 * Returns the segment index (0-based) if `pt` is within `threshold` of any
 * bezier segment, or -1. Segment i connects anchor[i] to anchor[i+1].
 */
export function hitTestSegment(
  anchors: readonly PathAnchor[],
  closed: boolean,
  pt: Point,
  threshold: number,
): number {
  const segCount = closed ? anchors.length : anchors.length - 1;
  for (let i = 0; i < segCount; i++) {
    const a = anchors[i]!;
    const b = anchors[(i + 1) % anchors.length]!;
    const cp1 = a.handleOut ?? a.point;
    const cp2 = b.handleIn ?? b.point;
    const steps = 20;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const p = bezierPoint(a.point, cp1, cp2, b.point, t);
      if (dist(pt, p) < threshold) return i;
    }
  }
  return -1;
}

/** Split segment at index, inserting a new anchor at the midpoint. */
export function splitSegmentAt(
  anchors: readonly PathAnchor[],
  segmentIndex: number,
): PathAnchor[] {
  const result = [...anchors];
  const a = anchors[segmentIndex]!;
  const b = anchors[(segmentIndex + 1) % anchors.length]!;
  const cp1 = a.handleOut ?? a.point;
  const cp2 = b.handleIn ?? b.point;
  const mid = bezierPoint(a.point, cp1, cp2, b.point, 0.5);
  const newAnchor: PathAnchor = { point: mid, handleIn: null, handleOut: null };
  result.splice(segmentIndex + 1, 0, newAnchor);
  return result;
}

/** The drawing calls {@link tracePath} makes — a Canvas 2D context satisfies it. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
}

/** Emit the path's segments as cubic béziers, offset by (`dx`, `dy`). */
export function tracePath(
  sink: PathSink,
  anchors: readonly PathAnchor[],
  closed: boolean,
  dx = 0,
  dy = 0,
): void {
  const segment = (from: PathAnchor, to: PathAnchor): void => {
    const cp1 = from.handleOut ?? from.point;
    const cp2 = to.handleIn ?? to.point;
    sink.bezierCurveTo(cp1.x + dx, cp1.y + dy, cp2.x + dx, cp2.y + dy, to.point.x + dx, to.point.y + dy);
  };
  const first = anchors[0];
  if (!first) return;
  sink.moveTo(first.point.x + dx, first.point.y + dy);
  for (let i = 1; i < anchors.length; i++) segment(anchors[i - 1]!, anchors[i]!);
  if (closed && anchors.length >= 2) segment(anchors[anchors.length - 1]!, first);
}

/**
 * Integer pixel rect covering everything a stroke of `strokeWidth` along the
 * path can touch, or null for an empty path. A cubic bézier stays inside the
 * hull of its points and handles, so their bounds padded by half the width
 * (plus a pixel of anti-aliasing) contain the stroke, round joins and caps
 * included.
 */
export function pathStrokeBounds(
  anchors: readonly PathAnchor[],
  strokeWidth: number,
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const a of anchors) {
    for (const p of [a.point, a.handleIn, a.handleOut]) {
      if (!p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (maxX < minX) return null;
  const pad = strokeWidth / 2 + 1;
  const x = Math.floor(minX - pad);
  const y = Math.floor(minY - pad);
  return { x, y, width: Math.ceil(maxX + pad) - x, height: Math.ceil(maxY + pad) - y };
}
