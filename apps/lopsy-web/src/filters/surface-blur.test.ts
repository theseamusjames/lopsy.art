import { describe, it, expect } from 'vitest';

/**
 * CPU-side reference implementation of the surface blur algorithm.
 * Mirrors the GLSL shader logic for unit testing without a GPU.
 */
function getPixel(pixels: Uint8ClampedArray, idx: number): number {
  return pixels[idx] ?? 0;
}

function applySurfaceBlurCpu(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  threshold: number,
): Uint8ClampedArray {
  const thresholdNorm = threshold / 255;
  const out = new Uint8ClampedArray(pixels.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ci = (y * width + x) * 4;
      const cr = getPixel(pixels, ci) / 255;
      const cg = getPixel(pixels, ci + 1) / 255;
      const cb = getPixel(pixels, ci + 2) / 255;

      let sumR = 0, sumG = 0, sumB = 0, totalWeight = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

          const ni = (ny * width + nx) * 4;
          const nr = getPixel(pixels, ni) / 255;
          const ng = getPixel(pixels, ni + 1) / 255;
          const nb = getPixel(pixels, ni + 2) / 255;

          const colorDist = Math.sqrt((nr - cr) ** 2 + (ng - cg) ** 2 + (nb - cb) ** 2);

          const spatialDist = Math.sqrt(dx * dx + dy * dy);
          const spatialWeight = Math.max(0, 1 - spatialDist / (radius + 1));

          // smoothstep: 0 below low, 1 above high, smooth in between
          const low = thresholdNorm * 0.95;
          const high = thresholdNorm;
          let t = (colorDist - low) / (high - low);
          t = Math.min(1, Math.max(0, t));
          const rangeWeight = 1 - t * t * (3 - 2 * t);

          const weight = spatialWeight * rangeWeight;
          sumR += nr * weight;
          sumG += ng * weight;
          sumB += nb * weight;
          totalWeight += weight;
        }
      }

      if (totalWeight > 0) {
        out[ci]     = Math.round((sumR / totalWeight) * 255);
        out[ci + 1] = Math.round((sumG / totalWeight) * 255);
        out[ci + 2] = Math.round((sumB / totalWeight) * 255);
      } else {
        out[ci]     = getPixel(pixels, ci);
        out[ci + 1] = getPixel(pixels, ci + 1);
        out[ci + 2] = getPixel(pixels, ci + 2);
      }
      out[ci + 3] = getPixel(pixels, ci + 3);
    }
  }

  return out;
}

describe('surface blur — CPU reference algorithm', () => {
  it('leaves a uniform color region unchanged', () => {
    const width = 10;
    const height = 10;
    const pixels = new Uint8ClampedArray(width * height * 4);
    // Fill with solid red
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4]     = 200;
      pixels[i * 4 + 1] = 50;
      pixels[i * 4 + 2] = 50;
      pixels[i * 4 + 3] = 255;
    }

    const result = applySurfaceBlurCpu(pixels, width, height, 3, 15);

    for (let i = 0; i < width * height; i++) {
      // Each pixel in a flat region should remain close to the original
      expect(result[i * 4]).toBeCloseTo(200, -1);
      expect(result[i * 4 + 1]).toBeCloseTo(50, -1);
      expect(result[i * 4 + 2]).toBeCloseTo(50, -1);
      expect(result[i * 4 + 3]).toBe(255);
    }
  });

  it('preserves a hard edge between two flat color regions', () => {
    // 20×1 image: left 10 pixels = black, right 10 pixels = white
    const width = 20;
    const height = 1;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let x = 0; x < width; x++) {
      const v = x < 10 ? 0 : 255;
      pixels[x * 4]     = v;
      pixels[x * 4 + 1] = v;
      pixels[x * 4 + 2] = v;
      pixels[x * 4 + 3] = 255;
    }

    // Threshold of 30/255 ≈ 0.118 — color distance at the edge is ~1.73 (max),
    // so neighbors across the edge are excluded. The edge pixel takes only
    // same-side neighbors, staying close to their original value.
    const result = applySurfaceBlurCpu(pixels, width, height, 3, 30);

    // Left-side pixels should remain dark (< 50)
    for (let x = 0; x < 8; x++) {
      expect(result[x * 4]).toBeLessThan(50);
    }
    // Right-side pixels should remain bright (> 200)
    for (let x = 12; x < 20; x++) {
      expect(result[x * 4]).toBeGreaterThan(200);
    }
  });

  it('blurs within a uniform region when threshold is high', () => {
    // 20x1 gradient from 100 to 120 (small variation, well within threshold)
    const width = 20;
    const height = 1;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let x = 0; x < width; x++) {
      const v = 100 + x;
      pixels[x * 4]     = v;
      pixels[x * 4 + 1] = v;
      pixels[x * 4 + 2] = v;
      pixels[x * 4 + 3] = 255;
    }

    const result = applySurfaceBlurCpu(pixels, width, height, 3, 128);

    // With high threshold, all neighbors within radius are included.
    // The interior pixels should have reduced gradient variation.
    const originalRange = getPixel(pixels, (width - 1) * 4) - getPixel(pixels, 0);
    const resultRange = getPixel(result, (width - 1) * 4) - getPixel(result, 0);
    // Blurred range should be smaller than original (endpoints pulled toward center)
    expect(resultRange).toBeLessThan(originalRange);
  });

  it('preserves alpha channel', () => {
    const width = 4;
    const height = 4;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4]     = 128;
      pixels[i * 4 + 1] = 128;
      pixels[i * 4 + 2] = 128;
      pixels[i * 4 + 3] = 200; // non-full alpha
    }

    const result = applySurfaceBlurCpu(pixels, width, height, 1, 20);

    for (let i = 0; i < width * height; i++) {
      expect(result[i * 4 + 3]).toBe(200);
    }
  });
});
