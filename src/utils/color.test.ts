import { describe, it, expect } from 'vitest';
import {
  rgbToHsl,
  hslToRgb,
  rgbToHex,
  hexToRgb,
  rgbToHsv,
  hsvToRgb,
  colorToCSS,
  lerpColor,
  colorEquals,
  BLACK,
  WHITE,
  TRANSPARENT,
} from './color';

describe('rgbToHsl', () => {
  it('converts black', () => {
    const hsl = rgbToHsl(BLACK);
    expect(hsl.h).toBe(0);
    expect(hsl.s).toBe(0);
    expect(hsl.l).toBe(0);
    expect(hsl.a).toBe(1);
  });

  it('converts white', () => {
    const hsl = rgbToHsl(WHITE);
    expect(hsl.h).toBe(0);
    expect(hsl.s).toBe(0);
    expect(hsl.l).toBe(100);
  });

  it('converts pure red', () => {
    const hsl = rgbToHsl({ r: 255, g: 0, b: 0, a: 1 });
    expect(hsl.h).toBe(0);
    expect(hsl.s).toBe(100);
    expect(hsl.l).toBe(50);
  });

  it('converts pure green', () => {
    const hsl = rgbToHsl({ r: 0, g: 255, b: 0, a: 1 });
    expect(hsl.h).toBe(120);
    expect(hsl.s).toBe(100);
    expect(hsl.l).toBe(50);
  });

  it('converts pure blue', () => {
    const hsl = rgbToHsl({ r: 0, g: 0, b: 255, a: 1 });
    expect(hsl.h).toBe(240);
    expect(hsl.s).toBe(100);
    expect(hsl.l).toBe(50);
  });

  it('preserves alpha', () => {
    const hsl = rgbToHsl({ r: 255, g: 0, b: 0, a: 0.5 });
    expect(hsl.a).toBe(0.5);
  });
});

describe('hslToRgb', () => {
  it('converts achromatic (gray)', () => {
    const color = hslToRgb({ h: 0, s: 0, l: 50, a: 1 });
    expect(color.r).toBe(128);
    expect(color.g).toBe(128);
    expect(color.b).toBe(128);
  });

  it('converts pure red', () => {
    const color = hslToRgb({ h: 0, s: 100, l: 50, a: 1 });
    expect(color.r).toBe(255);
    expect(color.g).toBe(0);
    expect(color.b).toBe(0);
  });

  it('round-trips with rgbToHsl', () => {
    const original = { r: 100, g: 150, b: 200, a: 0.8 };
    const result = hslToRgb(rgbToHsl(original));
    expect(result.r).toBeCloseTo(original.r, 0);
    expect(result.g).toBeCloseTo(original.g, 0);
    expect(result.b).toBeCloseTo(original.b, 0);
    expect(result.a).toBe(original.a);
  });
});

describe('rgbToHex', () => {
  it('converts black', () => {
    expect(rgbToHex(BLACK)).toBe('#000000');
  });

  it('converts white', () => {
    expect(rgbToHex(WHITE)).toBe('#ffffff');
  });

  it('converts a color with full opacity', () => {
    expect(rgbToHex({ r: 255, g: 128, b: 0, a: 1 })).toBe('#ff8000');
  });

  it('includes alpha when not 1', () => {
    const hex = rgbToHex({ r: 255, g: 0, b: 0, a: 0.5 });
    expect(hex).toBe('#ff000080');
  });
});

describe('hexToRgb', () => {
  it('parses 6-digit hex', () => {
    const color = hexToRgb('#ff8000');
    expect(color).toEqual({ r: 255, g: 128, b: 0, a: 1 });
  });

  it('parses 3-digit hex', () => {
    const color = hexToRgb('#f00');
    expect(color).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('parses 8-digit hex with alpha', () => {
    const color = hexToRgb('#ff000080');
    expect(color).not.toBeNull();
    expect(color!.r).toBe(255);
    expect(color!.g).toBe(0);
    expect(color!.b).toBe(0);
    expect(color!.a).toBeCloseTo(0.502, 2);
  });

  it('returns null for invalid hex', () => {
    expect(hexToRgb('#xyz')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull();
    expect(hexToRgb('')).toBeNull();
  });

  it('works without # prefix', () => {
    const color = hexToRgb('ff0000');
    expect(color).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('round-trips with rgbToHex', () => {
    const original = { r: 100, g: 200, b: 50, a: 1 };
    const result = hexToRgb(rgbToHex(original));
    expect(result).toEqual(original);
  });
});

describe('colorToCSS', () => {
  it('formats rgba string', () => {
    expect(colorToCSS({ r: 255, g: 128, b: 0, a: 0.5 })).toBe(
      'rgba(255,128,0,0.5)'
    );
  });

  it('formats opaque color', () => {
    expect(colorToCSS(BLACK)).toBe('rgba(0,0,0,1)');
  });
});

describe('lerpColor', () => {
  it('returns start color at t=0', () => {
    const result = lerpColor(BLACK, WHITE, 0);
    expect(result).toEqual(BLACK);
  });

  it('returns end color at t=1', () => {
    const result = lerpColor(BLACK, WHITE, 1);
    expect(result).toEqual(WHITE);
  });

  it('interpolates at midpoint', () => {
    const result = lerpColor(BLACK, WHITE, 0.5);
    expect(result.r).toBe(128);
    expect(result.g).toBe(128);
    expect(result.b).toBe(128);
  });

  it('clamps t to [0, 1]', () => {
    const below = lerpColor(BLACK, WHITE, -1);
    expect(below).toEqual(BLACK);
    const above = lerpColor(BLACK, WHITE, 2);
    expect(above).toEqual(WHITE);
  });

  it('interpolates alpha', () => {
    const result = lerpColor(TRANSPARENT, WHITE, 0.5);
    expect(result.a).toBeCloseTo(0.5);
  });
});

describe('colorEquals', () => {
  it('returns true for identical colors', () => {
    expect(colorEquals(BLACK, { r: 0, g: 0, b: 0, a: 1 })).toBe(true);
  });

  it('returns false for different colors', () => {
    expect(colorEquals(BLACK, WHITE)).toBe(false);
  });

  it('detects alpha difference', () => {
    expect(
      colorEquals({ r: 0, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 0, a: 0.5 })
    ).toBe(false);
  });
});

describe('rgbToHsv', () => {
  it('converts red', () => {
    const hsv = rgbToHsv({ r: 255, g: 0, b: 0, a: 1 });
    expect(hsv.h).toBe(0);
    expect(hsv.s).toBe(100);
    expect(hsv.v).toBe(100);
  });

  it('converts black', () => {
    const hsv = rgbToHsv({ r: 0, g: 0, b: 0, a: 1 });
    expect(hsv.s).toBe(0);
    expect(hsv.v).toBe(0);
  });

  it('converts white', () => {
    const hsv = rgbToHsv({ r: 255, g: 255, b: 255, a: 1 });
    expect(hsv.s).toBe(0);
    expect(hsv.v).toBe(100);
  });

  it('converts mid-gray', () => {
    const hsv = rgbToHsv({ r: 128, g: 128, b: 128, a: 1 });
    expect(hsv.s).toBe(0);
    expect(hsv.v).toBeCloseTo(50.2, 0);
  });
});

describe('hsvToRgb', () => {
  it('converts pure red', () => {
    const rgb = hsvToRgb({ h: 0, s: 100, v: 100 });
    expect(rgb).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('converts pure green', () => {
    const rgb = hsvToRgb({ h: 120, s: 100, v: 100 });
    expect(rgb).toEqual({ r: 0, g: 255, b: 0, a: 1 });
  });

  it('converts pure blue', () => {
    const rgb = hsvToRgb({ h: 240, s: 100, v: 100 });
    expect(rgb).toEqual({ r: 0, g: 0, b: 255, a: 1 });
  });

  it('roundtrips with rgbToHsv', () => {
    const original = { r: 100, g: 150, b: 200, a: 1 };
    const hsv = rgbToHsv(original);
    const rgb = hsvToRgb(hsv);
    expect(rgb.r).toBeCloseTo(original.r, 0);
    expect(rgb.g).toBeCloseTo(original.g, 0);
    expect(rgb.b).toBeCloseTo(original.b, 0);
  });
});

describe('constants', () => {
  it('BLACK is correct', () => {
    expect(BLACK).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('WHITE is correct', () => {
    expect(WHITE).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it('TRANSPARENT is correct', () => {
    expect(TRANSPARENT).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});
