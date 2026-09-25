import { describe, it, expect } from 'vitest';
import {
  createTransformState,
  getTransformedBounds,
  getTransformedContentBounds,
  mapRectThroughInverse,
  computeInverseAffineMatrix,
  getHandlePositions,
  hitTestHandle,
  isScaleHandle,
  isRotateHandle,
  computeScale,
  computeRotation,
  getCursorForHandle,
  applyTransformToMask,
} from './transform';

describe('createTransformState', () => {
  it('creates identity transform from bounds', () => {
    const state = createTransformState({ x: 10, y: 20, width: 100, height: 50 });
    expect(state.scaleX).toBe(1);
    expect(state.scaleY).toBe(1);
    expect(state.rotation).toBe(0);
    expect(state.translateX).toBe(0);
    expect(state.translateY).toBe(0);
    expect(state.originalBounds).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });
});

describe('getTransformedBounds', () => {
  it('returns original bounds with identity transform', () => {
    const state = createTransformState({ x: 10, y: 20, width: 100, height: 50 });
    const bounds = getTransformedBounds(state);
    expect(bounds.x).toBe(10);
    expect(bounds.y).toBe(20);
    expect(bounds.width).toBe(100);
    expect(bounds.height).toBe(50);
  });

  it('scales bounds from center', () => {
    const state = {
      ...createTransformState({ x: 0, y: 0, width: 100, height: 100 }),
      scaleX: 2,
      scaleY: 2,
    };
    const bounds = getTransformedBounds(state);
    expect(bounds.x).toBe(-50);
    expect(bounds.y).toBe(-50);
    expect(bounds.width).toBe(200);
    expect(bounds.height).toBe(200);
  });

  it('applies translation', () => {
    const state = {
      ...createTransformState({ x: 0, y: 0, width: 100, height: 100 }),
      translateX: 10,
      translateY: 20,
    };
    const bounds = getTransformedBounds(state);
    expect(bounds.x).toBe(10);
    expect(bounds.y).toBe(20);
  });
});

describe('getTransformedContentBounds', () => {
  function expectRect(actual: { x: number; y: number; width: number; height: number }, expected: typeof actual): void {
    expect(actual.x).toBeCloseTo(expected.x, 6);
    expect(actual.y).toBeCloseTo(expected.y, 6);
    expect(actual.width).toBeCloseTo(expected.width, 6);
    expect(actual.height).toBeCloseTo(expected.height, 6);
  }

  it('is the original rect for the identity transform', () => {
    const state = createTransformState({ x: 10, y: 20, width: 100, height: 50 });
    expectRect(getTransformedContentBounds(state), { x: 10, y: 20, width: 100, height: 50 });
  });

  // #818: a 200x40 bar centred at (200, 260) turned a quarter turn is a
  // 40x200 bar spanning y 160..360 — past the bottom of a 300px canvas.
  it('swaps extents for a quarter-turn rotation about the centre', () => {
    const state = {
      ...createTransformState({ x: 100, y: 240, width: 200, height: 40 }),
      rotation: Math.PI / 2,
    };
    expectRect(getTransformedContentBounds(state), { x: 180, y: 160, width: 40, height: 200 });
  });

  it('covers the rotated corners of a 45° turn', () => {
    const state = {
      ...createTransformState({ x: 0, y: 0, width: 100, height: 100 }),
      rotation: Math.PI / 4,
    };
    const half = 50 * Math.SQRT2;
    expectRect(getTransformedContentBounds(state), { x: 50 - half, y: 50 - half, width: 2 * half, height: 2 * half });
  });

  it('applies scale and translation together', () => {
    const state = {
      ...createTransformState({ x: 0, y: 0, width: 100, height: 100 }),
      scaleX: 2,
      scaleY: 0.5,
      translateX: 10,
      translateY: -5,
    };
    expectRect(getTransformedContentBounds(state), { x: -40, y: 20, width: 200, height: 50 });
  });

  it('uses the dragged corners in distort mode', () => {
    const base = createTransformState({ x: 0, y: 0, width: 100, height: 100 }, 'distort');
    const state = {
      ...base,
      corners: [{ x: -20, y: 0 }, { x: 0, y: -30 }, { x: 15, y: 0 }, { x: 0, y: 40 }] as typeof base.corners,
    };
    expectRect(getTransformedContentBounds(state), { x: -20, y: -30, width: 135, height: 170 });
  });
});

describe('mapRectThroughInverse', () => {
  const bar = { x: 100, y: 240, width: 200, height: 40 };

  it('leaves the bounds unchanged for a horizontal flip', () => {
    expect(mapRectThroughInverse(bar, new Float32Array([-1, 0, 0, 0, 1, 0, 0, 0, 1]))).toEqual(bar);
  });

  it('swaps extents about the centre for a 90° rotation', () => {
    const cw = new Float32Array([0, -1, 0, 1, 0, 0, 0, 0, 1]);
    expect(mapRectThroughInverse(bar, cw)).toEqual({ x: 180, y: 160, width: 40, height: 200 });
  });

  it('agrees with getTransformedContentBounds for an arbitrary affine transform', () => {
    const state = {
      ...createTransformState(bar),
      rotation: 0.4,
      scaleX: 1.5,
      scaleY: 0.75,
      skewX: 0.2,
    };
    const expected = getTransformedContentBounds(state);
    const actual = mapRectThroughInverse(bar, computeInverseAffineMatrix(state));
    expect(actual.x).toBeCloseTo(expected.x, 3);
    expect(actual.y).toBeCloseTo(expected.y, 3);
    expect(actual.width).toBeCloseTo(expected.width, 3);
    expect(actual.height).toBeCloseTo(expected.height, 3);
  });
});

describe('getHandlePositions', () => {
  it('returns 12 handle positions', () => {
    const state = createTransformState({ x: 0, y: 0, width: 100, height: 100 });
    const handles = getHandlePositions(state);
    expect(Object.keys(handles)).toHaveLength(12);
  });

  it('positions corners correctly with no rotation', () => {
    const state = createTransformState({ x: 0, y: 0, width: 100, height: 100 });
    const handles = getHandlePositions(state);
    expect(handles['top-left']).toEqual({ x: 0, y: 0 });
    expect(handles['top-right']).toEqual({ x: 100, y: 0 });
    expect(handles['bottom-right']).toEqual({ x: 100, y: 100 });
    expect(handles['bottom-left']).toEqual({ x: 0, y: 100 });
  });

  it('positions edge midpoints correctly', () => {
    const state = createTransformState({ x: 0, y: 0, width: 100, height: 100 });
    const handles = getHandlePositions(state);
    expect(handles['top']).toEqual({ x: 50, y: 0 });
    expect(handles['right']).toEqual({ x: 100, y: 50 });
    expect(handles['bottom']).toEqual({ x: 50, y: 100 });
    expect(handles['left']).toEqual({ x: 0, y: 50 });
  });
});

describe('hitTestHandle', () => {
  it('returns handle when clicking on it', () => {
    const state = createTransformState({ x: 0, y: 0, width: 100, height: 100 });
    const result = hitTestHandle({ x: 100, y: 0 }, state, 6);
    expect(result).toBe('top-right');
  });

  it('returns null when clicking away from handles', () => {
    const state = createTransformState({ x: 0, y: 0, width: 100, height: 100 });
    const result = hitTestHandle({ x: 50, y: 50 }, state, 6);
    expect(result).toBeNull();
  });

  it('detects rotation handles', () => {
    const state = createTransformState({ x: 0, y: 0, width: 100, height: 100 });
    const handles = getHandlePositions(state);
    const rotPos = handles['rotate-top-right'];
    const result = hitTestHandle(rotPos, state, 6);
    expect(result).toBe('rotate-top-right');
  });
});

describe('isScaleHandle / isRotateHandle', () => {
  it('classifies scale handles correctly', () => {
    expect(isScaleHandle('top-left')).toBe(true);
    expect(isScaleHandle('right')).toBe(true);
    expect(isScaleHandle('rotate-top-left')).toBe(false);
  });

  it('classifies rotate handles correctly', () => {
    expect(isRotateHandle('rotate-top-left')).toBe(true);
    expect(isRotateHandle('top-left')).toBe(false);
  });
});

describe('computeScale', () => {
  it('scales right edge', () => {
    const state = createTransformState({ x: 0, y: 0, width: 100, height: 100 });
    const result = computeScale(
      'right',
      { x: 100, y: 50 },
      { x: 150, y: 50 },
      state,
      false,
    );
    expect(result.scaleX).toBe(1.5);
    expect(result.scaleY).toBe(1);
  });

  it('right handle anchors left edge and drags right edge to mouse', () => {
    // 100x100 bounds at origin, drag right handle (100,50) to (200,50)
    const state = createTransformState({ x: 0, y: 0, width: 100, height: 100 });
    const result = computeScale('right', { x: 100, y: 50 }, { x: 200, y: 50 }, state, false);
    const bounds = getTransformedBounds({ ...state, scaleX: result.scaleX, translateX: result.translateX, scaleY: result.scaleY, translateY: result.translateY });
    expect(bounds.x).toBeCloseTo(0);        // left edge stays
    expect(bounds.x + bounds.width).toBeCloseTo(200);  // right edge follows mouse
  });

  it('left handle anchors right edge and drags left edge to mouse', () => {
    const state = createTransformState({ x: 0, y: 0, width: 100, height: 100 });
    const result = computeScale('left', { x: 0, y: 50 }, { x: -50, y: 50 }, state, false);
    const bounds = getTransformedBounds({ ...state, scaleX: result.scaleX, translateX: result.translateX, scaleY: result.scaleY, translateY: result.translateY });
    expect(bounds.x + bounds.width).toBeCloseTo(100);  // right edge stays
    expect(bounds.x).toBeCloseTo(-50);                 // left edge follows mouse
  });

  it('bottom handle anchors top edge and drags bottom edge to mouse', () => {
    const state = createTransformState({ x: 0, y: 0, width: 100, height: 100 });
    const result = computeScale('bottom', { x: 50, y: 100 }, { x: 50, y: 200 }, state, false);
    const bounds = getTransformedBounds({ ...state, scaleX: result.scaleX, translateX: result.translateX, scaleY: result.scaleY, translateY: result.translateY });
    expect(bounds.y).toBeCloseTo(0);                    // top edge stays
    expect(bounds.y + bounds.height).toBeCloseTo(200);  // bottom edge follows mouse
  });

  it('bottom-right handle anchors top-left and drags corner to mouse', () => {
    const state = createTransformState({ x: 0, y: 0, width: 100, height: 100 });
    const result = computeScale('bottom-right', { x: 100, y: 100 }, { x: 200, y: 200 }, state, false);
    const bounds = getTransformedBounds({ ...state, scaleX: result.scaleX, translateX: result.translateX, scaleY: result.scaleY, translateY: result.translateY });
    expect(bounds.x).toBeCloseTo(0);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.x + bounds.width).toBeCloseTo(200);
    expect(bounds.y + bounds.height).toBeCloseTo(200);
  });

  it('enforces minimum scale', () => {
    const state = createTransformState({ x: 0, y: 0, width: 100, height: 100 });
    const result = computeScale(
      'right',
      { x: 100, y: 50 },
      { x: -200, y: 50 },
      state,
      false,
    );
    expect(result.scaleX).toBe(0.01);
  });

  it('applies proportional constraint', () => {
    const state = createTransformState({ x: 0, y: 0, width: 100, height: 100 });
    const result = computeScale(
      'bottom-right',
      { x: 100, y: 100 },
      { x: 200, y: 150 },
      state,
      true,
    );
    expect(result.scaleX).toBe(result.scaleY);
  });
});

describe('computeRotation', () => {
  it('returns angle from center to point', () => {
    const state = createTransformState({ x: 0, y: 0, width: 100, height: 100 });
    const angle = computeRotation({ x: 100, y: 50 }, state);
    expect(angle).toBeCloseTo(0, 5);
  });

  it('returns PI/2 for point directly below center', () => {
    const state = createTransformState({ x: 0, y: 0, width: 100, height: 100 });
    const angle = computeRotation({ x: 50, y: 150 }, state);
    expect(angle).toBeCloseTo(Math.PI / 2, 5);
  });
});

describe('getCursorForHandle', () => {
  it('returns resize cursors for scale handles', () => {
    expect(getCursorForHandle('top')).toBe('ns-resize');
    expect(getCursorForHandle('right')).toBe('ew-resize');
    expect(getCursorForHandle('top-left')).toBe('nwse-resize');
  });

  it('returns crosshair for rotate handles', () => {
    expect(getCursorForHandle('rotate-top-left')).toBe('crosshair');
  });
});

describe('applyTransformToMask', () => {
  it('returns same mask with identity transform', () => {
    const mask = new Uint8ClampedArray(100);
    // Fill a 5x5 block in a 10x10 mask
    for (let y = 2; y < 7; y++) {
      for (let x = 2; x < 7; x++) {
        mask[y * 10 + x] = 255;
      }
    }
    const state = createTransformState({ x: 2, y: 2, width: 5, height: 5 });
    const { mask: result, bounds } = applyTransformToMask(mask, 10, 10, state);
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBe(5);
    expect(bounds!.height).toBe(5);
    // Check that the same pixels are selected
    for (let y = 2; y < 7; y++) {
      for (let x = 2; x < 7; x++) {
        expect(result[y * 10 + x]).toBe(255);
      }
    }
  });

  it('returns null bounds for empty mask', () => {
    const mask = new Uint8ClampedArray(100);
    const state = createTransformState({ x: 0, y: 0, width: 10, height: 10 });
    const { bounds } = applyTransformToMask(mask, 10, 10, state);
    expect(bounds).toBeNull();
  });
});
