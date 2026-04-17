import { describe, it, expect } from 'vitest';
import {
  buildLevelsLut,
  buildLevelsLutRgba,
  isIdentityChannel,
  isIdentityLevels,
  IDENTITY_CHANNEL,
  IDENTITY_LEVELS,
} from './levels';

describe('isIdentityChannel', () => {
  it('returns true for identity', () => {
    expect(isIdentityChannel(IDENTITY_CHANNEL)).toBe(true);
  });

  it('returns false when gamma differs', () => {
    expect(isIdentityChannel({ ...IDENTITY_CHANNEL, gamma: 2 })).toBe(false);
  });

  it('returns false when inputWhite differs', () => {
    expect(isIdentityChannel({ ...IDENTITY_CHANNEL, inputWhite: 0.5 })).toBe(false);
  });
});

describe('isIdentityLevels', () => {
  it('returns true for identity levels', () => {
    expect(isIdentityLevels(IDENTITY_LEVELS)).toBe(true);
  });

  it('returns true for null/undefined', () => {
    expect(isIdentityLevels(null)).toBe(true);
    expect(isIdentityLevels(undefined)).toBe(true);
  });

  it('returns false when one channel differs', () => {
    expect(isIdentityLevels({ ...IDENTITY_LEVELS, r: { ...IDENTITY_CHANNEL, gamma: 2 } })).toBe(false);
  });
});

describe('buildLevelsLut', () => {
  it('returns identity LUT when channel is identity', () => {
    const lut = buildLevelsLut(IDENTITY_CHANNEL);
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBe(i);
    }
  });

  it('clips inputBlack', () => {
    const ch = { ...IDENTITY_CHANNEL, inputBlack: 0.1 }; // 10% = ~26
    const lut = buildLevelsLut(ch);
    for (let i = 0; i < Math.round(26); i++) {
      expect(lut[i]).toBe(0);
    }
  });

  it('clips inputWhite', () => {
    const ch = { ...IDENTITY_CHANNEL, inputWhite: 0.9 }; // 90% = ~230
    const lut = buildLevelsLut(ch);
    for (let i = Math.round(230); i < 256; i++) {
      expect(lut[i]).toBe(255);
    }
  });

  it('applies gamma remapping', () => {
    const ch = { ...IDENTITY_CHANNEL, gamma: 2 };
    const lut = buildLevelsLut(ch);
    // gamma > 1: sqrt(0.5) ≈ 0.707 → brightens midtones in the LUT
    // (the normalized value 0.5 is raised to 0.5 power)
    expect(lut[128]).toBeGreaterThan(128);
  });

  it('applies output scale to non-clipped values', () => {
    // outputBlack and outputWhite only affect values that survived input clipping
    const ch = { ...IDENTITY_CHANNEL, inputBlack: 0.1, inputWhite: 0.9, outputBlack: 0.05, outputWhite: 0.95 };
    const lut = buildLevelsLut(ch);
    // Values below inputBlack (0.1) are clipped to 0
    expect(lut[0]).toBe(0);
    // A midtone within the input range gets scaled: (0.5-0.1)/0.8 = 0.5 → output = 0.5*0.9 + 0.05 = 0.5
    // The output scale compresses the range but preserves midpoint
    expect(lut[Math.round(0.5 * 255)]).toBe(128);
  });
});

describe('buildLevelsLutRgba', () => {
  it('returns 256x4 bytes', () => {
    const out = buildLevelsLutRgba(IDENTITY_LEVELS);
    expect(out.length).toBe(256 * 4);
  });

  it('has identity values for all channels', () => {
    const out = buildLevelsLutRgba(IDENTITY_LEVELS);
    for (let i = 0; i < 256; i++) {
      expect(out[i * 4]).toBe(i);       // R
      expect(out[i * 4 + 1]).toBe(i);   // G
      expect(out[i * 4 + 2]).toBe(i);   // B
      expect(out[i * 4 + 3]).toBe(i);   // A (master)
    }
  });

  it('has different values per channel when channels differ', () => {
    const levels = {
      ...IDENTITY_LEVELS,
      r: { ...IDENTITY_CHANNEL, gamma: 2 },
      g: { ...IDENTITY_CHANNEL, gamma: 0.5 },
      b: IDENTITY_CHANNEL,
    };
    const out = buildLevelsLutRgba(levels);
    // At i=128, R and G should differ from B and master
    expect(out[128 * 4]).not.toBe(out[128 * 4 + 1]); // R !== G
    expect(out[128 * 4 + 2]).toBe(out[128 * 4 + 3]); // B === master
  });
});
