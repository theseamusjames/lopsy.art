import { describe, expect, it } from 'vitest';
import {
  balanceToExponent,
  blendingToMaskWidth,
  compileColorGrade,
  compileGradeWheel,
  hueToRgb,
  isIdentityColorGrade,
  type ColorGrade,
} from './color-grading';

const NEUTRAL = { hue: 0, saturation: 0, luminance: 0 };
const IDENTITY: ColorGrade = { shadows: NEUTRAL, midtones: NEUTRAL, highlights: NEUTRAL, global: NEUTRAL, blending: 50, balance: 0 };

describe('hueToRgb', () => {
  it('walks the colour wheel', () => {
    expect(hueToRgb(0)).toEqual([1, 0, 0]);
    expect(hueToRgb(120)).toEqual([0, 1, 0]);
    expect(hueToRgb(240)).toEqual([0, 0, 1]);
    expect(hueToRgb(-120)).toEqual([0, 0, 1]);
    expect(hueToRgb(60)).toEqual([1, 1, 0]);
  });
});

describe('compileGradeWheel', () => {
  it('is zero for a neutral wheel', () => {
    expect(compileGradeWheel(NEUTRAL).map((v) => Math.abs(v))).toEqual([0, 0, 0, 0]);
  });

  it('tints without changing luma, reaching 0.4 at full saturation', () => {
    const [r, g, b, l] = compileGradeWheel({ hue: 30, saturation: 100, luminance: -50 });
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeCloseTo(0, 6);
    expect(Math.max(Math.abs(r), Math.abs(g), Math.abs(b))).toBeCloseTo(0.4, 6);
    expect(l).toBeCloseTo(-0.25);
  });
});

describe('compileColorGrade', () => {
  it('packs four wheels, balance and blending into 18 floats', () => {
    const block = compileColorGrade({ ...IDENTITY, midtones: { hue: 200, saturation: 40, luminance: 10 }, balance: 50, blending: 100 });
    expect(block).toHaveLength(18);
    expect(block[7]).toBeCloseTo(0.05);
    expect(block[16]).toBeCloseTo(balanceToExponent(50));
    expect(block[16]).toBeCloseTo(0.5);
    expect(block[17]).toBeCloseTo(blendingToMaskWidth(100));
    expect(block[17]).toBeCloseTo(1 / 3);
  });

  it('knows a neutral grade', () => {
    expect(isIdentityColorGrade(IDENTITY)).toBe(true);
    expect(isIdentityColorGrade({ ...IDENTITY, global: { hue: 10, saturation: 0, luminance: 5 } })).toBe(false);
  });
});
