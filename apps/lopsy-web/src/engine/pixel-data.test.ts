import { describe, it, expect } from 'vitest';
import { PixelBuffer } from './pixel-data';
import type { Color } from '../types/index';

const RED: Color = { r: 255, g: 0, b: 0, a: 1 };
const GREEN: Color = { r: 0, g: 255, b: 0, a: 1 };
const SEMI_BLUE: Color = { r: 0, g: 0, b: 255, a: 0.5 };

describe('PixelBuffer', () => {
  it('creates a buffer with correct dimensions', () => {
    const buf = new PixelBuffer(10, 20);
    expect(buf.width).toBe(10);
    expect(buf.height).toBe(20);
  });

  describe('get/set pixel', () => {
    it('round-trips a pixel', () => {
      const buf = new PixelBuffer(4, 4);
      buf.setPixel(2, 3, RED);
      const pixel = buf.getPixel(2, 3);
      expect(pixel.r).toBe(255);
      expect(pixel.g).toBe(0);
      expect(pixel.b).toBe(0);
      expect(pixel.a).toBeCloseTo(1);
    });

    it('handles alpha values', () => {
      const buf = new PixelBuffer(4, 4);
      buf.setPixel(0, 0, SEMI_BLUE);
      const pixel = buf.getPixel(0, 0);
      expect(pixel.b).toBe(255);
      expect(pixel.a).toBeCloseTo(0.5, 1);
    });

    it('initializes to transparent black', () => {
      const buf = new PixelBuffer(4, 4);
      const pixel = buf.getPixel(0, 0);
      expect(pixel).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });
  });

  describe('out-of-bounds', () => {
    it('getPixel returns transparent black for out-of-bounds', () => {
      const buf = new PixelBuffer(4, 4);
      buf.fill(RED);
      expect(buf.getPixel(-1, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
      expect(buf.getPixel(4, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
      expect(buf.getPixel(0, -1)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
      expect(buf.getPixel(0, 4)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });

    it('setPixel ignores out-of-bounds writes', () => {
      const buf = new PixelBuffer(4, 4);
      buf.setPixel(-1, 0, RED);
      buf.setPixel(4, 0, RED);
      // Should not throw and buffer remains all zeros
      expect(buf.getPixel(0, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });
  });

  describe('fill', () => {
    it('fills all pixels', () => {
      const buf = new PixelBuffer(3, 3);
      buf.fill(GREEN);
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          const pixel = buf.getPixel(x, y);
          expect(pixel.r).toBe(0);
          expect(pixel.g).toBe(255);
          expect(pixel.b).toBe(0);
          expect(pixel.a).toBeCloseTo(1);
        }
      }
    });
  });

  describe('clear', () => {
    it('resets all pixels to transparent black', () => {
      const buf = new PixelBuffer(3, 3);
      buf.fill(RED);
      buf.clear();
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          expect(buf.getPixel(x, y)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
        }
      }
    });
  });

  describe('clone', () => {
    it('creates an independent copy', () => {
      const buf = new PixelBuffer(4, 4);
      buf.fill(RED);
      const copy = buf.clone();

      // Verify copy has same data
      expect(copy.getPixel(0, 0).r).toBe(255);

      // Modify original, verify copy is independent
      buf.fill(GREEN);
      expect(copy.getPixel(0, 0).r).toBe(255);
      expect(copy.getPixel(0, 0).g).toBe(0);
    });

    it('preserves dimensions', () => {
      const buf = new PixelBuffer(10, 20);
      const copy = buf.clone();
      expect(copy.width).toBe(10);
      expect(copy.height).toBe(20);
    });
  });

  describe('fromImageData', () => {
    it('restores pixels from an ImageData-like object', () => {
      // Create a minimal ImageData-like object (ImageData is a browser API)
      const width = 4;
      const height = 4;
      const data = new Uint8ClampedArray(width * height * 4);
      // Set pixel at (1, 2) to red
      const offset = (2 * width + 1) * 4;
      data[offset] = 255;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 255;
      const imageData = { width, height, data, colorSpace: 'srgb' as const };

      const restored = PixelBuffer.fromImageData(imageData as ImageData);
      const pixel = restored.getPixel(1, 2);
      expect(pixel.r).toBe(255);
      expect(pixel.g).toBe(0);
      expect(pixel.b).toBe(0);
      expect(pixel.a).toBeCloseTo(1);
      expect(restored.width).toBe(4);
      expect(restored.height).toBe(4);
    });
  });
});
