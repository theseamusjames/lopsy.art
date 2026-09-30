import { describe, it, expect } from 'vitest';
import type { Color } from '../../types';
import { sampleColor, defaultEyedropperSettings } from './eyedropper';
import type { PixelSurface } from './eyedropper';

function createMockSurface(w: number, h: number, fillColor: Color): PixelSurface {
  return {
    width: w,
    height: h,
    getPixel(_x: number, _y: number): Color {
      return fillColor;
    },
    setPixel(): void {},
  };
}

describe('defaultEyedropperSettings', () => {
  it('returns point sample size', () => {
    expect(defaultEyedropperSettings().sampleSize).toBe('point');
  });
});

describe('sampleColor', () => {
  it('point returns exact pixel', () => {
    const red: Color = { r: 255, g: 0, b: 0, a: 1 };
    const surface = createMockSurface(10, 10, red);
    expect(sampleColor(surface, 5, 5, 'point')).toEqual(red);
  });

  it('3x3 average of uniform surface returns that color', () => {
    const blue: Color = { r: 0, g: 0, b: 255, a: 1 };
    const surface = createMockSurface(10, 10, blue);
    const result = sampleColor(surface, 5, 5, '3x3');
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(255);
  });

  it('5x5 at edge handles out-of-bounds', () => {
    const green: Color = { r: 0, g: 128, b: 0, a: 1 };
    const surface = createMockSurface(10, 10, green);
    const result = sampleColor(surface, 0, 0, '5x5');
    // Should not crash and should average only valid pixels
    expect(result.g).toBe(128);
  });

  it('maps a point in the right/bottom half of a pixel to that pixel (#1036)', () => {
    const white: Color = { r: 255, g: 255, b: 255, a: 1 };
    const black: Color = { r: 0, g: 0, b: 0, a: 1 };
    const surface: PixelSurface = {
      width: 10,
      height: 10,
      getPixel: (x: number, y: number): Color => (x === 4 && y === 4 ? white : black),
      setPixel(): void {},
    };
    expect(sampleColor(surface, 4.8, 4.8, 'point')).toEqual(white);
    expect(sampleColor(surface, 4.1, 4.1, 'point')).toEqual(white);
    expect(sampleColor(surface, 5.0, 4.5, 'point')).toEqual(black);
  });

  it('out-of-bounds point returns transparent', () => {
    const surface = createMockSurface(10, 10, { r: 255, g: 255, b: 255, a: 1 });
    expect(sampleColor(surface, -1, -1, 'point')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});
