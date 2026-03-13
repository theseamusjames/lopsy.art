import { describe, it, expect } from 'vitest';
import { PixelBuffer } from '../engine/pixel-data';
import { addNoise, fillWithNoise } from './noise';

function makeSolidBuffer(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a: number = 1,
): PixelBuffer {
  const buf = new PixelBuffer(width, height);
  buf.fill({ r, g, b, a });
  return buf;
}

describe('addNoise', () => {
  it('returns a clone when amount is 0', () => {
    const buf = makeSolidBuffer(4, 4, 128, 128, 128);
    const result = addNoise(buf, 0, 'uniform', false);
    const pixel = result.getPixel(2, 2);
    expect(pixel.r).toBe(128);
    expect(pixel.g).toBe(128);
    expect(pixel.b).toBe(128);
  });

  it('modifies pixel values with uniform noise', () => {
    const buf = makeSolidBuffer(20, 20, 128, 128, 128);
    const result = addNoise(buf, 50, 'uniform', false);

    let hasChange = false;
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const pixel = result.getPixel(x, y);
        if (pixel.r !== 128 || pixel.g !== 128 || pixel.b !== 128) {
          hasChange = true;
          break;
        }
      }
      if (hasChange) break;
    }
    expect(hasChange).toBe(true);
  });

  it('modifies pixel values with gaussian noise', () => {
    const buf = makeSolidBuffer(20, 20, 128, 128, 128);
    const result = addNoise(buf, 50, 'gaussian', false);

    let hasChange = false;
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const pixel = result.getPixel(x, y);
        if (pixel.r !== 128 || pixel.g !== 128 || pixel.b !== 128) {
          hasChange = true;
          break;
        }
      }
      if (hasChange) break;
    }
    expect(hasChange).toBe(true);
  });

  it('monochromatic noise has equal R, G, B per pixel', () => {
    const buf = makeSolidBuffer(10, 10, 128, 128, 128);
    const result = addNoise(buf, 50, 'uniform', true);

    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const pixel = result.getPixel(x, y);
        expect(pixel.r).toBe(pixel.g);
        expect(pixel.g).toBe(pixel.b);
      }
    }
  });

  it('preserves alpha', () => {
    const buf = makeSolidBuffer(5, 5, 128, 128, 128, 0.7);
    const result = addNoise(buf, 30, 'uniform', false);
    const pixel = result.getPixel(2, 2);
    expect(pixel.a).toBeCloseTo(0.7, 1);
  });

  it('clamps values to 0-255 range', () => {
    const buf = makeSolidBuffer(10, 10, 250, 250, 250);
    const result = addNoise(buf, 100, 'uniform', false);

    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const pixel = result.getPixel(x, y);
        expect(pixel.r).toBeGreaterThanOrEqual(0);
        expect(pixel.r).toBeLessThanOrEqual(255);
        expect(pixel.g).toBeGreaterThanOrEqual(0);
        expect(pixel.g).toBeLessThanOrEqual(255);
        expect(pixel.b).toBeGreaterThanOrEqual(0);
        expect(pixel.b).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('fillWithNoise', () => {
  it('fills buffer with non-zero values', () => {
    const buf = new PixelBuffer(10, 10);
    const result = fillWithNoise(buf, 'uniform', false);

    let hasNonZero = false;
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const pixel = result.getPixel(x, y);
        if (pixel.r > 0 || pixel.g > 0 || pixel.b > 0) {
          hasNonZero = true;
          break;
        }
      }
      if (hasNonZero) break;
    }
    expect(hasNonZero).toBe(true);
  });

  it('sets alpha to 1 for all pixels', () => {
    const buf = new PixelBuffer(5, 5);
    const result = fillWithNoise(buf, 'uniform', false);

    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const pixel = result.getPixel(x, y);
        expect(pixel.a).toBe(1);
      }
    }
  });

  it('monochromatic fill has equal R, G, B', () => {
    const buf = new PixelBuffer(10, 10);
    const result = fillWithNoise(buf, 'uniform', true);

    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const pixel = result.getPixel(x, y);
        expect(pixel.r).toBe(pixel.g);
        expect(pixel.g).toBe(pixel.b);
      }
    }
  });

  it('gaussian fill produces values in valid range', () => {
    const buf = new PixelBuffer(10, 10);
    const result = fillWithNoise(buf, 'gaussian', false);

    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const pixel = result.getPixel(x, y);
        expect(pixel.r).toBeGreaterThanOrEqual(0);
        expect(pixel.r).toBeLessThanOrEqual(255);
        expect(pixel.g).toBeGreaterThanOrEqual(0);
        expect(pixel.g).toBeLessThanOrEqual(255);
        expect(pixel.b).toBeGreaterThanOrEqual(0);
        expect(pixel.b).toBeLessThanOrEqual(255);
      }
    }
  });

  it('preserves buffer dimensions', () => {
    const buf = new PixelBuffer(7, 13);
    const result = fillWithNoise(buf, 'uniform', false);
    expect(result.width).toBe(7);
    expect(result.height).toBe(13);
  });
});
