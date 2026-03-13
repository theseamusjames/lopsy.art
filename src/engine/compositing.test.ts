import { describe, it, expect } from 'vitest';
import { compositeOver } from './compositing';

describe('compositeOver', () => {
  it('composites opaque source over transparent destination', () => {
    const top = new Uint8ClampedArray([255, 0, 0, 255]); // Red, opaque
    const bottom = new Uint8ClampedArray([0, 0, 0, 0]); // Transparent
    const result = new Uint8ClampedArray(bottom);
    compositeOver(top, bottom, 1, 1, 1, 1, 0, 0, 1, result);
    expect(result[0]).toBe(255);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
    expect(result[3]).toBe(255);
  });

  it('composites with opacity', () => {
    const top = new Uint8ClampedArray([255, 0, 0, 255]);
    const bottom = new Uint8ClampedArray([0, 0, 255, 255]);
    const result = new Uint8ClampedArray(bottom);
    compositeOver(top, bottom, 1, 1, 1, 1, 0, 0, 0.5, result);
    // Should be a mix of red and blue
    expect(result[0]).toBeGreaterThan(0);
    expect(result[2]).toBeGreaterThan(0);
    expect(result[3]).toBe(255);
  });

  it('respects offset positioning', () => {
    const top = new Uint8ClampedArray([255, 0, 0, 255]);
    const bottom = new Uint8ClampedArray(16); // 2x2
    const result = new Uint8ClampedArray(bottom);
    compositeOver(top, bottom, 1, 1, 2, 2, 1, 1, 1, result);
    // Pixel at (1,1) should be red
    expect(result[12]).toBe(255); // (1*2+1)*4 = 12
    // Pixel at (0,0) should be unchanged
    expect(result[0]).toBe(0);
  });

  it('skips out-of-bounds pixels', () => {
    const top = new Uint8ClampedArray([255, 0, 0, 255]);
    const bottom = new Uint8ClampedArray(4);
    const result = new Uint8ClampedArray(bottom);
    compositeOver(top, bottom, 1, 1, 1, 1, 5, 5, 1, result);
    expect(result[0]).toBe(0); // No change
  });
});
