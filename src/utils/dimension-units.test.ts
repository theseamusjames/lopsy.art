import { describe, it, expect } from 'vitest';
import {
  unitToPixels,
  pixelsToUnit,
  formatForInput,
  unitStep,
  DIMENSION_UNITS,
} from './dimension-units';

describe('dimension-units', () => {
  describe('unitToPixels', () => {
    it('passes pixels through unchanged', () => {
      expect(unitToPixels(1920, 'px', 72)).toBe(1920);
      expect(unitToPixels(1920, 'px', 300)).toBe(1920);
    });

    it('multiplies inches by DPI', () => {
      expect(unitToPixels(8.5, 'in', 300)).toBe(2550);
      expect(unitToPixels(1, 'in', 72)).toBe(72);
    });

    it('converts centimeters via inches', () => {
      // 2.54 cm == 1 in
      expect(unitToPixels(2.54, 'cm', 100)).toBe(100);
    });

    it('converts millimeters via inches', () => {
      // 25.4 mm == 1 in
      expect(unitToPixels(25.4, 'mm', 100)).toBe(100);
    });

    it('falls back to DPI 72 when non-positive DPI supplied', () => {
      expect(unitToPixels(1, 'in', 0)).toBe(72);
      expect(unitToPixels(1, 'in', -100)).toBe(72);
    });

    it('rounds to whole pixels', () => {
      // 8.27 in * 300 = 2481.0
      expect(unitToPixels(8.27, 'in', 300)).toBe(2481);
    });
  });

  describe('pixelsToUnit', () => {
    it('passes pixels through unchanged', () => {
      expect(pixelsToUnit(1920, 'px', 72)).toBe(1920);
    });

    it('divides by DPI for inches, keeping 2 decimals', () => {
      expect(pixelsToUnit(2550, 'in', 300)).toBe(8.5);
      expect(pixelsToUnit(2481, 'in', 300)).toBe(8.27);
    });

    it('rounds cm/mm to 2 decimals', () => {
      expect(pixelsToUnit(100, 'cm', 100)).toBe(2.54);
      expect(pixelsToUnit(100, 'mm', 100)).toBe(25.4);
    });
  });

  describe('formatForInput', () => {
    it('shows whole pixels without a decimal point', () => {
      expect(formatForInput(1920, 'px', 72)).toBe('1920');
    });

    it('drops trailing zeros in physical units', () => {
      expect(formatForInput(300, 'in', 300)).toBe('1');
      expect(formatForInput(2550, 'in', 300)).toBe('8.5');
    });
  });

  describe('unitStep', () => {
    it('is 1 for pixels and 0.01 for physical units', () => {
      expect(unitStep('px')).toBe('1');
      expect(unitStep('in')).toBe('0.01');
      expect(unitStep('cm')).toBe('0.01');
      expect(unitStep('mm')).toBe('0.01');
    });
  });

  it('exposes all supported units', () => {
    expect(DIMENSION_UNITS).toEqual(['px', 'in', 'cm', 'mm']);
  });

  it('round-trips pixel counts within display precision', () => {
    // pixelsToUnit renders at 2-decimal precision for physical units, so the
    // round-trip is bounded by ceil(dpi * 0.005 / unitsPerInch) pixels rather
    // than exact. What matters is that the drift stays small enough to be
    // invisible in the UI.
    for (const px of [1920, 1080, 2550, 3300, 2481, 3507]) {
      for (const unit of DIMENSION_UNITS) {
        for (const dpi of [72, 300, 600]) {
          const displayed = pixelsToUnit(px, unit, dpi);
          const back = unitToPixels(displayed, unit, dpi);
          expect(Math.abs(back - px)).toBeLessThanOrEqual(4);
        }
      }
    }
  });
});
