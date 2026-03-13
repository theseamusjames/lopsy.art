import { describe, it, expect } from 'vitest';
import { PixelBuffer } from '../engine/pixel-data';
import { gaussianBlur, boxBlur } from './blur';

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

describe('gaussianBlur', () => {
  it('returns a clone when radius is 0', () => {
    const buf = makeSolidBuffer(4, 4, 100, 150, 200);
    const result = gaussianBlur(buf, 0);
    const pixel = result.getPixel(2, 2);
    expect(pixel.r).toBe(100);
    expect(pixel.g).toBe(150);
    expect(pixel.b).toBe(200);
  });

  it('does not modify a uniform buffer', () => {
    const buf = makeSolidBuffer(10, 10, 128, 128, 128);
    const result = gaussianBlur(buf, 2);
    const pixel = result.getPixel(5, 5);
    expect(pixel.r).toBe(128);
    expect(pixel.g).toBe(128);
    expect(pixel.b).toBe(128);
  });

  it('blurs a single bright pixel toward its neighbors', () => {
    const buf = new PixelBuffer(5, 5);
    buf.fill({ r: 0, g: 0, b: 0, a: 1 });
    buf.setPixel(2, 2, { r: 255, g: 255, b: 255, a: 1 });

    const result = gaussianBlur(buf, 1);
    const center = result.getPixel(2, 2);
    const neighbor = result.getPixel(3, 2);

    // Center should be dimmed (no longer 255)
    expect(center.r).toBeLessThan(255);
    // Neighbor should have picked up some brightness
    expect(neighbor.r).toBeGreaterThan(0);
  });

  it('preserves alpha channel', () => {
    const buf = makeSolidBuffer(5, 5, 100, 100, 100, 0.5);
    const result = gaussianBlur(buf, 1);
    const pixel = result.getPixel(2, 2);
    expect(pixel.a).toBeCloseTo(0.5, 1);
  });

  it('produces correct dimensions', () => {
    const buf = makeSolidBuffer(7, 11, 0, 0, 0);
    const result = gaussianBlur(buf, 2);
    expect(result.width).toBe(7);
    expect(result.height).toBe(11);
  });
});

describe('boxBlur', () => {
  it('returns a clone when radius is 0', () => {
    const buf = makeSolidBuffer(4, 4, 50, 100, 150);
    const result = boxBlur(buf, 0);
    const pixel = result.getPixel(1, 1);
    expect(pixel.r).toBe(50);
    expect(pixel.g).toBe(100);
    expect(pixel.b).toBe(150);
  });

  it('does not modify a uniform buffer', () => {
    const buf = makeSolidBuffer(10, 10, 200, 200, 200);
    const result = boxBlur(buf, 3);
    const pixel = result.getPixel(5, 5);
    expect(pixel.r).toBe(200);
    expect(pixel.g).toBe(200);
    expect(pixel.b).toBe(200);
  });

  it('blurs a single bright pixel', () => {
    const buf = new PixelBuffer(5, 5);
    buf.fill({ r: 0, g: 0, b: 0, a: 1 });
    buf.setPixel(2, 2, { r: 255, g: 0, b: 0, a: 1 });

    const result = boxBlur(buf, 1);
    const center = result.getPixel(2, 2);

    // Center should be dimmed from averaging
    expect(center.r).toBeLessThan(255);
    expect(center.r).toBeGreaterThan(0);
  });

  it('produces output with same dimensions', () => {
    const buf = makeSolidBuffer(13, 9, 0, 0, 0);
    const result = boxBlur(buf, 2);
    expect(result.width).toBe(13);
    expect(result.height).toBe(9);
  });
});
