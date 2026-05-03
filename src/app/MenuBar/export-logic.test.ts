import { describe, it, expect } from 'vitest';
import {
  computeExportDimensions,
  isLossyFormat,
  normaliseQuality,
  qualityToFraction,
} from './export-logic';

describe('computeExportDimensions', () => {
  it('returns original size at 1x', () => {
    expect(computeExportDimensions(1000, 800, 1)).toEqual({ width: 1000, height: 800 });
  });

  it('doubles dimensions at 2x', () => {
    expect(computeExportDimensions(1000, 800, 2)).toEqual({ width: 2000, height: 1600 });
  });

  it('halves dimensions at 0.5x', () => {
    expect(computeExportDimensions(1000, 800, 0.5)).toEqual({ width: 500, height: 400 });
  });

  it('triples dimensions at 3x', () => {
    expect(computeExportDimensions(1000, 800, 3)).toEqual({ width: 3000, height: 2400 });
  });

  it('rounds fractional pixels', () => {
    expect(computeExportDimensions(100, 100, 1.5)).toEqual({ width: 150, height: 150 });
    expect(computeExportDimensions(99, 99, 0.5)).toEqual({ width: 50, height: 50 });
  });
});

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
