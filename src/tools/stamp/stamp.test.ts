import { describe, it, expect } from 'vitest';
import { applyStampDab } from './stamp';
import { PixelBuffer } from '../../engine/pixel-data';

describe('applyStampDab', () => {
  it('copies pixels from source to destination at offset', () => {
    const source = new PixelBuffer(20, 20);
    source.setPixel(15, 15, { r: 255, g: 0, b: 0, a: 1 });

    const dest = new PixelBuffer(20, 20);
    // Offset of (5, 5) means source is sampled at destX+5, destY+5
    applyStampDab(dest, source, { x: 10, y: 10 }, { x: 5, y: 5 }, 2);
    const pixel = dest.getPixel(10, 10);
    expect(pixel.r).toBe(255);
  });

  it('skips transparent source pixels', () => {
    const source = new PixelBuffer(20, 20);
    const dest = new PixelBuffer(20, 20);
    dest.setPixel(10, 10, { r: 100, g: 100, b: 100, a: 1 });
    applyStampDab(dest, source, { x: 10, y: 10 }, { x: 0, y: 0 }, 4);
    const pixel = dest.getPixel(10, 10);
    expect(pixel.r).toBe(100); // unchanged
  });

  it('only affects pixels within circular radius', () => {
    const source = new PixelBuffer(20, 20);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        source.setPixel(x, y, { r: 200, g: 200, b: 200, a: 1 });
      }
    }
    const dest = new PixelBuffer(20, 20);
    applyStampDab(dest, source, { x: 10, y: 10 }, { x: 0, y: 0 }, 4);
    // Far corner should be unaffected
    const corner = dest.getPixel(0, 0);
    expect(corner.a).toBe(0);
  });
});
