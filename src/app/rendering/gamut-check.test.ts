import { describe, it, expect } from 'vitest';
import {
  isOutOfSrgbGamut,
  clampToSrgb,
  simulateCmyk,
  countOutOfGamutPixels,
  buildGamutWarningBuffer,
} from './gamut-check';

describe('isOutOfSrgbGamut', () => {
  it('returns false for any pixel when not wide gamut', () => {
    // Even extreme values — all displays are sRGB so nothing is out of gamut
    expect(isOutOfSrgbGamut(255, 255, 255, false)).toBe(false);
    expect(isOutOfSrgbGamut(240, 0, 0, false)).toBe(false);
  });

  it('returns false for mid-range sRGB-safe values in wide gamut mode', () => {
    expect(isOutOfSrgbGamut(200, 150, 100, true)).toBe(false);
    expect(isOutOfSrgbGamut(235, 235, 235, true)).toBe(false); // boundary is inclusive
  });

  it('returns true when any channel exceeds 235 in wide gamut mode', () => {
    expect(isOutOfSrgbGamut(236, 0, 0, true)).toBe(true);
    expect(isOutOfSrgbGamut(0, 236, 0, true)).toBe(true);
    expect(isOutOfSrgbGamut(0, 0, 236, true)).toBe(true);
    expect(isOutOfSrgbGamut(255, 255, 255, true)).toBe(true);
  });

  it('returns true only for the channel that exceeds the threshold', () => {
    // Green barely over threshold, others fine
    expect(isOutOfSrgbGamut(200, 236, 200, true)).toBe(true);
    // All below threshold
    expect(isOutOfSrgbGamut(200, 235, 200, true)).toBe(false);
  });
});

describe('clampToSrgb', () => {
  it('returns unchanged values when not wide gamut', () => {
    expect(clampToSrgb(240, 240, 240, false)).toEqual([240, 240, 240]);
  });

  it('clamps channels above 235 in wide gamut mode', () => {
    expect(clampToSrgb(255, 128, 10, true)).toEqual([235, 128, 10]);
    expect(clampToSrgb(10, 255, 10, true)).toEqual([10, 235, 10]);
  });

  it('leaves channels at or below 235 unchanged in wide gamut mode', () => {
    expect(clampToSrgb(235, 235, 235, true)).toEqual([235, 235, 235]);
    expect(clampToSrgb(0, 100, 200, true)).toEqual([0, 100, 200]);
  });
});

describe('simulateCmyk', () => {
  it('returns values in 0–255 range', () => {
    const cases: Array<[number, number, number]> = [
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [128, 64, 192],
    ];
    for (const [r, g, b] of cases) {
      const [ro, go, bo] = simulateCmyk(r, g, b);
      expect(ro).toBeGreaterThanOrEqual(0);
      expect(ro).toBeLessThanOrEqual(255);
      expect(go).toBeGreaterThanOrEqual(0);
      expect(go).toBeLessThanOrEqual(255);
      expect(bo).toBeGreaterThanOrEqual(0);
      expect(bo).toBeLessThanOrEqual(255);
    }
  });

  it('reduces saturation — output moves toward grey compared to input', () => {
    // A vivid red: after desaturation it should be less saturated (closer to grey)
    const [ro, go, bo] = simulateCmyk(255, 0, 0);
    const inputSat = Math.abs(255 - (255 + 0 + 0) / 3);
    const outputSat = Math.abs(ro - (ro + go + bo) / 3);
    expect(outputSat).toBeLessThan(inputSat);
  });

  it('reduces blue/green channels relative to red for cyan-dominant colours', () => {
    // Pure cyan — after CMYK sim, blue+green should be reduced relative to a plain desaturation
    const [, go, bo] = simulateCmyk(0, 200, 200);
    // Plain 15% desaturation would give ~0.85 * 200 + 0.15 * lum
    // CMYK sim should push G and B slightly lower than that
    const lum = 0.299 * 0 + 0.587 * 200 + 0.114 * 200;
    const plainDesat = lum + (200 - lum) * 0.85;
    expect(go).toBeLessThanOrEqual(Math.round(plainDesat));
    expect(bo).toBeLessThanOrEqual(Math.round(plainDesat));
  });

  it('is a no-op for achromatic colours (R=G=B)', () => {
    // Grey pixels should not shift after desaturation
    const [ro, go, bo] = simulateCmyk(128, 128, 128);
    expect(ro).toBe(128);
    expect(go).toBeCloseTo(128, 0);
    expect(bo).toBeCloseTo(128, 0);
  });
});

describe('countOutOfGamutPixels', () => {
  it('returns 0 when not wide gamut regardless of values', () => {
    const pixels = new Uint8Array([255, 255, 255, 255, 240, 0, 0, 255]);
    expect(countOutOfGamutPixels(pixels, false)).toBe(0);
  });

  it('counts only pixels with at least one channel > 235 in wide gamut mode', () => {
    // 3 pixels: one OOG, one boundary, one safe
    const pixels = new Uint8Array([
      236, 0, 0, 255,   // out of gamut (R=236 > 235)
      235, 235, 235, 255, // exactly at boundary — not out of gamut
      200, 200, 200, 255, // safe
    ]);
    expect(countOutOfGamutPixels(pixels, true)).toBe(1);
  });

  it('counts multiple out-of-gamut pixels', () => {
    const pixels = new Uint8Array([
      255, 0, 0, 255,   // OOG
      0, 255, 0, 255,   // OOG
      0, 0, 255, 255,   // OOG
    ]);
    expect(countOutOfGamutPixels(pixels, true)).toBe(3);
  });
});

describe('buildGamutWarningBuffer', () => {
  it('writes magenta for out-of-gamut pixels and transparent for safe pixels', () => {
    const pixels = new Uint8Array([
      236, 0, 0, 255,   // OOG
      200, 100, 50, 255, // safe
    ]);
    const out = new Uint8ClampedArray(8);
    buildGamutWarningBuffer(pixels, out, true);

    // OOG pixel → magenta
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(255);
    expect(out[3]).toBe(200);

    // Safe pixel → transparent
    expect(out[4]).toBe(0);
    expect(out[5]).toBe(0);
    expect(out[6]).toBe(0);
    expect(out[7]).toBe(0);
  });

  it('produces all-transparent output when not wide gamut', () => {
    const pixels = new Uint8Array([255, 255, 255, 255]);
    const out = new Uint8ClampedArray(4);
    buildGamutWarningBuffer(pixels, out, false);
    expect(out[3]).toBe(0);
  });
});
