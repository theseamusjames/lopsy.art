import { describe, it, expect } from 'vitest';
import type { Point } from '../../types';
import {
  beginLasso,
  updateCursor,
  addAnchor,
  closeLasso,
  flattenPolyline,
  pointsFromFloat32,
  shouldAutoAnchor,
  type SnapFn,
} from './magnetic-lasso';

/** Straight-line snap that returns endpoints only. */
const straightSnap: SnapFn = (from, to) => [from, to];

/** Snap that adds a midpoint shifted by +1 in y — simulates edge pulling. */
const bumpSnap: SnapFn = (from, to) => [
  from,
  { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + 1 },
  to,
];

describe('beginLasso', () => {
  it('creates a single-anchor state with no committed segments', () => {
    const state = beginLasso({ x: 5, y: 5 });
    expect(state.anchors).toEqual([{ x: 5, y: 5 }]);
    expect(state.committedSegments).toEqual([]);
    expect(state.liveSegment).toEqual([{ x: 5, y: 5 }]);
  });
});

describe('updateCursor', () => {
  it('replaces only the live segment, leaving anchors untouched', () => {
    const a = beginLasso({ x: 0, y: 0 });
    const b = updateCursor(a, { x: 10, y: 0 }, straightSnap);
    expect(b.anchors).toEqual([{ x: 0, y: 0 }]);
    expect(b.liveSegment).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(b.committedSegments).toEqual([]);
  });

  it('passes the latest anchor to the snap function', () => {
    const calls: Array<[Point, Point]> = [];
    const captureSnap: SnapFn = (from, to) => {
      calls.push([from, to]);
      return [from, to];
    };
    const a = beginLasso({ x: 1, y: 1 });
    const b = addAnchor(a, { x: 5, y: 5 }, straightSnap);
    updateCursor(b, { x: 9, y: 9 }, captureSnap);
    expect(calls).toEqual([[{ x: 5, y: 5 }, { x: 9, y: 9 }]]);
  });
});

describe('addAnchor', () => {
  it('commits the snapped segment and appends the new anchor', () => {
    const a = beginLasso({ x: 0, y: 0 });
    const b = addAnchor(a, { x: 10, y: 0 }, bumpSnap);
    expect(b.anchors).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(b.committedSegments).toHaveLength(1);
    expect(b.committedSegments[0]).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 1 },
      { x: 10, y: 0 },
    ]);
    expect(b.liveSegment).toEqual([{ x: 10, y: 0 }]);
  });
});

describe('closeLasso', () => {
  it('returns to the first anchor via a snapped closing segment', () => {
    let state = beginLasso({ x: 0, y: 0 });
    state = addAnchor(state, { x: 10, y: 0 }, straightSnap);
    state = addAnchor(state, { x: 10, y: 10 }, straightSnap);
    const poly = closeLasso(state, straightSnap);
    // Path: (0,0) -> (10,0) -> (10,10) -> (0,0). Deduped at joins.
    expect(poly).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 0 },
    ]);
  });

  it('returns empty when no anchors exist', () => {
    const state = {
      anchors: [] as Point[],
      committedSegments: [],
      liveSegment: [],
    };
    expect(closeLasso(state, straightSnap)).toEqual([]);
  });
});

describe('flattenPolyline', () => {
  it('dedupes anchor points shared between adjacent segments', () => {
    const state = {
      anchors: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      committedSegments: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      ],
      liveSegment: [
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    };
    expect(flattenPolyline(state)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });
});

describe('pointsFromFloat32', () => {
  it('decodes interleaved x,y pairs', () => {
    const flat = new Float32Array([1, 2, 3, 4, 5, 6]);
    expect(pointsFromFloat32(flat)).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ]);
  });

  it('ignores a trailing unpaired value', () => {
    const flat = new Float32Array([1, 2, 3]);
    expect(pointsFromFloat32(flat)).toEqual([{ x: 1, y: 2 }]);
  });
});

describe('shouldAutoAnchor', () => {
  it('returns false when frequency is zero', () => {
    const state = beginLasso({ x: 0, y: 0 });
    const updated = updateCursor(state, { x: 100, y: 0 }, straightSnap);
    expect(shouldAutoAnchor(updated, 0)).toBe(false);
  });

  it('returns true once the live segment exceeds frequency', () => {
    const state = beginLasso({ x: 0, y: 0 });
    const updated = updateCursor(state, { x: 30, y: 0 }, straightSnap);
    expect(shouldAutoAnchor(updated, 20)).toBe(true);
  });

  it('returns false when the segment is too short', () => {
    const state = beginLasso({ x: 0, y: 0 });
    const updated = updateCursor(state, { x: 5, y: 0 }, straightSnap);
    expect(shouldAutoAnchor(updated, 20)).toBe(false);
  });
});
