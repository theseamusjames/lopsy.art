import { describe, it, expect } from 'vitest';
import { rgbToHsl, hslToRgb, replaceColor, colorDistance, applyColorReplaceDab } from './color-replace';
import { PixelBuffer } from '../../engine/pixel-data';
import type { Color } from '../../types';

// ---------------------------------------------------------------------------
// rgbToHsl / hslToRgb round-trip
// ---------------------------------------------------------------------------

describe('rgbToHsl', () => {
  it('pure red is (0°, 1, 0.5)', () => {
    const { h, s, l } = rgbToHsl(255, 0, 0);
    expect(h).toBeCloseTo(0, 1);
    expect(s).toBeCloseTo(1, 2);
    expect(l).toBeCloseTo(0.5, 2);
  });

  it('pure green is (120°, 1, 0.5)', () => {
    const { h, s, l } = rgbToHsl(0, 255, 0);
    expect(h).toBeCloseTo(120, 1);
    expect(s).toBeCloseTo(1, 2);
    expect(l).toBeCloseTo(0.5, 2);
  });

  it('pure blue is (240°, 1, 0.5)', () => {
    const { h, s, l } = rgbToHsl(0, 0, 255);
    expect(h).toBeCloseTo(240, 1);
    expect(s).toBeCloseTo(1, 2);
    expect(l).toBeCloseTo(0.5, 2);
  });

  it('white is (0°, 0, 1)', () => {
    const { s, l } = rgbToHsl(255, 255, 255);
    expect(s).toBe(0);
    expect(l).toBeCloseTo(1, 2);
  });

  it('black is (0°, 0, 0)', () => {
    const { s, l } = rgbToHsl(0, 0, 0);
    expect(s).toBe(0);
    expect(l).toBe(0);
  });

  it('mid-grey is achromatic', () => {
    const { s, l } = rgbToHsl(128, 128, 128);
    expect(s).toBe(0);
    expect(l).toBeCloseTo(0.502, 1);
  });
});

describe('hslToRgb', () => {
  it('round-trips red', () => {
    const { r, g, b } = hslToRgb(0, 1, 0.5);
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it('round-trips white', () => {
    const { r, g, b } = hslToRgb(0, 0, 1);
    expect(r).toBe(255);
    expect(g).toBe(255);
    expect(b).toBe(255);
  });

  it('round-trips black', () => {
    const { r, g, b } = hslToRgb(0, 0, 0);
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// replaceColor — key behavioural requirements
// ---------------------------------------------------------------------------

describe('replaceColor', () => {
  it('red pixel + blue foreground → blue hue, same luminance', () => {
    // Red: (255, 0, 0) → L ≈ 0.5
    // Blue foreground: (0, 0, 255) → H = 240, S = 1
    // Expected output: hsl(240°, 1, 0.5) → pure blue
    const result = replaceColor(255, 0, 0, 0, 0, 255, 1);
    // Result hue should be ~240, luminance preserved at ~0.5
    const hsl = rgbToHsl(result.r, result.g, result.b);
    expect(hsl.h).toBeCloseTo(240, 0);
    expect(hsl.l).toBeCloseTo(0.5, 1);
  });

  it('white pixel stays white regardless of foreground — luminance preservation', () => {
    // White has L=1; replacing H/S keeps L=1 → output is still white.
    const result = replaceColor(255, 255, 255, 255, 0, 0, 1); // red foreground
    const hsl = rgbToHsl(result.r, result.g, result.b);
    expect(hsl.l).toBeCloseTo(1, 2);
    // All channels should be 255
    expect(result.r).toBe(255);
    expect(result.g).toBe(255);
    expect(result.b).toBe(255);
  });

  it('black pixel stays black — luminance preservation', () => {
    const result = replaceColor(0, 0, 0, 255, 165, 0, 1); // orange foreground
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
  });

  it('opacity=0 leaves the pixel unchanged', () => {
    const result = replaceColor(200, 50, 50, 0, 200, 0, 0);
    expect(result.r).toBe(200);
    expect(result.g).toBe(50);
    expect(result.b).toBe(50);
  });

  it('opacity=0.5 blends halfway between original and replaced', () => {
    // Use fully-red pixel, green foreground.
    const original = { r: 255, g: 0, b: 0 };
    const full = replaceColor(original.r, original.g, original.b, 0, 255, 0, 1);
    const half = replaceColor(original.r, original.g, original.b, 0, 255, 0, 0.5);
    // Each channel should be close to halfway. Allow ±1 for integer rounding.
    const expectedR = (original.r + full.r) / 2;
    const expectedG = (original.g + full.g) / 2;
    const expectedB = (original.b + full.b) / 2;
    expect(Math.abs(half.r - expectedR)).toBeLessThanOrEqual(1);
    expect(Math.abs(half.g - expectedG)).toBeLessThanOrEqual(1);
    expect(Math.abs(half.b - expectedB)).toBeLessThanOrEqual(1);
  });

  it('dark red + blue foreground → dark blue (luminance preserved)', () => {
    // dark red: rgb(100, 0, 0) → L ≈ 0.196
    const result = replaceColor(100, 0, 0, 0, 0, 255, 1);
    const hsl = rgbToHsl(result.r, result.g, result.b);
    expect(hsl.h).toBeCloseTo(240, 0);
    // Luminance should match original (≈0.196), not blue's (0.5)
    const origL = rgbToHsl(100, 0, 0).l;
    expect(hsl.l).toBeCloseTo(origL, 1);
  });
});

// ---------------------------------------------------------------------------
// colorDistance
// ---------------------------------------------------------------------------

describe('colorDistance', () => {
  it('identical colors have distance 0', () => {
    expect(colorDistance(100, 100, 100, 100, 100, 100)).toBe(0);
  });

  it('red vs blue: large distance', () => {
    const d = colorDistance(255, 0, 0, 0, 0, 255);
    expect(d).toBeGreaterThan(200);
  });

  it('very similar colors: small distance', () => {
    const d = colorDistance(200, 100, 100, 202, 98, 101);
    expect(d).toBeLessThan(5);
  });
});

// ---------------------------------------------------------------------------
// applyColorReplaceDab — integration over a PixelBuffer
// ---------------------------------------------------------------------------

function makeBuffer(width: number, height: number, fill: Color): PixelBuffer {
  const buf = new PixelBuffer(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      buf.setPixel(x, y, fill);
    }
  }
  return buf;
}

describe('applyColorReplaceDab', () => {
  it('replaces color inside the dab radius', () => {
    // Buffer full of red pixels.
    const buf = makeBuffer(40, 40, { r: 255, g: 0, b: 0, a: 1 });

    // Apply a blue dab at center (20, 20), large enough to cover it, no tolerance limit.
    applyColorReplaceDab(buf, 20, 20, 20, 0, 0, 255, 255, 0, 0, 255, 1);

    // Centre pixel should have shifted towards blue hue.
    const centre = buf.getPixel(20, 20);
    const hsl = rgbToHsl(centre.r, centre.g, centre.b);
    expect(hsl.h).toBeCloseTo(240, 0);
  });

  it('does not modify pixels outside the dab radius', () => {
    const buf = makeBuffer(40, 40, { r: 255, g: 0, b: 0, a: 1 });
    applyColorReplaceDab(buf, 20, 20, 10, 0, 0, 255, 255, 0, 0, 255, 1);

    // Corner pixel (0,0) is far outside radius=5 from center=(20,20).
    const corner = buf.getPixel(0, 0);
    expect(corner.r).toBe(255);
    expect(corner.g).toBe(0);
    expect(corner.b).toBe(0);
  });

  it('tolerance=0 blocks replacement when pixel differs from sampled color', () => {
    // Buffer is red. Sampled color is blue. With tolerance=0 the distance check
    // fails immediately, so no pixels should be changed.
    const buf = makeBuffer(20, 20, { r: 255, g: 0, b: 0, a: 1 });
    const before = buf.rawData.slice();

    applyColorReplaceDab(buf, 10, 10, 10, 0, 255, 0, 0, 0, 255, 0, 1);

    // Nothing should have changed.
    expect(buf.rawData).toEqual(before);
  });

  it('tolerance=255 allows any pixel to be replaced', () => {
    const buf = makeBuffer(20, 20, { r: 255, g: 0, b: 0, a: 1 });
    // Sampled color = blue, which is maximally different from red,
    // but tolerance=255 should still allow the replacement.
    applyColorReplaceDab(buf, 10, 10, 10, 0, 0, 255, 0, 0, 255, 255, 1);

    const centre = buf.getPixel(10, 10);
    const hsl = rgbToHsl(centre.r, centre.g, centre.b);
    expect(hsl.h).toBeCloseTo(240, 0);
  });

  it('preserves alpha channel', () => {
    const buf = makeBuffer(20, 20, { r: 255, g: 0, b: 0, a: 0.6 });
    applyColorReplaceDab(buf, 10, 10, 10, 0, 0, 255, 255, 0, 0, 255, 1);

    const centre = buf.getPixel(10, 10);
    expect(centre.a).toBeCloseTo(0.6, 1);
  });

  it('preserves luminance of painted pixels', () => {
    // Dark red (luminance ≈ 0.196), paint with full blue
    const buf = makeBuffer(20, 20, { r: 100, g: 0, b: 0, a: 1 });
    const origL = rgbToHsl(100, 0, 0).l;

    applyColorReplaceDab(buf, 10, 10, 10, 0, 0, 255, 100, 0, 0, 255, 1);

    const centre = buf.getPixel(10, 10);
    const resultL = rgbToHsl(centre.r, centre.g, centre.b).l;
    expect(resultL).toBeCloseTo(origL, 1);
  });

  it('white pixel stays white after replacement (luminance=1 is preserved)', () => {
    const buf = makeBuffer(20, 20, { r: 255, g: 255, b: 255, a: 1 });
    applyColorReplaceDab(buf, 10, 10, 10, 255, 0, 0, 255, 255, 255, 255, 1);

    const centre = buf.getPixel(10, 10);
    expect(centre.r).toBe(255);
    expect(centre.g).toBe(255);
    expect(centre.b).toBe(255);
  });

  it('transparent pixels are skipped', () => {
    const buf = new PixelBuffer(20, 20);
    // Leave all pixels transparent (default 0). Apply dab.
    applyColorReplaceDab(buf, 10, 10, 10, 255, 0, 0, 0, 0, 0, 255, 1);

    // All pixels should still be transparent.
    const centre = buf.getPixel(10, 10);
    expect(centre.a).toBe(0);
  });
});
