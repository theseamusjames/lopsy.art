import { describe, it, expect } from 'vitest';
import type { Color } from '../../types';
import { applyEraserDab, defaultEraserSettings } from './eraser';
import type { PixelSurface } from './eraser';

function createMockSurface(w: number, h: number, fillColor: Color): PixelSurface & { data: Color[][] } {
  const data: Color[][] = [];
  for (let y = 0; y < h; y++) {
    data[y] = [];
    for (let x = 0; x < w; x++) {
      data[y]![x] = { ...fillColor };
    }
  }
  return {
    width: w,
    height: h,
    data,
    getPixel(x: number, y: number): Color {
      return data[y]?.[x] ?? { r: 0, g: 0, b: 0, a: 0 };
    },
    setPixel(x: number, y: number, color: Color): void {
      if (data[y]) data[y]![x] = color;
    },
  };
}

describe('defaultEraserSettings', () => {
  it('returns valid defaults', () => {
    const s = defaultEraserSettings();
    expect(s.size).toBeGreaterThan(0);
  });
});

describe('applyEraserDab', () => {
  it('reduces alpha of opaque pixel', () => {
    const surface = createMockSurface(10, 10, { r: 255, g: 0, b: 0, a: 1 });
    const stamp = new Float32Array([1]); // 1x1 stamp, full intensity
    applyEraserDab(surface, { x: 5, y: 5 }, stamp, 1, 0.5);

    const pixel = surface.getPixel(5, 5);
    expect(pixel.a).toBeCloseTo(0.5);
  });

  it('transparent pixel stays transparent', () => {
    const surface = createMockSurface(10, 10, { r: 0, g: 0, b: 0, a: 0 });
    const stamp = new Float32Array([1]);
    applyEraserDab(surface, { x: 5, y: 5 }, stamp, 1, 1);

    const pixel = surface.getPixel(5, 5);
    expect(pixel.a).toBe(0);
  });

  it('full opacity eraser makes pixel fully transparent', () => {
    const surface = createMockSurface(10, 10, { r: 128, g: 128, b: 128, a: 1 });
    const stamp = new Float32Array([1]);
    applyEraserDab(surface, { x: 3, y: 3 }, stamp, 1, 1);

    const pixel = surface.getPixel(3, 3);
    expect(pixel.a).toBe(0);
  });
});
