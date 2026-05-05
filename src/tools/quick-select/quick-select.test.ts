import { describe, it, expect } from 'vitest';
import { applyQuickSelectStroke } from './quick-select';

// ---------------------------------------------------------------------------
// Test image helpers
// ---------------------------------------------------------------------------

/**
 * Build a flat RGBA Uint8ClampedArray for a w×h image.
 * `fillFn` returns [r, g, b, a] for each (x, y).
 */
function makeImage(
  w: number,
  h: number,
  fillFn: (x: number, y: number) => [number, number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const [r, g, b, a] = fillFn(x, y);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return data;
}

function countSelected(mask: Uint8ClampedArray): number {
  let n = 0;
  for (const v of mask) if (v > 0) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('applyQuickSelectStroke', () => {
  it('selects pixels matching the seed color within the brush radius', () => {
    // 10×10 solid red image
    const pixels = makeImage(10, 10, () => [255, 0, 0, 255]);
    const mask = applyQuickSelectStroke(
      { pixels, width: 10, height: 10, radius: 3, tolerance: 10, edgeStrength: 0 },
      { points: [{ x: 5, y: 5 }], existingMask: null, mode: 'add' },
    );
    expect(countSelected(mask)).toBeGreaterThan(0);
  });

  it('does not select pixels whose color differs beyond the tolerance', () => {
    // Left half: red, right half: blue
    const pixels = makeImage(20, 10, (x) => x < 10 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
    // Stroke on red half, low tolerance
    const mask = applyQuickSelectStroke(
      { pixels, width: 20, height: 10, radius: 2, tolerance: 10, edgeStrength: 0 },
      { points: [{ x: 2, y: 5 }], existingMask: null, mode: 'add' },
    );
    // No blue pixels (x >= 10) should be selected
    for (let y = 0; y < 10; y++) {
      for (let x = 10; x < 20; x++) {
        expect(mask[y * 20 + x]).toBe(0);
      }
    }
  });

  it('respects a strong edge threshold and does not cross sharp edges', () => {
    // 20×10 image: left half black, right half white — very strong edge at x=10
    const pixels = makeImage(20, 10, (x) => x < 10 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
    const mask = applyQuickSelectStroke(
      // High edgeStrength means stop at edges
      { pixels, width: 20, height: 10, radius: 8, tolerance: 128, edgeStrength: 100 },
      { points: [{ x: 5, y: 5 }], existingMask: null, mode: 'add' },
    );
    // Pixels clearly on the white side (x >= 12) must not be selected
    let whiteSelected = 0;
    for (let y = 0; y < 10; y++) {
      for (let x = 12; x < 20; x++) {
        whiteSelected += mask[y * 20 + x]! > 0 ? 1 : 0;
      }
    }
    expect(whiteSelected).toBe(0);
  });

  it('ignores edges when edgeStrength is 0', () => {
    // 20×10: left black, right white — but edge is ignored
    const pixels = makeImage(20, 10, (x) => x < 10 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
    const mask = applyQuickSelectStroke(
      // With high tolerance and edgeStrength=0 the brush selects based on color alone
      { pixels, width: 20, height: 10, radius: 3, tolerance: 10, edgeStrength: 0 },
      { points: [{ x: 5, y: 5 }], existingMask: null, mode: 'add' },
    );
    // White side should still not be selected (different color, low tolerance)
    for (let y = 0; y < 10; y++) {
      for (let x = 12; x < 20; x++) {
        expect(mask[y * 20 + x]).toBe(0);
      }
    }
  });

  it('subtract mode clears selected pixels', () => {
    // Solid red image; first add, then subtract
    const pixels = makeImage(10, 10, () => [255, 0, 0, 255]);
    const added = applyQuickSelectStroke(
      { pixels, width: 10, height: 10, radius: 5, tolerance: 10, edgeStrength: 0 },
      { points: [{ x: 5, y: 5 }], existingMask: null, mode: 'add' },
    );
    const addedCount = countSelected(added);
    expect(addedCount).toBeGreaterThan(0);

    const subtracted = applyQuickSelectStroke(
      { pixels, width: 10, height: 10, radius: 5, tolerance: 10, edgeStrength: 0 },
      { points: [{ x: 5, y: 5 }], existingMask: added, mode: 'subtract' },
    );
    // Should have removed some pixels
    expect(countSelected(subtracted)).toBeLessThan(addedCount);
  });

  it('accumulates across multiple stroke points', () => {
    // Uniform blue image
    const pixels = makeImage(50, 10, () => [0, 100, 200, 255]);
    const onePoint = applyQuickSelectStroke(
      { pixels, width: 50, height: 10, radius: 3, tolerance: 10, edgeStrength: 0 },
      { points: [{ x: 10, y: 5 }], existingMask: null, mode: 'add' },
    );
    const multiPoint = applyQuickSelectStroke(
      { pixels, width: 50, height: 10, radius: 3, tolerance: 10, edgeStrength: 0 },
      { points: [{ x: 10, y: 5 }, { x: 30, y: 5 }, { x: 40, y: 5 }], existingMask: null, mode: 'add' },
    );
    expect(countSelected(multiPoint)).toBeGreaterThan(countSelected(onePoint));
  });

  it('preserves existing mask pixels outside the stroke area', () => {
    const pixels = makeImage(20, 20, () => [128, 128, 128, 255]);
    // Pre-select the top-left corner
    const existingMask = new Uint8ClampedArray(20 * 20);
    existingMask[0] = 255; // pixel (0,0) selected

    const result = applyQuickSelectStroke(
      { pixels, width: 20, height: 20, radius: 2, tolerance: 10, edgeStrength: 0 },
      { points: [{ x: 15, y: 15 }], existingMask, mode: 'add' },
    );
    // The pre-selected pixel must still be selected
    expect(result[0]).toBe(255);
  });

  it('returns a mask of the correct size', () => {
    const pixels = makeImage(30, 20, () => [0, 0, 0, 255]);
    const mask = applyQuickSelectStroke(
      { pixels, width: 30, height: 20, radius: 5, tolerance: 20, edgeStrength: 0 },
      { points: [{ x: 15, y: 10 }], existingMask: null, mode: 'add' },
    );
    expect(mask.length).toBe(30 * 20);
  });

  it('handles empty stroke points by returning the existing mask unchanged', () => {
    const pixels = makeImage(10, 10, () => [255, 0, 0, 255]);
    const existing = new Uint8ClampedArray(10 * 10);
    existing[5] = 255;
    const result = applyQuickSelectStroke(
      { pixels, width: 10, height: 10, radius: 3, tolerance: 10, edgeStrength: 0 },
      { points: [], existingMask: existing, mode: 'add' },
    );
    expect(result[5]).toBe(255);
    expect(countSelected(result)).toBe(1);
  });
});
