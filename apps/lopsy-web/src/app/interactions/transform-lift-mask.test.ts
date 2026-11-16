import { describe, it, expect } from 'vitest';
import { transformLiftMask, transformSelectionOfLayer } from './transform-lift-mask';
import { createTransformState, type TransformState } from '../../tools/transform/transform';

const W = 40;
const H = 40;

function rectMask(x0: number, y0: number, x1: number, y1: number, value = 255): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(W * H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * W + x] = value;
  return mask;
}

/** A uniform scale by `s` about the box's bottom-right corner, as a ⌘-drag of the top-left handle. */
function scaledAboutBottomRight(x: number, y: number, w: number, h: number, s: number): TransformState {
  const base = createTransformState({ x, y, width: w, height: h });
  return {
    ...base,
    scaleX: s,
    scaleY: s,
    translateX: -(w * (s - 1)) / 2,
    translateY: -(h * (s - 1)) / 2,
  };
}

describe('transformLiftMask', () => {
  it('lifts every pixel a scaled hard selection touches whole, though the mask edge is soft', () => {
    const original = rectMask(10, 10, 20, 30);
    const { mask } = transformSelectionOfLayer('a', original, W, H, scaledAboutBottomRight(10, 10, 10, 20, 1.17));
    const soft = Array.from(mask).filter((v) => v > 0 && v < 255).length;
    expect(soft).toBeGreaterThan(0);

    const lift = transformLiftMask('a', mask)!;
    for (let i = 0; i < mask.length; i++) expect(lift[i]).toBe(mask[i]! > 0 ? 255 : 0);
  });

  it('keeps a feathered selection feathered, dividing out only the resampled edge', () => {
    const original = rectMask(10, 10, 20, 30, 128);
    const { mask } = transformSelectionOfLayer('a', original, W, H, scaledAboutBottomRight(10, 10, 10, 20, 1.17));
    const lift = transformLiftMask('a', mask)!;
    expect(Array.from(lift).filter((v) => v > 0).length).toBe(Array.from(mask).filter((v) => v > 0).length);
    let edge = 0;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]! === 0 || mask[i]! === 128) continue;
      edge++;
      // Rounding the mask to 8 bits blurs the ratio where coverage is tiny.
      if (mask[i]! >= 16) expect(Math.abs(lift[i]! - 128), `pixel ${i}: mask ${mask[i]}`).toBeLessThanOrEqual(4);
    }
    expect(edge).toBeGreaterThan(0);
    expect(Array.from(lift).filter((v) => v > 140).length).toBeLessThan(edge / 4);
  });

  it('is null for another layer, an untransformed selection, or a new mask', () => {
    const original = rectMask(10, 10, 20, 30);
    const { mask } = transformSelectionOfLayer('a', original, W, H, scaledAboutBottomRight(10, 10, 10, 20, 1.5));
    expect(transformLiftMask('b', mask)).toBeNull();
    expect(transformLiftMask('a', original)).toBeNull();
    expect(transformLiftMask('a', new Uint8ClampedArray(mask))).toBeNull();
  });
});
