import { describe, it, expect } from 'vitest';
import {
  isLossyFormat,
  normaliseQuality,
  qualityToFraction,
} from './export-logic';

describe('isLossyFormat', () => {
  it('returns true for jpeg and webp', () => {
    expect(isLossyFormat('jpeg')).toBe(true);
    expect(isLossyFormat('webp')).toBe(true);
  });

  it('returns false for png and bmp', () => {
    expect(isLossyFormat('png')).toBe(false);
    expect(isLossyFormat('bmp')).toBe(false);
  });
});

describe('normaliseQuality', () => {
  it('returns 100 for lossless formats regardless of input', () => {
    expect(normaliseQuality(50, 'png')).toBe(100);
    expect(normaliseQuality(1, 'bmp')).toBe(100);
  });

  it('clamps quality to 1–100 for lossy formats', () => {
    expect(normaliseQuality(80, 'jpeg')).toBe(80);
    expect(normaliseQuality(0, 'jpeg')).toBe(1);
    expect(normaliseQuality(150, 'webp')).toBe(100);
  });
});

describe('qualityToFraction', () => {
  it('converts 100 to 1.0', () => {
    expect(qualityToFraction(100)).toBe(1.0);
  });

  it('converts 92 to 0.92', () => {
    expect(qualityToFraction(92)).toBeCloseTo(0.92);
  });

  it('converts 1 to 0.01', () => {
    expect(qualityToFraction(1)).toBeCloseTo(0.01);
  });
});
