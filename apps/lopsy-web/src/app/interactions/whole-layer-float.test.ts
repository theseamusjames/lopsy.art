import { afterEach, describe, expect, it } from 'vitest';
import {
  forgetLayerAlphaSelection,
  isLayerAlphaSelection,
  layerAlphaOutline,
  recordLayerAlphaSelection,
  type LayerAlphaContent,
} from './layer-alpha-selection';
import { wholeLayerFloatFor, wholeLayerSelectionAt } from './whole-layer-float';

// A 4×2 opaque block whose left half hangs past the canvas's left edge.
const content: LayerAlphaContent = {
  alpha: new Uint8ClampedArray(8).fill(255),
  rect: { x: -2, y: 1, width: 4, height: 2 },
};
const DOC_W = 6;
const DOC_H = 4;

function clippedMask(): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(DOC_W * DOC_H);
  for (const y of [1, 2]) for (const x of [0, 1]) mask[y * DOC_W + x] = 255;
  return mask;
}

afterEach(() => forgetLayerAlphaSelection());

describe('wholeLayerFloatFor', () => {
  it('carries the layer alpha only for the recorded layer-alpha selection', () => {
    const mask = clippedMask();
    recordLayerAlphaSelection('a', mask, content);
    expect(wholeLayerFloatFor('a', mask, true)?.content).toBe(content);
    expect(wholeLayerFloatFor('b', mask, true)).toBeUndefined();
    expect(wholeLayerFloatFor('a', clippedMask(), true)).toBeUndefined();
  });
});

describe('wholeLayerSelectionAt', () => {
  it('frames all of the moved layer, including what was past the edge', () => {
    const mask = clippedMask();
    recordLayerAlphaSelection('a', mask, content);
    const whole = wholeLayerFloatFor('a', mask, true)!;
    const moved = wholeLayerSelectionAt('a', whole, 3, 0, DOC_W, DOC_H);
    expect(moved.bounds).toEqual({ x: 1, y: 1, width: 4, height: 2 });
    for (const y of [1, 2]) {
      for (let x = 0; x < DOC_W; x++) {
        expect(moved.mask[y * DOC_W + x]).toBe(x >= 1 && x <= 4 ? 255 : 0);
      }
    }
    // The layer holds only the float, so the new selection is its alpha again.
    expect(isLayerAlphaSelection('a', moved.mask)).toBe(true);
    expect(layerAlphaOutline(moved.mask)?.bounds).toEqual(moved.bounds);
  });

  it('does not call the selection the layer alpha once a copy was left behind', () => {
    const mask = clippedMask();
    recordLayerAlphaSelection('a', mask, content);
    const whole = wholeLayerFloatFor('a', mask, false)!;
    const moved = wholeLayerSelectionAt('a', whole, 3, 0, DOC_W, DOC_H);
    expect(moved.bounds.width).toBe(4);
    expect(isLayerAlphaSelection('a', moved.mask)).toBe(false);
  });
});

describe('layerAlphaOutline', () => {
  it('traces the whole layer in document coordinates', () => {
    const mask = clippedMask();
    recordLayerAlphaSelection('a', mask, content);
    const outline = layerAlphaOutline(mask)!;
    const xs = outline.contours.flatMap((pts) => pts.filter((_, i) => i % 2 === 0));
    expect(Math.min(...xs)).toBe(-2);
    expect(Math.max(...xs)).toBe(2);
    expect(layerAlphaOutline(clippedMask())).toBeNull();
  });
});
