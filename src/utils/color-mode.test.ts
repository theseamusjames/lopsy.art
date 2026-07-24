import { describe, it, expect } from 'vitest';
import { colorModeLabel, convertColorToDocMode, toGrayscaleColor, luminance8 } from './color-mode';
import type { Color } from '../types/color';
import type { DocumentColorMode } from '../types/color-mode';

const ALL_MODES: DocumentColorMode[] = ['rgb', 'grayscale', 'indexed', 'lab', 'cmyk'];

describe('colorModeLabel', () => {
  it('gives a distinct human label for every mode', () => {
    const labels = ALL_MODES.map(colorModeLabel);
    expect(labels).toEqual(['RGB', 'Grayscale', 'Indexed', 'Lab', 'CMYK']);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('luminance8', () => {
  it('uses Rec. 709 weights on the stored 8-bit values', () => {
    // Matches the engine's grayscale bake and adjustments.glsl.
    expect(luminance8(255, 0, 0)).toBe(54); // 0.2126 * 255
    expect(luminance8(0, 255, 0)).toBe(182); // 0.7152 * 255
    expect(luminance8(0, 0, 255)).toBe(18); // 0.0722 * 255
  });

  it('leaves neutral values unchanged', () => {
    for (const v of [0, 64, 128, 255]) {
      expect(luminance8(v, v, v)).toBe(v);
    }
  });
});

describe('toGrayscaleColor', () => {
  it('collapses to R=G=B and preserves alpha', () => {
    const out = toGrayscaleColor({ r: 255, g: 0, b: 0, a: 0.5 });
    expect(out).toEqual({ r: 54, g: 54, b: 54, a: 0.5 });
  });

  it('is idempotent', () => {
    const once = toGrayscaleColor({ r: 200, g: 50, b: 10, a: 1 });
    expect(toGrayscaleColor(once)).toEqual(once);
  });
});

describe('convertColorToDocMode', () => {
  const color: Color = { r: 200, g: 50, b: 10, a: 1 };

  it('snaps to neutral gray in grayscale mode', () => {
    const out = convertColorToDocMode(color, 'grayscale');
    expect(out.r).toBe(out.g);
    expect(out.g).toBe(out.b);
    expect(out.r).toBe(luminance8(200, 50, 10));
  });

  it('is identity for modes whose value space still holds RGB', () => {
    for (const mode of ['rgb', 'indexed', 'lab', 'cmyk'] as DocumentColorMode[]) {
      expect(convertColorToDocMode(color, mode)).toEqual(color);
    }
  });
});
