import { describe, it, expect } from 'vitest';
import {
  createTransformState,
  getTransformedBounds,
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
