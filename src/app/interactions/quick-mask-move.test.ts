import { describe, it, expect } from 'vitest';
import { translateSelectionMask, translateQuickMaskContent } from './quick-mask-move';

const DOC_W = 8;
const DOC_H = 8;

function makeMask(filled: Array<[number, number]>): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(DOC_W * DOC_H);
  for (const [x, y] of filled) {
    mask[y * DOC_W + x] = 255;
  }
  return mask;
}

describe('translateSelectionMask', () => {
  it('returns the mask unchanged when dx/dy are zero', () => {
    const orig = makeMask([[2, 2], [3, 2], [2, 3], [3, 3]]);
    const { mask, bounds } = translateSelectionMask(
      orig,
      { x: 2, y: 2, width: 2, height: 2 },
      0, 0, DOC_W, DOC_H,
    );
    expect(Array.from(mask)).toEqual(Array.from(orig));
    expect(bounds).toEqual({ x: 2, y: 2, width: 2, height: 2 });
  });

  it('shifts mask values by (dx, dy) in document space', () => {
    const orig = makeMask([[2, 2]]);
    const { mask, bounds } = translateSelectionMask(
      orig,
      { x: 2, y: 2, width: 1, height: 1 },
      3, 1, DOC_W, DOC_H,
    );
    expect(mask[2 * DOC_W + 2]).toBe(0);
    expect(mask[3 * DOC_W + 5]).toBe(255);
    expect(bounds).toEqual({ x: 5, y: 3, width: 1, height: 1 });
  });

  it('drops pixels that fall outside the document on the right', () => {
    const orig = makeMask([[6, 4], [7, 4]]);
    const { mask } = translateSelectionMask(
      orig,
      { x: 6, y: 4, width: 2, height: 1 },
      2, 0, DOC_W, DOC_H,
    );
    expect(mask.some((v) => v === 255)).toBe(false);
  });

  it('drops pixels that fall outside the document on the top', () => {
    const orig = makeMask([[3, 0], [3, 1]]);
    const { mask } = translateSelectionMask(
      orig,
      { x: 3, y: 0, width: 1, height: 2 },
      0, -2, DOC_W, DOC_H,
    );
    expect(mask.some((v) => v === 255)).toBe(false);
  });

  it('shifts bounds even when content is fully clipped (caller decides what to do)', () => {
    const orig = makeMask([[0, 0]]);
    const { bounds } = translateSelectionMask(
      orig,
      { x: 0, y: 0, width: 1, height: 1 },
      -10, -10, DOC_W, DOC_H,
    );
    expect(bounds).toEqual({ x: -10, y: -10, width: 1, height: 1 });
  });

  it('does not mutate the input mask', () => {
    const orig = makeMask([[2, 2]]);
    const copy = new Uint8ClampedArray(orig);
    translateSelectionMask(orig, { x: 2, y: 2, width: 1, height: 1 }, 1, 1, DOC_W, DOC_H);
    expect(Array.from(orig)).toEqual(Array.from(copy));
  });

  it('returns a buffer sized to the document', () => {
    const orig = makeMask([[2, 2]]);
    const { mask } = translateSelectionMask(
      orig,
      { x: 2, y: 2, width: 1, height: 1 },
      0, 0, DOC_W, DOC_H,
    );
    expect(mask.length).toBe(DOC_W * DOC_H);
  });

  it('handles a mask that wraps across both axes simultaneously', () => {
    const orig = makeMask([[1, 1], [2, 1], [1, 2], [2, 2]]);
    const { mask, bounds } = translateSelectionMask(
      orig,
      { x: 1, y: 1, width: 2, height: 2 },
      4, 4, DOC_W, DOC_H,
    );
    expect(mask[5 * DOC_W + 5]).toBe(255);
    expect(mask[5 * DOC_W + 6]).toBe(255);
    expect(mask[6 * DOC_W + 5]).toBe(255);
    expect(mask[6 * DOC_W + 6]).toBe(255);
    expect(mask[1 * DOC_W + 1]).toBe(0);
    expect(bounds).toEqual({ x: 5, y: 5, width: 2, height: 2 });
  });
});

function makeMaskU8(filled: Array<[number, number, number]>): Uint8Array {
  const mask = new Uint8Array(DOC_W * DOC_H);
  for (const [x, y, v] of filled) {
    mask[y * DOC_W + x] = v;
  }
  return mask;
}

describe('translateQuickMaskContent', () => {
  it('moves painted content inside the marquee by (dx, dy)', () => {
    const orig = makeMaskU8([[2, 2, 200], [3, 2, 200], [2, 3, 200], [3, 3, 200]]);
    const marquee = makeMask([[2, 2], [3, 2], [2, 3], [3, 3]]);
    const out = translateQuickMaskContent(orig, marquee, 2, 1, DOC_W, DOC_H);
    expect(out[2 * DOC_W + 2]).toBe(0);
    expect(out[2 * DOC_W + 3]).toBe(0);
    expect(out[3 * DOC_W + 2]).toBe(0);
    expect(out[3 * DOC_W + 3]).toBe(0);
    expect(out[3 * DOC_W + 4]).toBe(200);
    expect(out[3 * DOC_W + 5]).toBe(200);
    expect(out[4 * DOC_W + 4]).toBe(200);
    expect(out[4 * DOC_W + 5]).toBe(200);
  });

  it('leaves pixels outside the marquee untouched', () => {
    const orig = makeMaskU8([[0, 0, 128], [7, 7, 255], [3, 3, 200]]);
    const marquee = makeMask([[3, 3]]);
    const out = translateQuickMaskContent(orig, marquee, 1, 0, DOC_W, DOC_H);
    expect(out[0]).toBe(128);
    expect(out[7 * DOC_W + 7]).toBe(255);
    expect(out[3 * DOC_W + 3]).toBe(0);
    expect(out[3 * DOC_W + 4]).toBe(200);
  });

  it('clips content moved outside the document', () => {
    const orig = makeMaskU8([[7, 4, 255]]);
    const marquee = makeMask([[7, 4]]);
    const out = translateQuickMaskContent(orig, marquee, 2, 0, DOC_W, DOC_H);
    expect(out.some((v) => v > 0)).toBe(false);
  });

  it('returns the original pixels for dx=dy=0', () => {
    const orig = makeMaskU8([[2, 2, 200], [3, 3, 100]]);
    const marquee = makeMask([[2, 2], [3, 3]]);
    const out = translateQuickMaskContent(orig, marquee, 0, 0, DOC_W, DOC_H);
    expect(Array.from(out)).toEqual(Array.from(orig));
  });

  it('does not mutate the input pixels', () => {
    const orig = makeMaskU8([[2, 2, 200]]);
    const marquee = makeMask([[2, 2]]);
    const before = new Uint8Array(orig);
    translateQuickMaskContent(orig, marquee, 1, 1, DOC_W, DOC_H);
    expect(Array.from(orig)).toEqual(Array.from(before));
  });

  it('max-blends moved content onto existing painted content outside the marquee', () => {
    // Painted content under marquee (value 200) and a fixed painted blob
    // outside the marquee (value 50) at the destination.
    const orig = makeMaskU8([[2, 2, 200], [3, 2, 50]]);
    const marquee = makeMask([[2, 2]]);
    const out = translateQuickMaskContent(orig, marquee, 1, 0, DOC_W, DOC_H);
    // Source pixel cleared
    expect(out[2 * DOC_W + 2]).toBe(0);
    // Destination is the max of existing (50) and moved (200)
    expect(out[2 * DOC_W + 3]).toBe(200);
  });

  it('returns a buffer sized to the document', () => {
    const orig = makeMaskU8([[2, 2, 200]]);
    const marquee = makeMask([[2, 2]]);
    const out = translateQuickMaskContent(orig, marquee, 1, 1, DOC_W, DOC_H);
    expect(out.length).toBe(DOC_W * DOC_H);
  });

  it('clears pixels under the original marquee even when destination is off-canvas', () => {
    const orig = makeMaskU8([[2, 2, 255], [3, 3, 255]]);
    const marquee = makeMask([[2, 2], [3, 3]]);
    const out = translateQuickMaskContent(orig, marquee, 100, 100, DOC_W, DOC_H);
    expect(out[2 * DOC_W + 2]).toBe(0);
    expect(out[3 * DOC_W + 3]).toBe(0);
    expect(out.some((v) => v > 0)).toBe(false);
  });
});
