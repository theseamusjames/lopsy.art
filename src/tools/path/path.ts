import type { Point, PixelSurface } from '../../types';
import { contextOptions } from '../../engine/color-space';

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

export function rasterizePath(
  buf: PixelSurface,
  anchors: PathAnchor[],
  closed: boolean,
  color: { r: number; g: number; b: number; a: number },
  strokeWidth: number,
): void {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = buf.width;
  tempCanvas.height = buf.height;
  const ctx = tempCanvas.getContext('2d', contextOptions);
  if (!ctx) return;

  ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${color.a})`;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    if (!anchor) continue;
    if (i === 0) {
      ctx.moveTo(anchor.point.x, anchor.point.y);
    } else {
      const prev = anchors[i - 1];
      if (!prev) continue;
      const cp1 = prev.handleOut ?? prev.point;
      const cp2 = anchor.handleIn ?? anchor.point;
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, anchor.point.x, anchor.point.y);
    }
  }
  if (closed && anchors.length >= 2) {
    const last = anchors[anchors.length - 1];
    const first = anchors[0];
    if (last && first) {
      const cp1 = last.handleOut ?? last.point;
      const cp2 = first.handleIn ?? first.point;
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, first.point.x, first.point.y);
    }
  }
  ctx.stroke();

  // Composite the stroked path onto the pixel buffer
  const pathData = ctx.getImageData(0, 0, buf.width, buf.height);
  for (let i = 0; i < pathData.data.length; i += 4) {
    const sa = (pathData.data[i + 3] ?? 0) / 255;
    if (sa <= 0) continue;
    const px = (i / 4) % buf.width;
    const py = Math.floor(i / 4 / buf.width);
    const existing = buf.getPixel(px, py);
    const outA = sa + existing.a * (1 - sa);
    if (outA > 0) {
      buf.setPixel(px, py, {
        r: Math.round(((pathData.data[i] ?? 0) * sa + existing.r * existing.a * (1 - sa)) / outA),
        g: Math.round(((pathData.data[i + 1] ?? 0) * sa + existing.g * existing.a * (1 - sa)) / outA),
        b: Math.round(((pathData.data[i + 2] ?? 0) * sa + existing.b * existing.a * (1 - sa)) / outA),
        a: outA,
      });
    }
  }
}
