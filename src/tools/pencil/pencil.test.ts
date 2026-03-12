import { describe, it, expect } from 'vitest';
import type { Color } from '../../types';
import { bresenhamLine, drawPencilLine, defaultPencilSettings } from './pencil';
import type { PixelSurface } from './pencil';

function createMockSurface(w: number, h: number): PixelSurface & { pixels: Map<string, Color> } {
  const pixels = new Map<string, Color>();
  return {
    width: w,
    height: h,
    pixels,
    getPixel(x: number, y: number): Color {
      return pixels.get(`${x},${y}`) ?? { r: 0, g: 0, b: 0, a: 0 };
    },
    setPixel(x: number, y: number, color: Color): void {
      pixels.set(`${x},${y}`, color);
    },
  };
}

describe('defaultPencilSettings', () => {
  it('returns size 1', () => {
    expect(defaultPencilSettings().size).toBe(1);
  });
});

describe('bresenhamLine', () => {
  it('horizontal line', () => {
    const points = bresenhamLine(0, 0, 4, 0);
    expect(points.length).toBe(5);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[4]).toEqual({ x: 4, y: 0 });
    for (const p of points) expect(p.y).toBe(0);
  });

  it('vertical line', () => {
    const points = bresenhamLine(0, 0, 0, 3);
    expect(points.length).toBe(4);
    for (const p of points) expect(p.x).toBe(0);
  });

  it('diagonal line', () => {
    const points = bresenhamLine(0, 0, 3, 3);
    expect(points.length).toBe(4);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[3]).toEqual({ x: 3, y: 3 });
  });

  it('single point', () => {
    const points = bresenhamLine(5, 5, 5, 5);
    expect(points.length).toBe(1);
    expect(points[0]).toEqual({ x: 5, y: 5 });
  });
});

describe('drawPencilLine', () => {
  it('modifies surface pixels', () => {
    const surface = createMockSurface(10, 10);
    const red: Color = { r: 255, g: 0, b: 0, a: 1 };
    drawPencilLine(surface, { x: 0, y: 0 }, { x: 3, y: 0 }, red, 1);
    expect(surface.pixels.size).toBeGreaterThan(0);
    expect(surface.getPixel(0, 0)).toEqual(red);
    expect(surface.getPixel(3, 0)).toEqual(red);
  });
});
