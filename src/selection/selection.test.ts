import { describe, it, expect } from 'vitest';
import {
  createRectSelection,
  createEllipseSelection,
  invertSelection,
  combineSelections,
  selectionBounds,
  isEmptySelection,
} from './selection';

describe('createRectSelection', () => {
  it('creates correct mask', () => {
    const mask = createRectSelection({ x: 1, y: 1, width: 2, height: 2 }, 4, 4);
    // Pixels at (1,1), (2,1), (1,2), (2,2) should be 255
    expect(mask[1 * 4 + 1]).toBe(255);
    expect(mask[1 * 4 + 2]).toBe(255);
    expect(mask[2 * 4 + 1]).toBe(255);
    expect(mask[2 * 4 + 2]).toBe(255);
    // Outside should be 0
    expect(mask[0 * 4 + 0]).toBe(0);
    expect(mask[3 * 4 + 3]).toBe(0);
  });
});

describe('createEllipseSelection', () => {
  it('selects center pixel', () => {
    const mask = createEllipseSelection({ x: 0, y: 0, width: 10, height: 10 }, 10, 10);
    expect(mask[5 * 10 + 5]).toBe(255);
  });

  it('does not select far corners', () => {
    const mask = createEllipseSelection({ x: 2, y: 2, width: 6, height: 6 }, 10, 10);
    expect(mask[0 * 10 + 0]).toBe(0);
    expect(mask[9 * 10 + 9]).toBe(0);
  });
});

describe('invertSelection', () => {
  it('flips all values', () => {
    const mask = new Uint8ClampedArray([0, 255, 128]);
    const inv = invertSelection(mask);
    expect(inv[0]).toBe(255);
    expect(inv[1]).toBe(0);
    expect(inv[2]).toBe(127);
  });
});

describe('combineSelections', () => {
  it('add is union', () => {
    const a = new Uint8ClampedArray([255, 0, 128]);
    const b = new Uint8ClampedArray([0, 255, 128]);
    const result = combineSelections(a, b, 'add');
    expect(result[0]).toBe(255);
    expect(result[1]).toBe(255);
    expect(result[2]).toBe(255); // clamped
  });

  it('subtract removes', () => {
    const a = new Uint8ClampedArray([255, 128, 0]);
    const b = new Uint8ClampedArray([128, 255, 128]);
    const result = combineSelections(a, b, 'subtract');
    expect(result[0]).toBe(127);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
  });

  it('intersect keeps overlap', () => {
    const a = new Uint8ClampedArray([255, 0, 128]);
    const b = new Uint8ClampedArray([128, 255, 64]);
    const result = combineSelections(a, b, 'intersect');
    expect(result[0]).toBe(128);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(64);
  });
});

describe('selectionBounds', () => {
  it('returns tight bounds', () => {
    const mask = new Uint8ClampedArray(16); // 4x4
    mask[1 * 4 + 1] = 255;
    mask[2 * 4 + 2] = 255;
    const bounds = selectionBounds(mask, 4, 4);
    expect(bounds).toEqual({ x: 1, y: 1, width: 2, height: 2 });
  });

  it('returns null for empty mask', () => {
    const mask = new Uint8ClampedArray(16);
    expect(selectionBounds(mask, 4, 4)).toBe(null);
  });
});

describe('isEmptySelection', () => {
  it('returns true for all-zero mask', () => {
    expect(isEmptySelection(new Uint8ClampedArray(10))).toBe(true);
  });

  it('returns false if any pixel is selected', () => {
    const mask = new Uint8ClampedArray(10);
    mask[5] = 1;
    expect(isEmptySelection(mask)).toBe(false);
  });
});
