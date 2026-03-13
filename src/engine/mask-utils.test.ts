import { describe, it, expect } from 'vitest';
import { createMaskSurface, extractMaskFromSurface } from './mask-utils';

describe('mask-utils', () => {
  describe('createMaskSurface', () => {
    it('converts mask data to a PixelBuffer with grayscale values', () => {
      const maskData = new Uint8ClampedArray([0, 128, 255, 64]);
      const buf = createMaskSurface(maskData, 2, 2);
      expect(buf.width).toBe(2);
      expect(buf.height).toBe(2);
      expect(buf.getPixel(0, 0).r).toBe(0);
      expect(buf.getPixel(1, 0).r).toBe(128);
      expect(buf.getPixel(0, 1).r).toBe(255);
      expect(buf.getPixel(1, 1).r).toBe(64);
    });

    it('sets alpha to 1 for all pixels', () => {
      const maskData = new Uint8ClampedArray([100]);
      const buf = createMaskSurface(maskData, 1, 1);
      expect(buf.getPixel(0, 0).a).toBe(1);
    });
  });

  describe('extractMaskFromSurface', () => {
    it('extracts red channel as mask values', () => {
      const maskData = new Uint8ClampedArray([0, 128, 255, 64]);
      const buf = createMaskSurface(maskData, 2, 2);
      const extracted = extractMaskFromSurface(buf, 2, 2);
      expect(extracted[0]).toBe(0);
      expect(extracted[1]).toBe(128);
      expect(extracted[2]).toBe(255);
      expect(extracted[3]).toBe(64);
    });

    it('roundtrips correctly', () => {
      const original = new Uint8ClampedArray([0, 50, 100, 150, 200, 255, 25, 75, 125]);
      const buf = createMaskSurface(original, 3, 3);
      const extracted = extractMaskFromSurface(buf, 3, 3);
      for (let i = 0; i < original.length; i++) {
        expect(extracted[i]).toBe(original[i]);
      }
    });
  });
});
