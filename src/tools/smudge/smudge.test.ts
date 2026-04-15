import { describe, it, expect } from 'vitest';
import { applySmudgeDab } from './smudge';
import { PixelBuffer } from '../../engine/pixel-data';
import type { Color } from '../../types';

function makeBuffer(width: number, height: number, fill: Color): PixelBuffer {
  const buf = new PixelBuffer(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      buf.setPixel(x, y, fill);
    }
  }
  return buf;
}

function makeHalfSplit(width: number, height: number, splitX: number, left: Color, right: Color): PixelBuffer {
  const buf = new PixelBuffer(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      buf.setPixel(x, y, x < splitX ? left : right);
    }
  }
  return buf;
}

describe('applySmudgeDab', () => {
  it('no motion leaves the buffer unchanged', () => {
    const buf = makeHalfSplit(40, 40, 20,
      { r: 255, g: 0, b: 0, a: 1 },
      { r: 0, g: 0, b: 255, a: 1 });
    const before = buf.rawData.slice();
    applySmudgeDab(buf, { x: 20, y: 20 }, { x: 20, y: 20 }, 10, 0.8);
    expect(buf.rawData).toEqual(before);
  });

  it('strength=0 leaves the buffer unchanged even with motion', () => {
    const buf = makeHalfSplit(40, 40, 20,
      { r: 255, g: 0, b: 0, a: 1 },
      { r: 0, g: 0, b: 255, a: 1 });
    const before = buf.rawData.slice();
    applySmudgeDab(buf, { x: 15, y: 20 }, { x: 25, y: 20 }, 10, 0);
    expect(buf.rawData).toEqual(before);
  });

  it('pulls red across the red/blue border along stroke direction', () => {
    // Red on the left (x < 20), blue on the right. Stroke moves rightward
    // from x=18 to x=22 — the dab at x=22 should pull red into the blue side.
    const buf = makeHalfSplit(40, 40, 20,
      { r: 255, g: 0, b: 0, a: 1 },
      { r: 0, g: 0, b: 255, a: 1 });
    applySmudgeDab(buf, { x: 18, y: 20 }, { x: 22, y: 20 }, 10, 1);

    // A pixel that was blue (x=22 is in the blue region) should now have red
    // mixed in — the center of the dab is pulled fully from the location
    // four pixels to the left, which was red.
    const centre = buf.getPixel(22, 20);
    expect(centre.r).toBeGreaterThan(200); // mostly red now
    expect(centre.b).toBeLessThan(50);
  });

  it('does not affect pixels far outside the brush radius', () => {
    const buf = makeHalfSplit(60, 60, 30,
      { r: 255, g: 0, b: 0, a: 1 },
      { r: 0, g: 0, b: 255, a: 1 });
    applySmudgeDab(buf, { x: 25, y: 30 }, { x: 35, y: 30 }, 10, 1);

    // A pixel well outside the 5-pixel radius from center=(35,30) must be
    // untouched.
    const far = buf.getPixel(55, 55);
    expect(far).toEqual({ r: 0, g: 0, b: 255, a: 1 });
  });

  it('soft falloff — centre smudges more than edge', () => {
    const buf = makeHalfSplit(40, 40, 20,
      { r: 255, g: 0, b: 0, a: 1 },
      { r: 0, g: 0, b: 255, a: 1 });
    applySmudgeDab(buf, { x: 18, y: 20 }, { x: 22, y: 20 }, 10, 1);

    const centre = buf.getPixel(22, 20);
    // A pixel near the edge of the brush (4 px from centre, radius=5) should
    // have been only lightly affected.
    const edge = buf.getPixel(22, 24);
    // Centre pulls more red than the edge — edge stays closer to blue.
    expect(centre.r).toBeGreaterThan(edge.r);
    expect(edge.b).toBeGreaterThan(centre.b);
  });

  it('preserves pixels on a uniformly-coloured surface', () => {
    const buf = makeBuffer(30, 30, { r: 100, g: 100, b: 100, a: 1 });
    applySmudgeDab(buf, { x: 10, y: 15 }, { x: 20, y: 15 }, 10, 1);
    // Any pulled pixel is also grey, so the buffer should be identical.
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 30; x++) {
        const p = buf.getPixel(x, y);
        expect(p.r).toBe(100);
        expect(p.g).toBe(100);
        expect(p.b).toBe(100);
      }
    }
  });
});
