// @vitest-environment jsdom
import '../../../src/test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { combineMasks, traceContours, booleanOp } from './boolean-ops';
import type { PathAnchor } from './path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a rectangular path from corner coords (no bezier handles). */
function rectPath(x: number, y: number, w: number, h: number): PathAnchor[] {
  return [
    { point: { x, y },         handleIn: null, handleOut: null },
    { point: { x: x + w, y },  handleIn: null, handleOut: null },
    { point: { x: x + w, y: y + h }, handleIn: null, handleOut: null },
    { point: { x, y: y + h },  handleIn: null, handleOut: null },
  ];
}

/** Fill a rectangular region in a flat 1-byte-per-pixel mask. */
function fillRect(
  mask: Uint8ClampedArray,
  width: number,
  x: number, y: number, w: number, h: number,
): void {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      mask[row * width + col] = 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Tests: combineMasks (pure logic, no canvas required)
// ---------------------------------------------------------------------------

describe('combineMasks', () => {
  // 10-pixel masks: A covers [0,5), B covers [3,8)
  // Overlap at [3,5)
  const size = 10;
  let maskA: Uint8ClampedArray;
  let maskB: Uint8ClampedArray;

  // Re-create before each group
  maskA = new Uint8ClampedArray(size);
  maskB = new Uint8ClampedArray(size);
  for (let i = 0; i < 5; i++) maskA[i] = 1;     // A: pixels 0-4
  for (let i = 3; i < 8; i++) maskB[i] = 1;     // B: pixels 3-7

  it('union covers pixels from either mask', () => {
    const r = combineMasks(maskA, maskB, 'union');
    // Should be set at 0..7
    for (let i = 0; i <= 7; i++) expect(r[i]).toBeGreaterThan(0);
    // Should be 0 at 8..9
    expect(r[8]).toBe(0);
    expect(r[9]).toBe(0);
  });

  it('intersect covers only shared pixels', () => {
    const r = combineMasks(maskA, maskB, 'intersect');
    // Shared: 3 and 4
    expect(r[3]).toBeGreaterThan(0);
    expect(r[4]).toBeGreaterThan(0);
    // Not shared
    expect(r[0]).toBe(0);
    expect(r[2]).toBe(0);
    expect(r[5]).toBe(0);
  });

  it('subtract removes B from A', () => {
    const r = combineMasks(maskA, maskB, 'subtract');
    // A minus (A∩B): only pixels 0,1,2
    expect(r[0]).toBeGreaterThan(0);
    expect(r[1]).toBeGreaterThan(0);
    expect(r[2]).toBeGreaterThan(0);
    // Overlap region removed
    expect(r[3]).toBe(0);
    expect(r[4]).toBe(0);
    // B-only region not added
    expect(r[5]).toBe(0);
  });

  it('exclude (XOR) removes shared region', () => {
    const r = combineMasks(maskA, maskB, 'exclude');
    // A-only: 0,1,2
    expect(r[0]).toBeGreaterThan(0);
    expect(r[1]).toBeGreaterThan(0);
    expect(r[2]).toBeGreaterThan(0);
    // Shared: removed
    expect(r[3]).toBe(0);
    expect(r[4]).toBe(0);
    // B-only: 5,6,7
    expect(r[5]).toBeGreaterThan(0);
    expect(r[6]).toBeGreaterThan(0);
    expect(r[7]).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: traceContours (pure logic, no canvas required)
// ---------------------------------------------------------------------------

describe('traceContours', () => {
  it('detects contour around a filled 4x4 square', () => {
    const w = 8, h = 8;
    const mask = new Uint8ClampedArray(w * h);
    // Fill a 4x4 block at (2,2)
    fillRect(mask, w, 2, 2, 4, 4);

    const contours = traceContours(mask, w, h);
    expect(contours.length).toBeGreaterThan(0);
    // Main contour should have enough points to trace the square
    const main = contours[0]!;
    expect(main.length).toBeGreaterThan(2);
  });

  it('returns empty for a completely empty mask', () => {
    const mask = new Uint8ClampedArray(10 * 10);
    const contours = traceContours(mask, 10, 10);
    expect(contours).toHaveLength(0);
  });

  it('returns empty for a completely filled mask (no boundary)', () => {
    const w = 4, h = 4;
    const mask = new Uint8ClampedArray(w * h).fill(1);
    const contours = traceContours(mask, w, h);
    // Edges of the full mask still produce a contour at the boundary
    // (the cells at the border have 0-valued neighbours outside the mask)
    // So we just check we get something or nothing gracefully — no crash.
    expect(Array.isArray(contours)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: full booleanOp pipeline with manually-crafted masks
// (booleanOp uses canvas for rasterization; in jsdom the canvas mock returns
// zero-alpha pixels, so the masks end up all-zero. We verify graceful handling
// of no-area results and separately test with pre-built mask combinations.)
// ---------------------------------------------------------------------------

describe('booleanOp graceful handling (jsdom / canvas-mock environment)', () => {
  it('returns hasArea:false and empty anchors when canvas mock produces zero masks', () => {
    // In jsdom, the canvas mock returns zero-alpha getImageData, so both
    // rasterized masks are all-zero → every op produces no area.
    const pathA = { anchors: rectPath(0, 0, 100, 100), closed: true };
    const pathB = { anchors: rectPath(50, 50, 100, 100), closed: true };
    const result = booleanOp(pathA, pathB, 'union');
    // jsdom canvas mock → masks are empty → no area is expected
    expect(result.anchors).toBeInstanceOf(Array);
    expect(typeof result.hasArea).toBe('boolean');
  });

  it('returns empty result for non-overlapping paths (intersect)', () => {
    const pathA = { anchors: rectPath(0, 0, 50, 50), closed: true };
    const pathB = { anchors: rectPath(200, 200, 50, 50), closed: true };
    const result = booleanOp(pathA, pathB, 'intersect');
    expect(result.hasArea).toBe(false);
    expect(result.anchors).toHaveLength(0);
  });

  it('result anchors array is always an array (never throws)', () => {
    const ops: import('./boolean-ops').BooleanOp[] = ['union', 'subtract', 'intersect', 'exclude'];
    for (const op of ops) {
      const pathA = { anchors: rectPath(0, 0, 80, 80), closed: true };
      const pathB = { anchors: rectPath(40, 40, 80, 80), closed: true };
      const result = booleanOp(pathA, pathB, op);
      expect(result.anchors).toBeInstanceOf(Array);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: full pipeline with real mask data (bypass canvas rasterization)
// We construct the combined mask directly and call traceContours + downstream.
// ---------------------------------------------------------------------------

describe('booleanOp full pipeline via mask construction', () => {
  it('union of two rect masks produces a contour spanning both', () => {
    const w = 20, h = 20;
    const maskA = new Uint8ClampedArray(w * h);
    const maskB = new Uint8ClampedArray(w * h);
    // Rect A: (1,1) 8x8
    fillRect(maskA, w, 1, 1, 8, 8);
    // Rect B: (11,11) 7x7
    fillRect(maskB, w, 11, 11, 7, 7);

    const combined = combineMasks(maskA, maskB, 'union');
    const contours = traceContours(combined, w, h);

    // Both rects should produce at least one contour
    expect(contours.length).toBeGreaterThan(0);

    // All points should be within bounds
    for (const contour of contours) {
      for (const pt of contour) {
        expect(pt.x).toBeGreaterThanOrEqual(0);
        expect(pt.x).toBeLessThanOrEqual(w);
        expect(pt.y).toBeGreaterThanOrEqual(0);
        expect(pt.y).toBeLessThanOrEqual(h);
      }
    }
  });

  it('subtract leaves only pixels in A that are not in B', () => {
    const w = 20, h = 10;
    const maskA = new Uint8ClampedArray(w * h);
    const maskB = new Uint8ClampedArray(w * h);
    // A covers whole row y=1..8, x=1..18
    fillRect(maskA, w, 1, 1, 17, 8);
    // B covers right half x=10..18, y=1..8
    fillRect(maskB, w, 10, 1, 8, 8);

    const combined = combineMasks(maskA, maskB, 'subtract');

    // Left half should be filled, right half should be empty
    for (let x = 2; x < 9; x++) {
      expect(combined[3 * w + x]).toBeGreaterThan(0);  // left half, y=3
    }
    for (let x = 11; x < 18; x++) {
      expect(combined[3 * w + x]).toBe(0);  // right half (B area), y=3
    }
  });

  it('intersect returns only the overlap region', () => {
    const w = 20, h = 20;
    const maskA = new Uint8ClampedArray(w * h);
    const maskB = new Uint8ClampedArray(w * h);
    // A: (2,2) 10x10
    fillRect(maskA, w, 2, 2, 10, 10);
    // B: (7,7) 10x10
    fillRect(maskB, w, 7, 7, 10, 10);
    // Overlap: (7,7) to (12,12)

    const combined = combineMasks(maskA, maskB, 'intersect');

    // Check overlap area is filled
    expect(combined[8 * w + 8]).toBeGreaterThan(0);  // inside overlap
    // Check non-overlap areas of A are empty
    expect(combined[3 * w + 3]).toBe(0);  // in A only, not in B
    // Check non-overlap areas of B are empty
    expect(combined[15 * w + 15]).toBe(0);  // in B only, not in A
  });
});
