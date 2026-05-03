import { describe, it, expect } from 'vitest';
import { brushWeight, applyHistoryBrushDab } from './history-brush';
import { PixelBuffer } from '../../engine/pixel-data';

// ---------------------------------------------------------------------------
// brushWeight
// ---------------------------------------------------------------------------

describe('brushWeight', () => {
  it('returns 1 at center for any hardness', () => {
    expect(brushWeight(0, 10, 1)).toBe(1);
    expect(brushWeight(0, 10, 0.5)).toBe(1);
    expect(brushWeight(0, 10, 0)).toBe(1);
  });

  it('returns 0 at or beyond radius', () => {
    expect(brushWeight(10, 10, 1)).toBe(0);
    expect(brushWeight(15, 10, 0.5)).toBe(0);
  });

  it('returns 1 inside the hard core', () => {
    // hardness=1: entire brush is hard core
    expect(brushWeight(5, 10, 1)).toBe(1);
    // hardness=0.8: hard core radius = 8; d=7 is inside
    expect(brushWeight(7, 10, 0.8)).toBe(1);
  });

  it('returns a value in (0, 1) in the feather zone', () => {
    // hardness=0, no hard core; d=5 is in the middle → strictly between 0 and 1
    const w = brushWeight(5, 10, 0);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(1);
  });

  it('returns 0 for zero radius', () => {
    expect(brushWeight(0, 0, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyHistoryBrushDab
// ---------------------------------------------------------------------------

describe('applyHistoryBrushDab', () => {
  it('paints source pixels onto the destination', () => {
    const source = new PixelBuffer(20, 20);
    source.setPixel(10, 10, { r: 255, g: 0, b: 0, a: 1 });

    const dest = new PixelBuffer(20, 20);

    applyHistoryBrushDab({
      destX: 10,
      destY: 10,
      source,
      dest,
      radius: 2,
      hardness: 1,
      opacity: 1,
    });

    const px = dest.getPixel(10, 10);
    expect(px.r).toBe(255);
    expect(px.g).toBe(0);
    expect(px.b).toBe(0);
    expect(px.a).toBeGreaterThan(0);
  });

  it('does not paint over destinations when source has no content', () => {
    const source = new PixelBuffer(20, 20); // all transparent
    const dest = new PixelBuffer(20, 20);
    dest.setPixel(10, 10, { r: 100, g: 100, b: 100, a: 1 });

    applyHistoryBrushDab({
      destX: 10,
      destY: 10,
      source,
      dest,
      radius: 2,
      hardness: 1,
      opacity: 1,
    });

    // Destination pixel must be unchanged since source has no content
    const px = dest.getPixel(10, 10);
    expect(px.r).toBe(100);
  });

  it('blends at reduced opacity', () => {
    const source = new PixelBuffer(20, 20);
    source.setPixel(10, 10, { r: 200, g: 0, b: 0, a: 1 });

    const dest = new PixelBuffer(20, 20);
    dest.setPixel(10, 10, { r: 0, g: 0, b: 0, a: 1 });

    applyHistoryBrushDab({
      destX: 10,
      destY: 10,
      source,
      dest,
      radius: 2,
      hardness: 1,
      opacity: 0.5,
    });

    const px = dest.getPixel(10, 10);
    // At 50% opacity: blended r = 200*0.5 + 0*0.5 = 100
    expect(px.r).toBeCloseTo(100, -1);
  });

  it('only affects pixels within the circular radius', () => {
    const source = new PixelBuffer(30, 30);
    // fill source with red
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 30; x++) {
        source.setPixel(x, y, { r: 255, g: 0, b: 0, a: 1 });
      }
    }

    const dest = new PixelBuffer(30, 30);

    applyHistoryBrushDab({
      destX: 15,
      destY: 15,
      source,
      dest,
      radius: 4,
      hardness: 1,
      opacity: 1,
    });

    // Pixel far from center should be untouched (transparent)
    const farPixel = dest.getPixel(0, 0);
    expect(farPixel.a).toBe(0);
  });
});
