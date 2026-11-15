import type { Rect } from '../../types';

/**
 * Alignment guides for a Move drag: the moving content's left / centre /
 * right and top / middle / bottom are compared with the same features of
 * every other piece of content (and of the canvas). Targets are built once
 * when the drag starts; `findAlignment` runs on every pointer move, so it
 * only allocates for the guides it actually returns.
 */

/** How close, in screen pixels, a feature must come to a target to align. */
export const ALIGNMENT_SCREEN_PX = 6;

/** One alignable feature: a coordinate and the extent of its box along the line. */
export interface AlignmentTarget {
  readonly position: number;
  readonly spanStart: number;
  readonly spanEnd: number;
}

export interface AlignmentTargets {
  /** x positions, drawn as vertical lines. */
  readonly vertical: readonly AlignmentTarget[];
  /** y positions, drawn as horizontal lines. */
  readonly horizontal: readonly AlignmentTarget[];
}

export interface AlignmentGuide {
  readonly orientation: 'vertical' | 'horizontal';
  /** x of a vertical guide, y of a horizontal one. */
  readonly position: number;
  /** Where the line starts and ends along its own axis. */
  readonly start: number;
  readonly end: number;
}

export interface AlignmentResult {
  /** Shift that lands the nearest x feature exactly on its target, or null when none is in reach. */
  readonly dx: number | null;
  readonly dy: number | null;
  readonly guides: AlignmentGuide[];
}

/** Two features count as aligned when they differ by at most this much (sub-pixel centres). */
const ALIGNED_EPSILON = 0.5;

function pushFeatures(out: AlignmentTarget[], a: number, b: number, spanStart: number, spanEnd: number): void {
  out.push({ position: a, spanStart, spanEnd });
  out.push({ position: (a + b) / 2, spanStart, spanEnd });
  out.push({ position: b, spanStart, spanEnd });
}

/** Targets for every rect's edges and centres, plus the canvas's. */
export function buildAlignmentTargets(
  rects: readonly Rect[],
  docWidth: number,
  docHeight: number,
): AlignmentTargets {
  const vertical: AlignmentTarget[] = [];
  const horizontal: AlignmentTarget[] = [];
  pushFeatures(vertical, 0, docWidth, 0, docHeight);
  pushFeatures(horizontal, 0, docHeight, 0, docWidth);
  for (const r of rects) {
    if (r.width <= 0 || r.height <= 0) continue;
    pushFeatures(vertical, r.x, r.x + r.width, r.y, r.y + r.height);
    pushFeatures(horizontal, r.y, r.y + r.height, r.x, r.x + r.width);
  }
  return { vertical, horizontal };
}

/** Smallest bounding rect around `rects`, or null when there are none. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    if (r.width <= 0 || r.height <= 0) continue;
    left = Math.min(left, r.x);
    top = Math.min(top, r.y);
    right = Math.max(right, r.x + r.width);
    bottom = Math.max(bottom, r.y + r.height);
  }
  if (right < left) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function nearestShift(
  start: number,
  size: number,
  targets: readonly AlignmentTarget[],
  threshold: number,
): number | null {
  let best: number | null = null;
  for (const t of targets) {
    for (let i = 0; i <= 2; i++) {
      const d = t.position - (start + (size * i) / 2);
      if (Math.abs(d) > threshold) continue;
      if (best === null || Math.abs(d) < Math.abs(best)) best = d;
    }
  }
  return best;
}

function collectGuides(
  orientation: AlignmentGuide['orientation'],
  start: number,
  size: number,
  crossStart: number,
  crossEnd: number,
  shift: number,
  targets: readonly AlignmentTarget[],
  out: AlignmentGuide[],
): void {
  const firstOfAxis = out.length;
  for (const t of targets) {
    for (let i = 0; i <= 2; i++) {
      const d = t.position - (start + (size * i) / 2);
      if (Math.abs(d - shift) > ALIGNED_EPSILON) continue;
      const lo = Math.min(crossStart, t.spanStart);
      const hi = Math.max(crossEnd, t.spanEnd);
      let merged = false;
      for (let g = firstOfAxis; g < out.length; g++) {
        const guide = out[g];
        if (!guide || guide.position !== t.position) continue;
        out[g] = { orientation, position: t.position, start: Math.min(guide.start, lo), end: Math.max(guide.end, hi) };
        merged = true;
        break;
      }
      if (!merged) out.push({ orientation, position: t.position, start: lo, end: hi });
    }
  }
}

/**
 * Which of `moving`'s features line up with a target. On each axis the
 * nearest pair within `threshold` decides the shift; every pair that the
 * same shift would align gets a guide, spanning both boxes.
 */
export function findAlignment(
  moving: Rect,
  targets: AlignmentTargets,
  threshold: number,
): AlignmentResult {
  const dx = nearestShift(moving.x, moving.width, targets.vertical, threshold);
  const dy = nearestShift(moving.y, moving.height, targets.horizontal, threshold);
  const guides: AlignmentGuide[] = [];
  if (dx !== null) {
    collectGuides('vertical', moving.x, moving.width, moving.y, moving.y + moving.height, dx, targets.vertical, guides);
  }
  if (dy !== null) {
    collectGuides('horizontal', moving.y, moving.height, moving.x, moving.x + moving.width, dy, targets.horizontal, guides);
  }
  return { dx, dy, guides };
}

/** Whether two guide lists draw the same lines, so callers can skip a redundant store update. */
export function sameGuides(a: readonly AlignmentGuide[], b: readonly AlignmentGuide[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => {
    const q = b[i];
    return q !== undefined && p.orientation === q.orientation && p.position === q.position
      && p.start === q.start && p.end === q.end;
  });
}
