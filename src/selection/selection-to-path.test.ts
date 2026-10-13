import { describe, it, expect } from 'vitest';
import type { PathAnchor } from '../tools/path/path';
import type { Point } from '../types';
import { selectionToPath, selectionToPaths } from './selection-to-path';
import { createRectSelection, createEllipseSelection, isEmptySelection } from './selection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmptyMask(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('selectionToPath', () => {
  it('returns empty array for an empty mask', () => {
    const mask = makeEmptyMask(100, 100);
    const anchors = selectionToPath(mask, 100, 100);
    expect(anchors).toHaveLength(0);
  });

  it('returns empty array when mask has all zeros', () => {
    const mask = makeEmptyMask(50, 50);
    expect(isEmptySelection(mask)).toBe(true);
    const anchors = selectionToPath(mask, 50, 50);
    expect(anchors).toHaveLength(0);
  });

  it('rectangle mask produces anchors approximating a rectangle', () => {
    // 100x100 canvas with a 40x30 rectangle selection starting at (20,15)
    const W = 100;
    const H = 100;
    const mask = createRectSelection({ x: 20, y: 15, width: 40, height: 30 }, W, H);

    // Use tight tolerance so we get at least 4 corner-ish anchors
    const anchors = selectionToPath(mask, W, H, 1);

    // Should produce at least 4 anchors (corners of the rectangle)
    expect(anchors.length).toBeGreaterThanOrEqual(4);

    // All anchor points should be within or very near the selection bounds
    for (const a of anchors) {
      expect(a.point.x).toBeGreaterThanOrEqual(18);
      expect(a.point.x).toBeLessThanOrEqual(62);
      expect(a.point.y).toBeGreaterThanOrEqual(13);
      expect(a.point.y).toBeLessThanOrEqual(47);
    }
  });

  it('rectangle mask anchor points span the expected bounding box', () => {
    const W = 200;
    const H = 200;
    const rect = { x: 50, y: 40, width: 80, height: 60 };
    const mask = createRectSelection(rect, W, H);

    const anchors = selectionToPath(mask, W, H, 1);
    expect(anchors.length).toBeGreaterThan(0);

    const xs = anchors.map((a) => a.point.x);
    const ys = anchors.map((a) => a.point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // The path should span from ~50 to ~130 in x, and ~40 to ~100 in y
    // Allow 2px tolerance for boundary pixel positions
    expect(minX).toBeCloseTo(50, 0);
    expect(maxX).toBeCloseTo(130, 0);
    expect(minY).toBeCloseTo(40, 0);
    expect(maxY).toBeCloseTo(100, 0);
  });

  it('circle-ish mask produces a closed path with multiple anchors', () => {
    const W = 200;
    const H = 200;
    // Ellipse that approximates a circle
    const mask = createEllipseSelection({ x: 50, y: 50, width: 100, height: 100 }, W, H);

    const anchors = selectionToPath(mask, W, H, 2);

    // Should produce several anchors (a circle needs at least 4)
    expect(anchors.length).toBeGreaterThanOrEqual(4);

    // All anchor points should lie on the circle boundary (within a few pixels)
    const cx = 100;
    const cy = 100;
    const r = 50;
    for (const a of anchors) {
      const dist = Math.sqrt((a.point.x - cx) ** 2 + (a.point.y - cy) ** 2);
      // Allow ~3px tolerance
      expect(dist).toBeGreaterThan(r - 4);
      expect(dist).toBeLessThan(r + 4);
    }
  });

  it('anchors have smooth handles (handleIn/handleOut not all null) for a circle', () => {
    const W = 200;
    const H = 200;
    const mask = createEllipseSelection({ x: 40, y: 40, width: 120, height: 120 }, W, H);

    const anchors = selectionToPath(mask, W, H, 2);

    // Interior anchors of a closed path should have handles
    const withHandles = anchors.filter((a) => a.handleIn !== null || a.handleOut !== null);
    expect(withHandles.length).toBeGreaterThan(0);
  });

  it('produces different results with different tolerances', () => {
    const W = 200;
    const H = 200;
    const mask = createEllipseSelection({ x: 30, y: 30, width: 140, height: 140 }, W, H);

    const coarse = selectionToPath(mask, W, H, 8);
    const fine = selectionToPath(mask, W, H, 1);

    // Coarser tolerance → fewer anchors
    expect(coarse.length).toBeLessThanOrEqual(fine.length);
  });

  it('handles a single-pixel selection gracefully', () => {
    const W = 10;
    const H = 10;
    const mask = new Uint8ClampedArray(W * H);
    mask[5 * W + 5] = 255; // single pixel

    // Should either return empty or very small path without throwing
    expect(() => selectionToPath(mask, W, H)).not.toThrow();
  });

  // #821 — each anchor's handleIn must point away from the previous
  // anchor (i.e. be on the opposite side of the anchor point from
  // handleOut), not forward toward the next anchor. The pre-fix code
  // stored `handleIn` at `next.x + tangentIn.x`, which put both handles
  // on the same side and kinked every segment.
  it('handleIn opposes handleOut about the anchor point (#821)', () => {
    const W = 200;
    const H = 200;
    const mask = createEllipseSelection({ x: 40, y: 40, width: 120, height: 120 }, W, H);

    const anchors = selectionToPath(mask, W, H, 2);
    // Closed path: every anchor has both handles.
    const bothHandles = anchors.filter((a) => a.handleIn && a.handleOut);
    expect(bothHandles.length).toBe(anchors.length);

    for (const a of bothHandles) {
      const dxIn = a.handleIn!.x - a.point.x;
      const dyIn = a.handleIn!.y - a.point.y;
      const dxOut = a.handleOut!.x - a.point.x;
      const dyOut = a.handleOut!.y - a.point.y;
      // A circle has no corners, so every anchor is smooth: handleIn and
      // handleOut are collinear and point in opposite directions. Their
      // lengths follow the adjacent segment lengths (#1276).
      const lenIn = Math.hypot(dxIn, dyIn);
      const lenOut = Math.hypot(dxOut, dyOut);
      const cos = (dxIn * dxOut + dyIn * dyOut) / (lenIn * lenOut);
      expect(cos).toBeCloseTo(-1, 5);
    }
  });
});

describe('selectionToPaths (#1133)', () => {
  function bbox(anchors: { point: { x: number; y: number } }[]) {
    const xs = anchors.map((a) => a.point.x);
    const ys = anchors.map((a) => a.point.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }

  it('traces every separate region of a selection', () => {
    const W = 200;
    const H = 150;
    const a = createRectSelection({ x: 10, y: 10, width: 40, height: 30 }, W, H);
    const b = createRectSelection({ x: 100, y: 80, width: 60, height: 50 }, W, H);
    const mask = a.map((v, i) => Math.max(v, b[i] ?? 0));

    const paths = selectionToPaths(mask, W, H, 1);
    expect(paths).toHaveLength(2);
    expect(bbox(paths[0]!)).toEqual({ minX: 10, minY: 10, maxX: 50, maxY: 40 });
    expect(bbox(paths[1]!)).toEqual({ minX: 100, minY: 80, maxX: 160, maxY: 130 });
  });

  it('returns no paths for an empty mask', () => {
    expect(selectionToPaths(makeEmptyMask(20, 20), 20, 20)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #1276 — corners stay sharp, handles stay inside the shape, no knot at the
// trace start
// ---------------------------------------------------------------------------

function sampleClosedPath(anchors: PathAnchor[], stepsPerSegment = 32): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]!;
    const b = anchors[(i + 1) % anchors.length]!;
    const p0 = a.point;
    const p1 = a.handleOut ?? a.point;
    const p2 = b.handleIn ?? b.point;
    const p3 = b.point;
    for (let s = 0; s < stepsPerSegment; s++) {
      const t = s / stepsPerSegment;
      const u = 1 - t;
      out.push({
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      });
    }
  }
  return out;
}

function allHandles(anchors: PathAnchor[]): Point[] {
  const out: Point[] = [];
  for (const a of anchors) {
    if (a.handleIn) out.push(a.handleIn);
    if (a.handleOut) out.push(a.handleOut);
  }
  return out;
}

function minAnchorSpacing(anchors: PathAnchor[]): number {
  let min = Infinity;
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const a = anchors[i]!.point;
      const b = anchors[j]!.point;
      min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return min;
}

/** First-order distance from p to the ellipse (|f| / |grad f|). */
function ellipseDistance(p: Point, cx: number, cy: number, rx: number, ry: number): number {
  const dx = p.x - cx;
  const dy = p.y - cy;
  const f = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) - 1;
  const gx = (2 * dx) / (rx * rx);
  const gy = (2 * dy) / (ry * ry);
  return Math.abs(f) / Math.hypot(gx, gy);
}

/** Sine of the angle between an anchor's two handles (0 = smooth). */
function handleSine(a: PathAnchor): number {
  const ix = a.handleIn!.x - a.point.x;
  const iy = a.handleIn!.y - a.point.y;
  const ox = a.handleOut!.x - a.point.x;
  const oy = a.handleOut!.y - a.point.y;
  return Math.abs(ix * oy - iy * ox) / (Math.hypot(ix, iy) * Math.hypot(ox, oy));
}

function expectSmooth(a: PathAnchor): void {
  expect(handleSine(a)).toBeLessThan(1e-6);
  const dot =
    (a.handleIn!.x - a.point.x) * (a.handleOut!.x - a.point.x) +
    (a.handleIn!.y - a.point.y) * (a.handleOut!.y - a.point.y);
  expect(dot).toBeLessThan(0);
}

describe('selectionToPaths corners and handles (#1276)', () => {
  it("turns the issue's 400x500 marquee into exactly its four corners", () => {
    const W = 800;
    const H = 900;
    const mask = createRectSelection({ x: 200, y: 200, width: 400, height: 500 }, W, H);
    const paths = selectionToPaths(mask, W, H);
    expect(paths).toHaveLength(1);
    const points = paths[0]!.map((a) => `${a.point.x},${a.point.y}`).sort();
    expect(points).toEqual(['200,200', '200,700', '600,200', '600,700']);
  });

  it('gives rectangle corners straight handles that stay on the edges', () => {
    const W = 800;
    const H = 900;
    const mask = createRectSelection({ x: 200, y: 200, width: 400, height: 500 }, W, H);
    const anchors = selectionToPaths(mask, W, H)[0]!;

    for (const h of allHandles(anchors)) {
      expect(h.x).toBeGreaterThanOrEqual(200);
      expect(h.x).toBeLessThanOrEqual(600);
      expect(h.y).toBeGreaterThanOrEqual(200);
      expect(h.y).toBeLessThanOrEqual(700);
    }

    // Each corner's handles lie on its two edges and are perpendicular,
    // so the corner is not smoothed and every side is a straight line.
    for (const a of anchors) {
      const hIn = a.handleIn!;
      const hOut = a.handleOut!;
      expect(hIn.x === a.point.x || hIn.y === a.point.y).toBe(true);
      expect(hOut.x === a.point.x || hOut.y === a.point.y).toBe(true);
      expect(handleSine(a)).toBeCloseTo(1, 9);
    }

    for (const p of sampleClosedPath(anchors)) {
      expect(p.x).toBeGreaterThanOrEqual(200 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(600 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(200 - 1e-9);
      expect(p.y).toBeLessThanOrEqual(700 + 1e-9);
    }
  });

  it('does not duplicate the trace start point on a closed contour', () => {
    const W = 120;
    const H = 100;
    for (const rect of [
      { x: 10, y: 10, width: 40, height: 30 },
      { x: 0, y: 0, width: 120, height: 100 },
      { x: 33, y: 7, width: 5, height: 60 },
    ]) {
      const mask = createRectSelection(rect, W, H);
      const anchors = selectionToPaths(mask, W, H)[0]!;
      expect(anchors).toHaveLength(4);
      expect(minAnchorSpacing(anchors)).toBeGreaterThan(2);
    }
  });

  it('keeps an ellipse smooth and within 1.5px of the true outline', () => {
    const W = 400;
    const H = 300;
    const rect = { x: 40, y: 30, width: 300, height: 200 };
    const mask = createEllipseSelection(rect, W, H);
    const paths = selectionToPaths(mask, W, H);
    expect(paths).toHaveLength(1);
    const anchors = paths[0]!;
    expect(anchors.length).toBeGreaterThanOrEqual(8);
    expect(minAnchorSpacing(anchors)).toBeGreaterThan(2);

    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    let worst = 0;
    for (const p of sampleClosedPath(anchors)) {
      worst = Math.max(worst, ellipseDistance(p, cx, cy, rect.width / 2, rect.height / 2));
    }
    expect(worst).toBeLessThan(1.5);

    for (const a of anchors) expectSmooth(a);
  });

  it('tracks a small circle without turning it into a polygon', () => {
    const W = 60;
    const H = 60;
    const mask = createEllipseSelection({ x: 10, y: 10, width: 30, height: 30 }, W, H);
    const anchors = selectionToPaths(mask, W, H)[0]!;
    let worst = 0;
    for (const p of sampleClosedPath(anchors)) {
      worst = Math.max(worst, ellipseDistance(p, 25, 25, 15, 15));
    }
    expect(worst).toBeLessThan(1.5);
    for (const a of anchors) expectSmooth(a);
  });

  it('keeps a rectangle + ellipse union inside its bounds with sharp joins', () => {
    const W = 400;
    const H = 400;
    const rectMask = createRectSelection({ x: 50, y: 150, width: 200, height: 100 }, W, H);
    const ellipseMask = createEllipseSelection({ x: 180, y: 80, width: 160, height: 240 }, W, H);
    const mask = rectMask.map((v, i) => Math.max(v, ellipseMask[i] ?? 0));
    const paths = selectionToPaths(mask, W, H);
    expect(paths).toHaveLength(1);
    const anchors = paths[0]!;

    // Selection bounds: x 50..340, y 80..320.
    const margin = 2;
    const expectInBounds = (p: Point) => {
      expect(p.x).toBeGreaterThanOrEqual(50 - margin);
      expect(p.x).toBeLessThanOrEqual(340 + margin);
      expect(p.y).toBeGreaterThanOrEqual(80 - margin);
      expect(p.y).toBeLessThanOrEqual(320 + margin);
    };
    allHandles(anchors).forEach(expectInBounds);
    sampleClosedPath(anchors).forEach(expectInBounds);

    const has = (x: number, y: number) => anchors.some((a) => a.point.x === x && a.point.y === y);
    expect(has(50, 150)).toBe(true);
    expect(has(50, 250)).toBe(true);
    expect(minAnchorSpacing(anchors)).toBeGreaterThan(2);

    // Where the rectangle's top and bottom edges run into the ellipse the
    // outline turns sharply; those joins must stay corners.
    const joins = anchors.filter(
      (a) => a.point.x > 180 && a.point.x < 260 && (a.point.y === 150 || a.point.y === 250),
    );
    expect(joins).toHaveLength(2);
    for (const a of joins) expect(handleSine(a)).toBeGreaterThan(0.5);
  });
});
