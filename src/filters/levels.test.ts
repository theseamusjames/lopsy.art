import { describe, it, expect } from 'vitest';
import {
  IDENTITY_LEVELS,
  IDENTITY_LEVELS_CHANNEL,
  applyLevelsToImageData,
  buildLevelsLUT,
  buildLevelsLutRgba,
  evaluateLevels,
  isIdentityLevels,
  isIdentityLevelsChannel,
  type LevelsChannel,
} from './levels';

describe('evaluateLevels', () => {
  it('identity channel is a pass-through', () => {
    for (const v of [0, 1, 64, 128, 200, 255]) {
      expect(evaluateLevels(IDENTITY_LEVELS_CHANNEL, v)).toBe(v);
    }
  });

  it('raising the input black point crushes shadows to 0', () => {
    const ch: LevelsChannel = { inBlack: 64, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
    expect(evaluateLevels(ch, 0)).toBe(0);
    expect(evaluateLevels(ch, 64)).toBe(0);
    // 128 maps to (128-64)/(255-64) ≈ 0.335 → 85
    expect(evaluateLevels(ch, 128)).toBe(85);
    expect(evaluateLevels(ch, 255)).toBe(255);
  });

  it('lowering the input white point blows highlights to 255', () => {
    const ch: LevelsChannel = { inBlack: 0, inWhite: 192, gamma: 1, outBlack: 0, outWhite: 255 };
    expect(evaluateLevels(ch, 0)).toBe(0);
    // 96 maps to 96/192 = 0.5 → 128
    expect(evaluateLevels(ch, 96)).toBe(128);
    expect(evaluateLevels(ch, 192)).toBe(255);
    expect(evaluateLevels(ch, 255)).toBe(255);
  });

  it('gamma 2.0 lifts midtones above the linear line', () => {
    const ch: LevelsChannel = { inBlack: 0, inWhite: 255, gamma: 2, outBlack: 0, outWhite: 255 };
    // 128/255 ≈ 0.5019 → pow(0.5019, 1/2) ≈ 0.7085 → ~181
    const result = evaluateLevels(ch, 128);
    expect(result).toBeGreaterThan(128);
    expect(result).toBeLessThan(200);
  });

  it('gamma 0.5 crushes midtones below the linear line', () => {
    const ch: LevelsChannel = { inBlack: 0, inWhite: 255, gamma: 0.5, outBlack: 0, outWhite: 255 };
    const result = evaluateLevels(ch, 128);
    expect(result).toBeLessThan(128);
    expect(result).toBeGreaterThan(30);
  });

  it('output range compresses into the target band', () => {
    const ch: LevelsChannel = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 50, outWhite: 200 };
    expect(evaluateLevels(ch, 0)).toBe(50);
    expect(evaluateLevels(ch, 255)).toBe(200);
    // midpoint lands at the center of the output band
    expect(evaluateLevels(ch, 128)).toBeGreaterThanOrEqual(124);
    expect(evaluateLevels(ch, 128)).toBeLessThanOrEqual(126);
  });

  it('inverted output range inverts the tones', () => {
    const ch: LevelsChannel = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 255, outWhite: 0 };
    expect(evaluateLevels(ch, 0)).toBe(255);
    expect(evaluateLevels(ch, 255)).toBe(0);
  });

  it('guards against degenerate inWhite <= inBlack', () => {
    const ch: LevelsChannel = { inBlack: 200, inWhite: 200, gamma: 1, outBlack: 0, outWhite: 255 };
    // Should not NaN/divide by zero. Should still produce something in [0,255].
    for (const v of [0, 100, 200, 255]) {
      const r = evaluateLevels(ch, v);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(255);
    }
  });
});

describe('isIdentityLevels', () => {
  it('true for null / undefined / defaults', () => {
    expect(isIdentityLevels(undefined)).toBe(true);
    expect(isIdentityLevels(null)).toBe(true);
    expect(isIdentityLevels(IDENTITY_LEVELS)).toBe(true);
  });

  it('false when any channel deviates', () => {
    expect(isIdentityLevels({ ...IDENTITY_LEVELS, r: { ...IDENTITY_LEVELS_CHANNEL, gamma: 2 } })).toBe(false);
    expect(isIdentityLevels({ ...IDENTITY_LEVELS, rgb: { ...IDENTITY_LEVELS_CHANNEL, inBlack: 10 } })).toBe(false);
  });

  it('isIdentityLevelsChannel responds to every field', () => {
    expect(isIdentityLevelsChannel({ ...IDENTITY_LEVELS_CHANNEL, inBlack: 1 })).toBe(false);
    expect(isIdentityLevelsChannel({ ...IDENTITY_LEVELS_CHANNEL, inWhite: 254 })).toBe(false);
    expect(isIdentityLevelsChannel({ ...IDENTITY_LEVELS_CHANNEL, gamma: 1.01 })).toBe(false);
    expect(isIdentityLevelsChannel({ ...IDENTITY_LEVELS_CHANNEL, outBlack: 1 })).toBe(false);
    expect(isIdentityLevelsChannel({ ...IDENTITY_LEVELS_CHANNEL, outWhite: 254 })).toBe(false);
  });
});

describe('buildLevelsLUT', () => {
  it('identity produces LUT[i] === i', () => {
    const lut = buildLevelsLUT(IDENTITY_LEVELS_CHANNEL);
    for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);
  });

  it('monotonic non-decreasing for typical inputs', () => {
    const lut = buildLevelsLUT({ inBlack: 30, inWhite: 220, gamma: 1.5, outBlack: 10, outWhite: 245 });
    for (let i = 1; i < 256; i++) {
      expect(lut[i]!).toBeGreaterThanOrEqual(lut[i - 1]!);
    }
  });
});

describe('buildLevelsLutRgba', () => {
  it('packs R/G/B/A in the expected order', () => {
    const r: LevelsChannel = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 128 };
    const g: LevelsChannel = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 200 };
    const b: LevelsChannel = IDENTITY_LEVELS_CHANNEL;
    const rgb: LevelsChannel = IDENTITY_LEVELS_CHANNEL;
    const packed = buildLevelsLutRgba({ r, g, b, rgb });
    expect(packed.length).toBe(256 * 4);
    // At input 255: R should be 128, G should be 200, B should be 255, A(master) should be 255
    expect(packed[255 * 4]).toBe(128);
    expect(packed[255 * 4 + 1]).toBe(200);
    expect(packed[255 * 4 + 2]).toBe(255);
    expect(packed[255 * 4 + 3]).toBe(255);
  });
});

describe('applyLevelsToImageData', () => {
  it('is a no-op for identity', () => {
    const data = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    applyLevelsToImageData(data, IDENTITY_LEVELS);
    expect(Array.from(data)).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it('master-only gamma lifts every channel', () => {
    const data = new Uint8ClampedArray([128, 128, 128, 255]);
    applyLevelsToImageData(data, {
      ...IDENTITY_LEVELS,
      rgb: { inBlack: 0, inWhite: 255, gamma: 2, outBlack: 0, outWhite: 255 },
    });
    expect(data[0]!).toBeGreaterThan(128);
    expect(data[1]!).toBeGreaterThan(128);
    expect(data[2]!).toBeGreaterThan(128);
    // Alpha unchanged.
    expect(data[3]).toBe(255);
  });

  it('per-channel remap only affects the targeted channel', () => {
    const data = new Uint8ClampedArray([200, 200, 50, 255]);
    applyLevelsToImageData(data, {
      ...IDENTITY_LEVELS,
      r: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 0 }, // crush red to 0
    });
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(200);
    expect(data[2]).toBe(50);
  });
});
