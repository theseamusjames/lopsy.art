import { describe, it, expect } from 'vitest';
import {
  RULER_UNITS,
  RULER_UNIT_LABELS,
  pixelsPerUnit,
  pixelsToUnits,
  rulerStep,
  formatRulerValue,
} from './ruler-units';

describe('pixelsPerUnit', () => {
  it('converts through the document dpi', () => {
    expect(pixelsPerUnit('px', 300)).toBe(1);
    expect(pixelsPerUnit('in', 300)).toBe(300);
    expect(pixelsPerUnit('pt', 72)).toBe(1);
    expect(pixelsPerUnit('pt', 144)).toBe(2);
    expect(pixelsPerUnit('mm', 254)).toBeCloseTo(10);
  });

  it('pixelsToUnits is its inverse', () => {
    expect(pixelsToUnits(150, 'in', 300)).toBe(0.5);
    expect(pixelsToUnits(72, 'pt', 72)).toBe(72);
    expect(pixelsToUnits(254, 'mm', 254)).toBeCloseTo(25.4);
    expect(pixelsToUnits(17, 'px', 300)).toBe(17);
  });
});

describe('rulerStep', () => {
  it('keeps the pixel ruler on the 1-2-5 sequence with a one-pixel floor', () => {
    expect(rulerStep('px', 1, 72)).toEqual({ units: 50, px: 50 });
    expect(rulerStep('px', 2, 72)).toEqual({ units: 20, px: 20 });
    expect(rulerStep('px', 4, 72)).toEqual({ units: 10, px: 10 });
    expect(rulerStep('px', 8, 72)).toEqual({ units: 5, px: 5 });
    expect(rulerStep('px', 0.25, 72)).toEqual({ units: 200, px: 200 });
    expect(rulerStep('px', 64, 72)).toEqual({ units: 1, px: 1 });
    // dpi is irrelevant to a pixel ruler
    expect(rulerStep('px', 1, 300)).toEqual({ units: 50, px: 50 });
  });

  it('rounds down in the unit itself, so millimetre and point labels stay round', () => {
    const mm = rulerStep('mm', 1, 72);
    expect(mm.units).toBe(10);
    expect(mm.px).toBeCloseTo(28.35, 2);
    expect(rulerStep('mm', 0.1, 300).units).toBe(20);
    expect(rulerStep('mm', 64, 72).units).toBeCloseTo(0.2);
    expect(rulerStep('pt', 1, 72)).toEqual({ units: 50, px: 50 });
    expect(rulerStep('pt', 1, 144).units).toBe(20);
  });

  it('uses binary fractions for sub-inch intervals and decimal steps above an inch', () => {
    expect(rulerStep('in', 1, 72)).toEqual({ units: 0.5, px: 36 });
    expect(rulerStep('in', 2, 72)).toEqual({ units: 0.25, px: 18 });
    expect(rulerStep('in', 1, 300).units).toBe(1 / 8);
    expect(rulerStep('in', 4, 300).units).toBe(1 / 32);
    expect(rulerStep('in', 64, 300).units).toBe(1 / 512);
    expect(rulerStep('in', 0.25, 72).units).toBe(2);
    expect(rulerStep('in', 0.05, 72).units).toBe(10);
  });

  it('never spaces ticks further than the 50-screen-pixel target, except the whole-pixel floor', () => {
    for (const unit of RULER_UNITS) {
      for (const zoom of [0.05, 0.25, 1, 3, 16, 64]) {
        for (const dpi of [72, 96, 300]) {
          const step = rulerStep(unit, zoom, dpi);
          const isPixelFloor = unit === 'px' && step.units === 1;
          if (!isPixelFloor) expect(step.px * zoom).toBeLessThanOrEqual(50 + 1e-9);
          expect(step.px * zoom).toBeGreaterThan(20 - 1e-9);
        }
      }
    }
  });
});

describe('formatRulerValue', () => {
  it('rounds pixels to integers', () => {
    expect(formatRulerValue(49.6, 'px')).toBe('50');
    expect(formatRulerValue(-0.4, 'px')).toBe('0');
  });

  it('trims other units to at most four decimals without trailing zeros', () => {
    expect(formatRulerValue(0.5, 'in')).toBe('0.5');
    expect(formatRulerValue(1 / 16, 'in')).toBe('0.0625');
    expect(formatRulerValue(3, 'in')).toBe('3');
    expect(formatRulerValue(10.000001, 'mm')).toBe('10');
    expect(formatRulerValue(-2.5, 'pt')).toBe('-2.5');
    expect(formatRulerValue(-0.00001, 'mm')).toBe('0');
  });

  it('labels every unit', () => {
    expect(RULER_UNITS.map((u) => RULER_UNIT_LABELS[u])).toEqual(['Pixels', 'Points', 'Inches', 'Millimeters']);
  });
});
