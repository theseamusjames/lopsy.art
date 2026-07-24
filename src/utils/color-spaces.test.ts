import { describe, it, expect } from 'vitest';
import { rgbToLab, labToRgb, labToEncodedBytes, rgbToCmyk, cmykToRgb } from './color-spaces';
import type { Color } from '../types/color';

const opaque = (r: number, g: number, b: number): Color => ({ r, g, b, a: 1 });

describe('rgbToLab', () => {
  it('maps white to L=100 with no chroma', () => {
    const lab = rgbToLab(opaque(255, 255, 255));
    expect(Math.abs(lab.l - 100)).toBeLessThan(1);
    expect(Math.abs(lab.a)).toBeLessThan(1.5);
    expect(Math.abs(lab.b)).toBeLessThan(1.5);
  });

  it('maps black to L=0', () => {
    const lab = rgbToLab(opaque(0, 0, 0));
    expect(Math.abs(lab.l)).toBeLessThan(1);
  });

  it('keeps neutral grays free of chroma', () => {
    for (const v of [32, 128, 200]) {
      const lab = rgbToLab(opaque(v, v, v));
      expect(Math.abs(lab.a)).toBeLessThan(1.5);
      expect(Math.abs(lab.b)).toBeLessThan(1.5);
    }
  });

  it('puts pure red in the expected neighbourhood (matches lab.rs)', () => {
    const lab = rgbToLab(opaque(255, 0, 0));
    expect(Math.abs(lab.l - 54)).toBeLessThan(6);
    expect(lab.a).toBeGreaterThan(50);
    expect(lab.b).toBeGreaterThan(30);
  });
});

describe('lab round trip', () => {
  it('returns the original sRGB within 2 units across a sweep', () => {
    for (let r = 0; r <= 255; r += 51) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          const back = labToRgb(rgbToLab(opaque(r, g, b)));
          expect(Math.abs(back.r - r)).toBeLessThanOrEqual(2);
          expect(Math.abs(back.g - g)).toBeLessThanOrEqual(2);
          expect(Math.abs(back.b - b)).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it('preserves the alpha it was handed', () => {
    expect(labToRgb(rgbToLab(opaque(10, 20, 30)), 0.4).a).toBe(0.4);
  });
});

describe('labToEncodedBytes', () => {
  it('uses the engine encoding: L*2.55 and a/b offset by 128', () => {
    expect(labToEncodedBytes({ l: 100, a: 0, b: 0 })).toEqual({ r: 255, g: 128, b: 128 });
    expect(labToEncodedBytes({ l: 0, a: -128, b: 127 })).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('clamps rather than wrapping out-of-range input', () => {
    expect(labToEncodedBytes({ l: 150, a: 400, b: -400 })).toEqual({ r: 255, g: 255, b: 0 });
  });
});

describe('cmyk', () => {
  it('maps the primaries the way the ink model does', () => {
    expect(rgbToCmyk(opaque(255, 255, 255))).toMatchObject({ c: 0, m: 0, y: 0, k: 0 });
    expect(rgbToCmyk(opaque(0, 0, 0)).k).toBe(100);
    const red = rgbToCmyk(opaque(255, 0, 0));
    expect(red.c).toBe(0);
    expect(red.m).toBe(100);
    expect(red.y).toBe(100);
    expect(red.k).toBe(0);
  });

  it('round-trips sRGB within 2 units across a sweep', () => {
    for (let r = 0; r <= 255; r += 51) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          const back = cmykToRgb(rgbToCmyk(opaque(r, g, b)));
          expect(Math.abs(back.r - r)).toBeLessThanOrEqual(2);
          expect(Math.abs(back.g - g)).toBeLessThanOrEqual(2);
          expect(Math.abs(back.b - b)).toBeLessThanOrEqual(2);
        }
      }
    }
  });
});
