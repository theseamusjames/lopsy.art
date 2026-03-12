import { describe, it, expect } from 'vitest';
import type { Color } from '../../types';
import { colorDistance, floodFill, applyFill, defaultFillSettings } from './fill';
import type { PixelSurface } from './fill';

function createMockSurface(
  w: number,
  h: number,
  fillColor: Color,
): PixelSurface & { data: Color[][] } {
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

describe('defaultFillSettings', () => {
  it('returns valid defaults', () => {
    const s = defaultFillSettings();
    expect(s.tolerance).toBe(32);
    expect(s.contiguous).toBe(true);
  });
});

describe('colorDistance', () => {
  it('same color is 0', () => {
    const c: Color = { r: 128, g: 64, b: 32, a: 1 };
    expect(colorDistance(c, c)).toBe(0);
  });

  it('black to white is > 0', () => {
    expect(
      colorDistance({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }),
    ).toBeGreaterThan(0);
  });
});

describe('floodFill', () => {
  it('fills uniform surface completely (contiguous)', () => {
    const white: Color = { r: 255, g: 255, b: 255, a: 1 };
    const red: Color = { r: 255, g: 0, b: 0, a: 1 };
    const surface = createMockSurface(4, 4, white);
    const pixels = floodFill(surface, 0, 0, red, 0, true);
    expect(pixels.length).toBe(16);
  });

  it('stops at color boundary', () => {
    const white: Color = { r: 255, g: 255, b: 255, a: 1 };
    const black: Color = { r: 0, g: 0, b: 0, a: 1 };
    const red: Color = { r: 255, g: 0, b: 0, a: 1 };
    const surface = createMockSurface(4, 4, white);

    // Draw a black wall at column 2
    for (let y = 0; y < 4; y++) {
      surface.data[y]![2] = { ...black };
    }

    const pixels = floodFill(surface, 0, 0, red, 0, true);
    // Should only fill left side (columns 0-1, 4 rows = 8 pixels)
    expect(pixels.length).toBe(8);
  });

  it('non-contiguous fills all matching pixels', () => {
    const white: Color = { r: 255, g: 255, b: 255, a: 1 };
    const black: Color = { r: 0, g: 0, b: 0, a: 1 };
    const red: Color = { r: 255, g: 0, b: 0, a: 1 };
    const surface = createMockSurface(4, 4, white);

    // Put black pixel in the middle
    surface.data[2]![2] = { ...black };

    const pixels = floodFill(surface, 0, 0, red, 0, false);
    // All white pixels = 15 (16 - 1 black)
    expect(pixels.length).toBe(15);
  });

  it('tolerance=0 only fills exact matches', () => {
    const surface = createMockSurface(3, 3, { r: 100, g: 100, b: 100, a: 1 });
    surface.data[1]![1] = { r: 101, g: 100, b: 100, a: 1 };
    const pixels = floodFill(surface, 0, 0, { r: 0, g: 0, b: 0, a: 1 }, 0, true);
    // The slightly different pixel blocks flood fill
    expect(pixels.length).toBeLessThan(9);
  });
});

describe('applyFill', () => {
  it('sets pixels to fill color', () => {
    const surface = createMockSurface(4, 4, { r: 0, g: 0, b: 0, a: 1 });
    const red: Color = { r: 255, g: 0, b: 0, a: 1 };
    applyFill(surface, [{ x: 0, y: 0 }, { x: 1, y: 1 }], red);
    expect(surface.getPixel(0, 0)).toEqual(red);
    expect(surface.getPixel(1, 1)).toEqual(red);
  });
});
