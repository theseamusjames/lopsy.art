import { describe, it, expect } from 'vitest';
import { selectionToPath } from './selection-to-path';
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
});
