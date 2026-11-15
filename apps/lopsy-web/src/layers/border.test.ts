import { describe, it, expect } from 'vitest';
import { parseBorderWidth, planBorder, uniformBorderWidths } from './border';

const MAX = 16384;

describe('parseBorderWidth', () => {
  it('reads whole pixel counts', () => {
    expect(parseBorderWidth('12')).toBe(12);
  });

  it('rounds fractional input', () => {
    expect(parseBorderWidth('7.6')).toBe(8);
  });

  it('treats empty, negative and junk input as zero', () => {
    expect(parseBorderWidth('')).toBe(0);
    expect(parseBorderWidth('-5')).toBe(0);
    expect(parseBorderWidth('abc')).toBe(0);
  });
});

describe('planBorder', () => {
  it('returns null when every width is zero', () => {
    expect(planBorder(100, 80, uniformBorderWidths(0), 'expand', MAX)).toBeNull();
    expect(planBorder(100, 80, uniformBorderWidths(0), 'overlay', MAX)).toBeNull();
  });

  it('grows the canvas by a symmetric border and centres the content', () => {
    expect(planBorder(100, 80, uniformBorderWidths(10), 'expand', MAX)).toEqual({
      width: 120, height: 100, offsetX: 10, offsetY: 10, hole: null,
    });
  });

  it('offsets content by the left and top widths of an asymmetric border', () => {
    const widths = { top: 5, right: 20, bottom: 15, left: 30 };
    expect(planBorder(100, 80, widths, 'expand', MAX)).toEqual({
      width: 150, height: 100, offsetX: 30, offsetY: 5, hole: null,
    });
  });

  it('refuses an expansion past the maximum document side', () => {
    expect(planBorder(16000, 100, uniformBorderWidths(200), 'expand', MAX)).toBeNull();
  });

  it('keeps the canvas size and cuts a window for an overlay', () => {
    const widths = { top: 5, right: 20, bottom: 15, left: 30 };
    expect(planBorder(100, 80, widths, 'overlay', MAX)).toEqual({
      width: 100, height: 80, offsetX: 0, offsetY: 0,
      hole: { x: 30, y: 5, width: 50, height: 60 },
    });
  });

  it('fills an overlay solid when the borders meet', () => {
    const plan = planBorder(100, 80, { top: 40, right: 0, bottom: 40, left: 0 }, 'overlay', MAX);
    expect(plan?.hole).toBeNull();
  });
});
