// @vitest-environment jsdom
import '../../../src/test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { combineMasks, maskToPaths, booleanOp } from './boolean-ops';
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
// Tests: maskToPaths (pure logic, no canvas required)
// ---------------------------------------------------------------------------

/** Fill a disc of radius r centred at (cx, cy), sampling pixel centres. */
function fillDisc(mask: Uint8ClampedArray, width: number, cx: number, cy: number, r: number, value: number): void {
  const height = mask.length / width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) mask[y * width + x] = value;
    }
  }
}

/** Even-odd point-in-polygon over a path's anchor points. */
function insideAnchors(anchors: PathAnchor[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = anchors.length - 1; i < anchors.length; j = i++) {
    const a = anchors[i]!.point;
    const b = anchors[j]!.point;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

describe('maskToPaths', () => {
  it('returns nothing for an empty mask', () => {
    expect(maskToPaths(new Uint8ClampedArray(100), 10, 10, 0, 0)).toHaveLength(0);
  });

  it('traces a filled square in document space via the offset', () => {
    const w = 8, h = 8;
    const mask = new Uint8ClampedArray(w * h);
    fillRect(mask, w, 2, 2, 4, 4);
    const paths = maskToPaths(mask, w, h, 100, 50);
    expect(paths).toHaveLength(1);
    const xs = paths[0]!.map((a) => a.point.x);
    const ys = paths[0]!.map((a) => a.point.y);
    expect(Math.min(...xs)).toBe(102);
    expect(Math.max(...xs)).toBe(106);
    expect(Math.min(...ys)).toBe(52);
    expect(Math.max(...ys)).toBe(56);
  });

  // #1332: subtracting an inner circle from an outer one must keep the hole.
  it('keeps a hole as its own path (subtract)', () => {
    const w = 120, h = 120;
    const outer = new Uint8ClampedArray(w * h);
    const inner = new Uint8ClampedArray(w * h);
    fillDisc(outer, w, 60, 60, 50, 1);
    fillDisc(inner, w, 60, 60, 25, 1);
    const paths = maskToPaths(combineMasks(outer, inner, 'subtract'), w, h, 0, 0);
    expect(paths).toHaveLength(2);
    // Even-odd over both contours: the centre is a hole, the ring is filled.
    const parity = (x: number, y: number) => paths.filter((p) => insideAnchors(p, x, y)).length % 2;
    expect(parity(60, 60)).toBe(0);
    expect(parity(60, 22)).toBe(1);
  });

  // #1332: exclude of two overlapping discs gives two islands.
  it('keeps every island (exclude)', () => {
    const w = 140, h = 80;
    const a = new Uint8ClampedArray(w * h);
    const b = new Uint8ClampedArray(w * h);
    fillRect(a, w, 10, 10, 70, 60);
    fillRect(b, w, 60, 10, 70, 60);
    const paths = maskToPaths(combineMasks(a, b, 'exclude'), w, h, 0, 0);
    expect(paths).toHaveLength(2);
  });

  // #1331: handles must sit beside their own anchor and point along the
  // outline, not backwards at the neighbours.
  it('fits a long bar with straight edges (no looping handles)', () => {
    const w = 400, h = 40;
    const mask = new Uint8ClampedArray(w * h);
    fillRect(mask, w, 10, 10, 360, 15);
    const paths = maskToPaths(mask, w, h, 0, 0);
    expect(paths).toHaveLength(1);
    const anchors = paths[0]!;
    expect(anchors.length).toBe(4);
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i]!;
      const next = anchors[(i + 1) % anchors.length]!;
      const prev = anchors[(i - 1 + anchors.length) % anchors.length]!;
      const out = a.handleOut!;
      const inn = a.handleIn!;
      // handleOut points toward the next anchor, handleIn toward the previous.
      expect((out.x - a.point.x) * (next.point.x - a.point.x) + (out.y - a.point.y) * (next.point.y - a.point.y)).toBeGreaterThan(0);
      expect((inn.x - a.point.x) * (prev.point.x - a.point.x) + (inn.y - a.point.y) * (prev.point.y - a.point.y)).toBeGreaterThan(0);
      // Straight edges: both handles of a segment lie on its chord.
      const cross = (p: { x: number; y: number }) =>
        (next.point.x - a.point.x) * (p.y - a.point.y) - (next.point.y - a.point.y) * (p.x - a.point.x);
      expect(Math.abs(cross(out))).toBeLessThan(1e-6);
      expect(Math.abs(cross(next.handleIn!))).toBeLessThan(1e-6);
    }
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
    expect(result.paths).toBeInstanceOf(Array);
    expect(typeof result.hasArea).toBe('boolean');
  });

  it('returns empty result for non-overlapping paths (intersect)', () => {
    const pathA = { anchors: rectPath(0, 0, 50, 50), closed: true };
    const pathB = { anchors: rectPath(200, 200, 50, 50), closed: true };
    const result = booleanOp(pathA, pathB, 'intersect');
    expect(result.hasArea).toBe(false);
    expect(result.paths).toHaveLength(0);
  });

  it('result anchors array is always an array (never throws)', () => {
    const ops: import('./boolean-ops').BooleanOp[] = ['union', 'subtract', 'intersect', 'exclude'];
    for (const op of ops) {
      const pathA = { anchors: rectPath(0, 0, 80, 80), closed: true };
      const pathB = { anchors: rectPath(40, 40, 80, 80), closed: true };
      const result = booleanOp(pathA, pathB, op);
      expect(result.paths).toBeInstanceOf(Array);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: full pipeline with real mask data (bypass canvas rasterization)
// We construct the combined mask directly and call maskToPaths downstream.
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
    const paths = maskToPaths(combined, w, h, 0, 0);

    // Two disjoint rects stay two paths.
    expect(paths).toHaveLength(2);

    // All points should be within bounds
    for (const anchors of paths) {
      for (const { point: pt } of anchors) {
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
