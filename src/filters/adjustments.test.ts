import { describe, it, expect } from 'vitest';
import { PixelBuffer } from '../engine/pixel-data';
import {
  brightnessContrast,
  hueSaturation,
  invert,
  desaturate,
  posterize,
  threshold,
} from './adjustments';

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

describe('brightnessContrast', () => {
  it('no change with 0 brightness and 0 contrast', () => {
    const buf = makeSolidBuffer(4, 4, 100, 150, 200);
    const result = brightnessContrast(buf, 0, 0);
    const pixel = result.getPixel(2, 2);
    expect(pixel.r).toBe(100);
    expect(pixel.g).toBe(150);
    expect(pixel.b).toBe(200);
  });

  it('increases brightness', () => {
    const buf = makeSolidBuffer(4, 4, 100, 100, 100);
    const result = brightnessContrast(buf, 50, 0);
    const pixel = result.getPixel(2, 2);
    expect(pixel.r).toBeGreaterThan(100);
  });

  it('decreases brightness', () => {
    const buf = makeSolidBuffer(4, 4, 100, 100, 100);
    const result = brightnessContrast(buf, -50, 0);
    const pixel = result.getPixel(2, 2);
    expect(pixel.r).toBeLessThan(100);
  });

  it('clamps to valid range', () => {
    const buf = makeSolidBuffer(4, 4, 250, 250, 250);
    const result = brightnessContrast(buf, 100, 100);
    const pixel = result.getPixel(2, 2);
    expect(pixel.r).toBeLessThanOrEqual(255);
    expect(pixel.r).toBeGreaterThanOrEqual(0);
  });

  it('preserves alpha', () => {
    const buf = makeSolidBuffer(4, 4, 100, 100, 100, 0.5);
    const result = brightnessContrast(buf, 50, 50);
    const pixel = result.getPixel(2, 2);
    expect(pixel.a).toBeCloseTo(0.5, 1);
  });
});

describe('hueSaturation', () => {
  it('no change with all zeros', () => {
    const buf = makeSolidBuffer(4, 4, 200, 100, 50);
    const result = hueSaturation(buf, 0, 0, 0);
    const pixel = result.getPixel(2, 2);
    // Should be very close to original (minor floating point allowed)
    expect(pixel.r).toBeCloseTo(200, -1);
    expect(pixel.g).toBeCloseTo(100, -1);
    expect(pixel.b).toBeCloseTo(50, -1);
  });

  it('shifting hue by 180 changes colors', () => {
    const buf = makeSolidBuffer(4, 4, 255, 0, 0);
    const result = hueSaturation(buf, 180, 0, 0);
    const pixel = result.getPixel(2, 2);
    // Red shifted by 180 -> cyan
    expect(pixel.r).toBeLessThan(50);
    expect(pixel.g).toBeGreaterThan(200);
    expect(pixel.b).toBeGreaterThan(200);
  });

  it('full desaturation via saturation=-100 yields gray', () => {
    const buf = makeSolidBuffer(4, 4, 255, 0, 0);
    const result = hueSaturation(buf, 0, -100, 0);
    const pixel = result.getPixel(2, 2);
    expect(pixel.r).toBe(pixel.g);
    expect(pixel.g).toBe(pixel.b);
  });

  it('preserves alpha', () => {
    const buf = makeSolidBuffer(4, 4, 100, 150, 200, 0.3);
    const result = hueSaturation(buf, 45, 20, 10);
    const pixel = result.getPixel(2, 2);
    expect(pixel.a).toBeCloseTo(0.3, 1);
  });
});

describe('invert', () => {
  it('inverts pixel values', () => {
    const buf = makeSolidBuffer(4, 4, 100, 150, 200);
    const result = invert(buf);
    const pixel = result.getPixel(2, 2);
    expect(pixel.r).toBe(155);
    expect(pixel.g).toBe(105);
    expect(pixel.b).toBe(55);
  });

  it('double invert restores original', () => {
    const buf = makeSolidBuffer(4, 4, 42, 128, 255);
    const result = invert(invert(buf));
    const pixel = result.getPixel(2, 2);
    expect(pixel.r).toBe(42);
    expect(pixel.g).toBe(128);
    expect(pixel.b).toBe(255);
  });

  it('preserves alpha', () => {
    const buf = makeSolidBuffer(4, 4, 100, 100, 100, 0.8);
    const result = invert(buf);
    const pixel = result.getPixel(2, 2);
    expect(pixel.a).toBeCloseTo(0.8, 1);
  });
});

describe('desaturate', () => {
  it('converts to grayscale using luminance weights', () => {
    const buf = makeSolidBuffer(4, 4, 255, 0, 0);
    const result = desaturate(buf);
    const pixel = result.getPixel(2, 2);
    // 0.299 * 255 = ~76
    expect(pixel.r).toBeCloseTo(76, 0);
    expect(pixel.r).toBe(pixel.g);
    expect(pixel.g).toBe(pixel.b);
  });

  it('gray stays gray', () => {
    const buf = makeSolidBuffer(4, 4, 128, 128, 128);
    const result = desaturate(buf);
    const pixel = result.getPixel(2, 2);
    expect(pixel.r).toBe(128);
    expect(pixel.g).toBe(128);
    expect(pixel.b).toBe(128);
  });

  it('preserves alpha', () => {
    const buf = makeSolidBuffer(4, 4, 255, 0, 0, 0.6);
    const result = desaturate(buf);
    const pixel = result.getPixel(2, 2);
    expect(pixel.a).toBeCloseTo(0.6, 1);
  });
});

describe('posterize', () => {
  it('with 2 levels produces black and white', () => {
    const buf = new PixelBuffer(4, 4);
    buf.setPixel(0, 0, { r: 200, g: 200, b: 200, a: 1 });
    buf.setPixel(1, 0, { r: 50, g: 50, b: 50, a: 1 });

    const result = posterize(buf, 2);
    const bright = result.getPixel(0, 0);
    const dark = result.getPixel(1, 0);

    expect(bright.r).toBe(255);
    expect(dark.r).toBe(0);
  });

  it('preserves alpha', () => {
    const buf = makeSolidBuffer(4, 4, 128, 128, 128, 0.4);
    const result = posterize(buf, 4);
    const pixel = result.getPixel(2, 2);
    expect(pixel.a).toBeCloseTo(0.4, 1);
  });
});

describe('threshold', () => {
  it('pixels above level become white', () => {
    const buf = makeSolidBuffer(4, 4, 200, 200, 200);
    const result = threshold(buf, 128);
    const pixel = result.getPixel(2, 2);
    expect(pixel.r).toBe(255);
    expect(pixel.g).toBe(255);
    expect(pixel.b).toBe(255);
  });

  it('pixels below level become black', () => {
    const buf = makeSolidBuffer(4, 4, 50, 50, 50);
    const result = threshold(buf, 128);
    const pixel = result.getPixel(2, 2);
    expect(pixel.r).toBe(0);
    expect(pixel.g).toBe(0);
    expect(pixel.b).toBe(0);
  });

  it('preserves alpha', () => {
    const buf = makeSolidBuffer(4, 4, 200, 200, 200, 0.5);
    const result = threshold(buf, 128);
    const pixel = result.getPixel(2, 2);
    expect(pixel.a).toBeCloseTo(0.5, 1);
  });
});
