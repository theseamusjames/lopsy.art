import { describe, it, expect } from 'vitest';

/**
 * CPU reference implementation of the emboss algorithm.
 * Mirrors the GLSL in engine-rs/…/shaders/filters/emboss.glsl.
 *
 * Kernel (at angle 0):
 *  -2  -1   0
 *  -1   1   1
 *   0   1   2
 *
 * The neighbours' (dx, dy) offsets are rotated by `angleDeg`, the sum is
 * multiplied by amount * 0.1, then 0.5 is added as a bias.
 */
function applyEmbossPixel(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  angleDeg: number,
  amount: number,
): number {
  const toLinear = (v: number) => v / 255;
  const lum = (r: number, g: number, b: number) => r * 0.299 + g * 0.587 + b * 0.114;

  const cosA = Math.cos((angleDeg * Math.PI) / 180);
  const sinA = Math.sin((angleDeg * Math.PI) / 180);

  // Kernel weights row-major (tl, tc, tr, ml, mc, mr, bl, bc, br)
  // Sums to 0 so flat fields map to exactly the 0.5 bias.
  const k = [-2, -1, 0, -1, 0, 1, 0, 1, 2];
  // Base pixel offsets (dx, dy) for each of the 9 positions
  const baseOffsets: Array<[number, number]> = [
    [-1, -1], [0, -1], [1, -1],
    [-1,  0], [0,  0], [1,  0],
    [-1,  1], [0,  1], [1,  1],
  ];

  let value = 0;
  for (let i = 0; i < 9; i++) {
    const offset = baseOffsets[i];
    if (offset === undefined) continue;
    const bx = offset[0];
    const by = offset[1];
    const weight = k[i] ?? 0;
    const rdx = cosA * bx - sinA * by;
    const rdy = sinA * bx + cosA * by;
    const nx = Math.round(x + rdx);
    const ny = Math.round(y + rdy);
    const cx = Math.max(0, Math.min(width - 1, nx));
    const cy = Math.max(0, Math.min(height - 1, ny));
    const idx = (cy * width + cx) * 4;
    const r = toLinear(imageData[idx] ?? 0);
    const g = toLinear(imageData[idx + 1] ?? 0);
    const b = toLinear(imageData[idx + 2] ?? 0);
    value += lum(r, g, b) * weight;
  }

  value = value * (amount / 1.0) * 0.1 + 0.5;
  return Math.max(0, Math.min(1, value));
}

describe('emboss algorithm', () => {
  it('flat color produces mid-gray (0.5 bias)', () => {
    // A uniform gray field: every pixel is the same, so all kernel
    // responses cancel out — only the 0.5 bias remains.
    const width = 5;
    const height = 5;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = 128;
      data[i * 4 + 1] = 128;
      data[i * 4 + 2] = 128;
      data[i * 4 + 3] = 255;
    }

    // Sample the centre pixel — should be very close to 0.5
    const result = applyEmbossPixel(data, width, height, 2, 2, 0, 3);
    expect(result).toBeCloseTo(0.5, 2);
  });

  it('flat black produces mid-gray', () => {
    const width = 5;
    const height = 5;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      data[i * 4 + 3] = 255;
      // r, g, b default to 0
    }

    const result = applyEmbossPixel(data, width, height, 2, 2, 45, 5);
    expect(result).toBeCloseTo(0.5, 2);
  });

  it('flat white produces mid-gray', () => {
    const width = 5;
    const height = 5;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = 255;
      data[i * 4 + 1] = 255;
      data[i * 4 + 2] = 255;
      data[i * 4 + 3] = 255;
    }

    const result = applyEmbossPixel(data, width, height, 2, 2, 180, 7);
    expect(result).toBeCloseTo(0.5, 2);
  });

  it('sharp edge (white → black transition) produces a value away from 0.5', () => {
    // Left half white, right half black — a vertical edge at x=3.
    // The emboss kernel at 0° highlights horizontal gradients, so a
    // pixel right on the edge should depart significantly from 0.5.
    const width = 7;
    const height = 7;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const v = col < 3 ? 255 : 0;
        const idx = (row * width + col) * 4;
        data[idx] = v;
        data[idx + 1] = v;
        data[idx + 2] = v;
        data[idx + 3] = 255;
      }
    }

    // Sample the pixel at the edge (x=3, y=3) — should NOT be ~0.5
    const result = applyEmbossPixel(data, width, height, 3, 3, 0, 5);
    expect(Math.abs(result - 0.5)).toBeGreaterThan(0.1);
  });

  it('higher amount produces stronger deviation from mid-gray on an edge', () => {
    const width = 7;
    const height = 7;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const v = col < 3 ? 255 : 0;
        const idx = (row * width + col) * 4;
        data[idx] = v;
        data[idx + 1] = v;
        data[idx + 2] = v;
        data[idx + 3] = 255;
      }
    }

    const low = applyEmbossPixel(data, width, height, 3, 3, 0, 1);
    const high = applyEmbossPixel(data, width, height, 3, 3, 0, 10);
    // Higher amount = larger departure from 0.5 (stronger effect)
    expect(Math.abs(high - 0.5)).toBeGreaterThan(Math.abs(low - 0.5));
  });

  it('result is always clamped to [0, 1]', () => {
    const width = 3;
    const height = 3;
    const data = new Uint8ClampedArray(width * height * 4);
    // Extreme gradient: top-left white, bottom-right black
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const v = (row + col) < 2 ? 255 : 0;
        const idx = (row * width + col) * 4;
        data[idx] = v;
        data[idx + 1] = v;
        data[idx + 2] = v;
        data[idx + 3] = 255;
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const result = applyEmbossPixel(data, width, height, x, y, 45, 10);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1);
      }
    }
  });
});
