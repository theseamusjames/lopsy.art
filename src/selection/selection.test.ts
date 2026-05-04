import { describe, it, expect } from 'vitest';
import {
  createRectSelection,
  createEllipseSelection,
  invertSelection,
  combineSelections,
  selectionBounds,
  isEmptySelection,
  getSelectionEdges,
  featherSelection,
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

describe('featherSelection', () => {
  it('returns copy when radius is 0', () => {
    const mask = new Uint8ClampedArray([0, 255, 0, 255]);
    const result = featherSelection(mask, 4, 1, 0);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(255);
  });

  it('produces intermediate values at a hard edge', () => {
    // 10x1 mask: left half selected, right half not
    const mask = new Uint8ClampedArray(10);
    for (let i = 0; i < 5; i++) mask[i] = 255;
    const result = featherSelection(mask, 10, 1, 4);
    // Pixels well inside the selected region should remain near 255
    expect(result[0]!).toBeGreaterThan(200);
    // Pixels well outside should remain near 0
    expect(result[9]!).toBeLessThan(55);
    // Pixels at the edge (index 4 and 5) should be intermediate
    expect(result[4]!).toBeGreaterThan(0);
    expect(result[4]!).toBeLessThan(255);
    expect(result[5]!).toBeGreaterThan(0);
    expect(result[5]!).toBeLessThan(255);
  });

  it('feathers a hard-edged rectangle: center is max, edge pixels have falloff', () => {
    // 10x10 with a central 4x4 rectangle selected
    const mask = new Uint8ClampedArray(100);
    for (let y = 3; y < 7; y++) {
      for (let x = 3; x < 7; x++) {
        mask[y * 10 + x] = 255;
      }
    }
    const result = featherSelection(mask, 10, 10, 2);
    const centerVal = result[5 * 10 + 5]!;
    const edgeVal = result[2 * 10 + 5]!;
    const cornerVal = result[0]!;
    // Center of selection has the highest value
    expect(centerVal).toBeGreaterThan(edgeVal);
    // Pixel just outside the rect is still partially selected (feathered)
    expect(edgeVal).toBeGreaterThan(0);
    // Corner is less than center (farther from selection)
    expect(cornerVal).toBeLessThan(centerVal);
    // Feathered values are in 0-255 range
    expect(centerVal).toBeLessThanOrEqual(255);
    expect(cornerVal).toBeGreaterThanOrEqual(0);
  });
});

describe('getSelectionEdges', () => {
  it('returns edges for a single selected pixel', () => {
    // 3x3 grid, center pixel selected
    const mask = new Uint8ClampedArray(9);
    mask[4] = 255; // (1,1)
    const edges = getSelectionEdges(mask, 3, 3);
    // Should have 4 horizontal segments (top + bottom) and 4 vertical segments (left + right)
    // Top: (1,1)→(2,1), Bottom: (1,2)→(2,2), Left: (1,1)→(1,2), Right: (2,1)→(2,2)
    expect(edges.h.length).toBe(8); // 2 segments × 4 values
    expect(edges.v.length).toBe(8);
  });

  it('merges interior edges for adjacent pixels', () => {
    // 4x1 row, two adjacent pixels selected: (1,0) and (2,0)
    const mask = new Uint8ClampedArray(4);
    mask[1] = 255;
    mask[2] = 255;
    const edges = getSelectionEdges(mask, 4, 1);
    // Horizontal: top edge merged into 1 segment, bottom edge merged into 1 = 2
    // Vertical: left of pixel 1, right of pixel 2, but NOT between 1 and 2 = 2
    expect(edges.h.length).toBe(8);  // 2 segments × 4 values
    expect(edges.v.length).toBe(8);  // 2 segments × 4 values
  });

  it('returns empty for no selection', () => {
    const mask = new Uint8ClampedArray(9);
    const edges = getSelectionEdges(mask, 3, 3);
    expect(edges.h.length).toBe(0);
    expect(edges.v.length).toBe(0);
  });
});
