import { describe, expect, it } from 'vitest';
import { FULL_RECT, MIN_CROP } from '../engine/crop';
import { EDGE_LARGE_STEP, EDGE_STEP, cropAfterEdgeKey, cropWithField, edgeKeyDelta, edgePosition, edgeValueText, isBarOnTop } from './crop-keys';

const RECT = { x: 0.2, y: 0.1, width: 0.5, height: 0.6 };
const SIZE = { width: 4000, height: 3000 };

describe('edgeKeyDelta', () => {
  it('moves an edge along its own axis only', () => {
    expect(edgeKeyDelta(RECT, 'w', 'ArrowRight', false)).toBe(EDGE_STEP);
    expect(edgeKeyDelta(RECT, 'e', 'ArrowLeft', true)).toBe(-EDGE_LARGE_STEP);
    expect(edgeKeyDelta(RECT, 'n', 'ArrowUp', false)).toBe(-EDGE_STEP);
    expect(edgeKeyDelta(RECT, 's', 'ArrowDown', true)).toBe(EDGE_LARGE_STEP);
    expect(edgeKeyDelta(RECT, 'n', 'ArrowLeft', false)).toBeNull();
    expect(edgeKeyDelta(RECT, 'w', 'ArrowDown', false)).toBeNull();
    expect(edgeKeyDelta(RECT, 'w', 'Enter', false)).toBeNull();
  });

  it('pages by the large step and goes to the image sides with Home and End', () => {
    expect(edgeKeyDelta(RECT, 'n', 'PageUp', false)).toBe(-EDGE_LARGE_STEP);
    expect(edgeKeyDelta(RECT, 'w', 'PageUp', false)).toBe(EDGE_LARGE_STEP);
    expect(edgeKeyDelta(RECT, 'w', 'Home', false)).toBeCloseTo(-0.2);
    expect(edgeKeyDelta(RECT, 's', 'End', false)).toBeCloseTo(0.3);
  });
});

describe('cropAfterEdgeKey', () => {
  it('moves one edge and leaves the others', () => {
    const next = cropAfterEdgeKey(RECT, 'w', 'ArrowRight', false, null, 4 / 3);
    expect(next?.x).toBeCloseTo(0.21);
    expect(edgePosition(next ?? RECT, 'e')).toBeCloseTo(0.7);
    expect(next?.y).toBe(0.1);
    expect(next?.height).toBe(0.6);
  });

  it('stops at the image and at the smallest crop', () => {
    const left = cropAfterEdgeKey(FULL_RECT, 'w', 'ArrowLeft', true, null, 1);
    expect(left).toEqual(FULL_RECT);
    const squeezed = cropAfterEdgeKey(RECT, 'n', 'End', false, null, 1);
    expect(squeezed?.height).toBeCloseTo(MIN_CROP);
  });

  it('keeps a held aspect, as a drag does', () => {
    // A square crop on a 4:3 image: its normalized width is 3/4 of its height.
    const square = { x: 0.25, y: 0, width: 0.75, height: 1 };
    const next = cropAfterEdgeKey(square, 'e', 'ArrowLeft', true, 1, 4 / 3);
    if (!next) throw new Error('no crop');
    expect((next.width * 4) / (next.height * 3)).toBeCloseTo(1);
    expect(next.width).toBeCloseTo(0.65);
  });

  it('ignores keys an edge does not take', () => {
    expect(cropAfterEdgeKey(RECT, 'e', 'ArrowUp', false, null, 1)).toBeNull();
  });
});

describe('edgeValueText', () => {
  it('reads how far each edge is in from its side', () => {
    expect(edgeValueText(RECT, 'w', SIZE)).toBe('20 % in from the left, 800 px');
    expect(edgeValueText(RECT, 'e', SIZE)).toBe('30 % in from the right, 1200 px');
    expect(edgeValueText(RECT, 'n', SIZE)).toBe('10 % in from the top, 300 px');
    expect(edgeValueText(RECT, 's', SIZE)).toBe('30 % in from the bottom, 900 px');
  });
});

describe('cropWithField', () => {
  it('moves the crop by Left and Top, keeping its size inside the image', () => {
    expect(cropWithField(RECT, 'x', 400, SIZE, null)).toEqual({ ...RECT, x: 0.1 });
    expect(cropWithField(RECT, 'y', 3000, SIZE, null).y).toBeCloseTo(0.4);
    expect(cropWithField(RECT, 'x', -50, SIZE, null).x).toBe(0);
  });

  it('resizes from the top-left corner, at least the smallest crop', () => {
    expect(cropWithField(RECT, 'width', 1000, SIZE, null)).toEqual({ ...RECT, width: 0.25 });
    expect(cropWithField(RECT, 'height', 99999, SIZE, null).height).toBeCloseTo(0.9);
    expect(cropWithField(RECT, 'width', 1, SIZE, null).width).toBe(MIN_CROP);
  });

  it('follows a held aspect, shrinking both sides to stay inside', () => {
    const square = cropWithField(RECT, 'width', 1500, SIZE, 1);
    expect(square.width * SIZE.width).toBeCloseTo(1500);
    expect(square.height * SIZE.height).toBeCloseTo(1500);
    // 3000 px wide at 1:1 would need 3000 px of height below y = 300 px; 2700 px is all there is.
    const capped = cropWithField(RECT, 'width', 3000, SIZE, 1);
    expect(capped.height * SIZE.height).toBeCloseTo(2700);
    expect(capped.width * SIZE.width).toBeCloseTo(2700);
  });

  it('leaves the crop alone for something that is not a number', () => {
    expect(cropWithField(RECT, 'width', Number.NaN, SIZE, null)).toBe(RECT);
  });
});

describe('isBarOnTop', () => {
  it('stays at the bottom while the crop keeps clear of it', () => {
    expect(isBarOnTop({ top: 100, bottom: 500 }, 760, 110, false)).toBe(false);
    expect(isBarOnTop({ top: 100, bottom: 500 }, 760, 110, true)).toBe(false);
  });

  it('moves to the top when it would hide the bottom edge and the top is clear', () => {
    expect(isBarOnTop({ top: 200, bottom: 700 }, 760, 110, false)).toBe(true);
  });

  it('covers the edge not in use when the crop fills the stage', () => {
    expect(isBarOnTop({ top: 24, bottom: 736 }, 760, 110, false)).toBe(false);
    expect(isBarOnTop({ top: 24, bottom: 736 }, 760, 110, true)).toBe(true);
  });
});
