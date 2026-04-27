import { describe, it, expect } from 'vitest';
import { createPolygonMask } from '../lasso/lasso';

/**
 * Issue #222 — Fill bucket should respect a polygonal-lasso selection.
 *
 * The bucket-fill action runs flood-fill against the layer's pixels, then
 * intersects the resulting fill mask with the active selection mask. Any
 * pixel where the selection is 0 must NOT be filled. Issue #222 reports
 * that the entire layer fills despite a polygon selection being active —
 * this guards the JS-side intersection logic that constrains the fill.
 */
function intersectFillWithSelection(
  fillMask: Uint8Array,
  selMask: Uint8ClampedArray | null,
  active: boolean,
): Uint8Array {
  // Mirrors the loop in src/tools/fill/fill-interaction.ts.
  if (active && selMask) {
    for (let i = 0; i < fillMask.length && i < selMask.length; i++) {
      if (selMask[i] === 0) {
        fillMask[i] = 0;
      }
    }
  }
  return fillMask;
}

describe('fill bucket respects polygonal-lasso selection (issue #222)', () => {
  it('clears fill outside a polygon selection', () => {
    const w = 50;
    const h = 50;
    // Triangle in the lower-right quadrant.
    const polygonPoints = [
      { x: 30, y: 25 },
      { x: 45, y: 25 },
      { x: 45, y: 45 },
    ];
    const selMask = createPolygonMask(polygonPoints, w, h);

    // A fill mask that says "fill everywhere" (mimicking flood fill on a
    // transparent layer with tolerance=255).
    const fillMask = new Uint8Array(w * h).fill(255);

    intersectFillWithSelection(fillMask, selMask, true);

    // Inside the polygon: still 255.
    expect(fillMask[35 * w + 40]).toBe(255);
    // Far outside the polygon (top-left corner): cleared to 0.
    expect(fillMask[5 * w + 5]).toBe(0);
    // Just-outside the polygon (above the triangle): cleared to 0.
    expect(fillMask[10 * w + 40]).toBe(0);
  });

  it('does not modify the fill mask when no selection is active', () => {
    const fillMask = new Uint8Array(100).fill(255);
    intersectFillWithSelection(fillMask, null, false);
    expect(Array.from(fillMask).every((v) => v === 255)).toBe(true);
  });

  it('handles a non-rectangular polygon (5+ vertices) correctly', () => {
    const w = 40;
    const h = 40;
    // Pentagon that covers roughly the center of the canvas.
    const points = [
      { x: 20, y: 5 },
      { x: 35, y: 18 },
      { x: 30, y: 35 },
      { x: 10, y: 35 },
      { x: 5, y: 18 },
    ];
    const selMask = createPolygonMask(points, w, h);
    const fillMask = new Uint8Array(w * h).fill(255);
    intersectFillWithSelection(fillMask, selMask, true);

    // Center of the pentagon: filled.
    expect(fillMask[20 * w + 20]).toBe(255);
    // Outside the pentagon (corner): not filled.
    expect(fillMask[1 * w + 1]).toBe(0);
    expect(fillMask[39 * w + 39]).toBe(0);
  });

  it('selection mask and fill mask have matching dimensions for intersection', () => {
    // Regression: a pixel-by-pixel AND only works when both arrays cover the
    // same docW×docH area at 1 byte per pixel. createPolygonMask must produce
    // a Uint8ClampedArray of length w*h.
    const w = 100;
    const h = 80;
    const mask = createPolygonMask([{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 30, y: 50 }], w, h);
    expect(mask.length).toBe(w * h);
  });
});
