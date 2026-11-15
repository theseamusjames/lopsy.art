import { describe, it, expect } from 'vitest';
import {
  IDENTITY_COLOR_GRADE,
  balanceToExponent,
  blendingToMaskWidth,
  compileColorGrade,
  compileGradeWheel,
  isIdentityColorGrade,
} from './color-grading';

const luma = (t: readonly number[]): number =>
  (t[0] ?? 0) * 0.2126 + (t[1] ?? 0) * 0.7152 + (t[2] ?? 0) * 0.0722;

describe('isIdentityColorGrade', () => {
  it('is true for the identity grade', () => {
    expect(isIdentityColorGrade(IDENTITY_COLOR_GRADE)).toBe(true);
  });

  it('ignores hue, blending and balance while every wheel is neutral', () => {
    expect(isIdentityColorGrade({
      ...IDENTITY_COLOR_GRADE,
      midtones: { hue: 200, saturation: 0, luminance: 0 },
      blending: 10,
      balance: 80,
    })).toBe(true);
  });

  it.each(['shadows', 'midtones', 'highlights', 'global'] as const)('is false when %s has saturation', (range) => {
    expect(isIdentityColorGrade({
      ...IDENTITY_COLOR_GRADE,
      [range]: { hue: 0, saturation: 1, luminance: 0 },
    })).toBe(false);
  });

  it.each(['shadows', 'midtones', 'highlights', 'global'] as const)('is false when %s has luminance', (range) => {
    expect(isIdentityColorGrade({
      ...IDENTITY_COLOR_GRADE,
      [range]: { hue: 0, saturation: 0, luminance: -1 },
    })).toBe(false);
  });
});

describe('compileGradeWheel', () => {
  it('is all zeros for a neutral wheel', () => {
    for (const offset of compileGradeWheel({ hue: 123, saturation: 0, luminance: 0 })) {
      expect(offset).toBeCloseTo(0);
    }
  });

  it.each([0, 30, 60, 120, 180, 210, 240, 300])('keeps luma at zero for hue %i', (hue) => {
    const offsets = compileGradeWheel({ hue, saturation: 100, luminance: 0 });
    expect(luma(offsets)).toBeCloseTo(0, 2);
  });

  it.each([0, 30, 60, 120, 180, 240, 300])('reaches the same largest shift for hue %i', (hue) => {
    const [r, g, b] = compileGradeWheel({ hue, saturation: 100, luminance: 0 });
    expect(Math.max(Math.abs(r), Math.abs(g), Math.abs(b))).toBeCloseTo(0.4, 5);
  });

  it('pushes toward the hue and away from its complement', () => {
    const [r, g, b] = compileGradeWheel({ hue: 30, saturation: 100, luminance: 0 });
    expect(r).toBeGreaterThan(0);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(b).toBeLessThan(0);
  });

  it('scales linearly with saturation', () => {
    const full = compileGradeWheel({ hue: 200, saturation: 100, luminance: 0 });
    const quarter = compileGradeWheel({ hue: 200, saturation: 25, luminance: 0 });
    expect(quarter[0]).toBeCloseTo(full[0] / 4, 6);
    expect(quarter[2]).toBeCloseTo(full[2] / 4, 6);
  });

  it('treats 360 as 0', () => {
    expect(compileGradeWheel({ hue: 360, saturation: 50, luminance: 0 }))
      .toEqual(compileGradeWheel({ hue: 0, saturation: 50, luminance: 0 }));
  });

  it('maps luminance to a signed offset independent of the tint', () => {
    expect(compileGradeWheel({ hue: 0, saturation: 0, luminance: 100 })[3]).toBeCloseTo(0.5);
    expect(compileGradeWheel({ hue: 90, saturation: 70, luminance: -50 })[3]).toBeCloseTo(-0.25);
  });
});

describe('balanceToExponent', () => {
  it('leaves luma alone at 0', () => {
    expect(balanceToExponent(0)).toBe(1);
  });

  it('lifts luma for positive balance, widening highlights', () => {
    expect(balanceToExponent(100)).toBeCloseTo(0.25);
    expect(Math.pow(0.5, balanceToExponent(100))).toBeGreaterThan(0.5);
  });

  it('lowers luma for negative balance, widening shadows', () => {
    expect(balanceToExponent(-100)).toBeCloseTo(4);
    expect(Math.pow(0.5, balanceToExponent(-100))).toBeLessThan(0.5);
  });
});

describe('blendingToMaskWidth', () => {
  it('never reaches zero, which would make smoothstep undefined', () => {
    expect(blendingToMaskWidth(0)).toBeGreaterThan(0);
  });

  it('stops at the widest crossover that still gives black and white full weight', () => {
    expect(blendingToMaskWidth(100)).toBeCloseTo(1 / 3);
  });

  it('grows with blending', () => {
    expect(blendingToMaskWidth(75)).toBeGreaterThan(blendingToMaskWidth(25));
  });
});

describe('compileColorGrade', () => {
  it('lays out shadows, midtones, highlights, global, exponent, width', () => {
    const block = compileColorGrade({
      shadows: { hue: 0, saturation: 0, luminance: 10 },
      midtones: { hue: 0, saturation: 0, luminance: 20 },
      highlights: { hue: 0, saturation: 0, luminance: 40 },
      global: { hue: 0, saturation: 0, luminance: 80 },
      blending: 100,
      balance: 50,
    });
    expect(block).toHaveLength(18);
    expect(block[3]).toBeCloseTo(0.05);
    expect(block[7]).toBeCloseTo(0.1);
    expect(block[11]).toBeCloseTo(0.2);
    expect(block[15]).toBeCloseTo(0.4);
    expect(block[16]).toBeCloseTo(0.5);
    expect(block[17]).toBeCloseTo(1 / 3);
  });
});
