import { describe, it, expect } from 'vitest';
import { applyDodgeBurn } from './dodge';
import { PixelBuffer } from '../../engine/pixel-data';

describe('applyDodgeBurn', () => {
  function makeBuffer(width: number, height: number, fill: { r: number; g: number; b: number; a: number }) {
    const buf = new PixelBuffer(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        buf.setPixel(x, y, fill);
      }
    }
    return buf;
  }

  it('dodge lightens pixels', () => {
    const buf = makeBuffer(10, 10, { r: 100, g: 100, b: 100, a: 1 });
    applyDodgeBurn(buf, { x: 5, y: 5 }, 4, 'dodge', 0.5);
    const pixel = buf.getPixel(5, 5);
    expect(pixel.r).toBeGreaterThan(100);
    expect(pixel.g).toBeGreaterThan(100);
    expect(pixel.b).toBeGreaterThan(100);
  });

  it('burn darkens pixels', () => {
    const buf = makeBuffer(10, 10, { r: 100, g: 100, b: 100, a: 1 });
    applyDodgeBurn(buf, { x: 5, y: 5 }, 4, 'burn', 0.5);
    const pixel = buf.getPixel(5, 5);
    expect(pixel.r).toBeLessThan(100);
    expect(pixel.g).toBeLessThan(100);
    expect(pixel.b).toBeLessThan(100);
  });

  it('skips transparent pixels', () => {
    const buf = makeBuffer(10, 10, { r: 0, g: 0, b: 0, a: 0 });
    applyDodgeBurn(buf, { x: 5, y: 5 }, 4, 'dodge', 0.5);
    const pixel = buf.getPixel(5, 5);
    expect(pixel.a).toBe(0);
  });

  it('does not exceed 255 for dodge', () => {
    const buf = makeBuffer(10, 10, { r: 250, g: 250, b: 250, a: 1 });
    applyDodgeBurn(buf, { x: 5, y: 5 }, 4, 'dodge', 0.99);
    const pixel = buf.getPixel(5, 5);
    expect(pixel.r).toBeLessThanOrEqual(255);
  });

  it('does not go below 0 for burn', () => {
    const buf = makeBuffer(10, 10, { r: 5, g: 5, b: 5, a: 1 });
    applyDodgeBurn(buf, { x: 5, y: 5 }, 4, 'burn', 0.99);
    const pixel = buf.getPixel(5, 5);
    expect(pixel.r).toBeGreaterThanOrEqual(0);
  });

  it('only affects pixels within circular radius', () => {
    const buf = makeBuffer(20, 20, { r: 100, g: 100, b: 100, a: 1 });
    applyDodgeBurn(buf, { x: 10, y: 10 }, 4, 'dodge', 0.5);
    // Corner pixel far from center should be unchanged
    const corner = buf.getPixel(0, 0);
    expect(corner.r).toBe(100);
  });
});
