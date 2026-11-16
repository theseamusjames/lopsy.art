import { describe, it, expect } from 'vitest';
import { clampCornerRadius, parseBorderWidth, planBorder, uniformBorderWidths } from './border';

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
      layerPosition: 'bottom', outerRadius: 0, innerRadius: 0,
    });
  });

  it('offsets content by the left and top widths of an asymmetric border', () => {
    const widths = { top: 5, right: 20, bottom: 15, left: 30 };
    expect(planBorder(100, 80, widths, 'expand', MAX)).toEqual({
      width: 150, height: 100, offsetX: 30, offsetY: 5, hole: null,
      layerPosition: 'bottom', outerRadius: 0, innerRadius: 0,
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
      layerPosition: 'top', outerRadius: 0, innerRadius: 0,
    });
  });

  it('fills an overlay solid when the borders meet', () => {
    const plan = planBorder(100, 80, { top: 40, right: 0, bottom: 40, left: 0 }, 'overlay', MAX);
    expect(plan?.hole).toBeNull();
  });
});

describe('clampCornerRadius', () => {
  it('keeps a radius that fits', () => {
    expect(clampCornerRadius(12, 200, 150)).toBe(12);
  });

  it('limits a radius to half the short side', () => {
    expect(clampCornerRadius(500, 200, 150)).toBe(75);
    expect(clampCornerRadius(40, 31, 90)).toBe(15.5);
  });

  it('treats a negative or non-finite radius as square', () => {
    expect(clampCornerRadius(-4, 100, 100)).toBe(0);
    expect(clampCornerRadius(Number.NaN, 100, 100)).toBe(0);
    expect(clampCornerRadius(Number.POSITIVE_INFINITY, 100, 100)).toBe(0);
  });
});

describe('planBorder with rounded corners', () => {
  it('rounds an overlay frame and its window', () => {
    const plan = planBorder(200, 150, uniformBorderWidths(30), 'overlay', MAX, { outer: 25, inner: 10 });
    expect(plan).toMatchObject({
      hole: { x: 30, y: 30, width: 140, height: 90 },
      layerPosition: 'top', outerRadius: 25, innerRadius: 10,
    });
  });

  it('clamps the outer radius to the canvas and the inner radius to the window', () => {
    const plan = planBorder(200, 150, uniformBorderWidths(30), 'overlay', MAX, { outer: 999, inner: 999 });
    expect(plan?.outerRadius).toBe(75);
    expect(plan?.innerRadius).toBe(45);
  });

  it('has no inner radius when an overlay has no window', () => {
    const widths = { top: 40, right: 0, bottom: 40, left: 0 };
    const plan = planBorder(100, 80, widths, 'overlay', MAX, { outer: 10, inner: 10 });
    expect(plan).toMatchObject({ hole: null, outerRadius: 10, innerRadius: 0 });
  });

  it('rounds the outer corners of an expanded canvas and keeps the layer underneath', () => {
    const plan = planBorder(100, 80, uniformBorderWidths(10), 'expand', MAX, { outer: 500, inner: 0 });
    expect(plan).toMatchObject({ width: 120, height: 100, hole: null, layerPosition: 'bottom', outerRadius: 50 });
  });

  it('lays an expanded border with an inner radius over the content, windowed over the old canvas', () => {
    const widths = { top: 5, right: 20, bottom: 15, left: 30 };
    const plan = planBorder(100, 80, widths, 'expand', MAX, { outer: 0, inner: 60 });
    expect(plan).toMatchObject({
      width: 150, height: 100,
      hole: { x: 30, y: 5, width: 100, height: 80 },
      layerPosition: 'top', outerRadius: 0, innerRadius: 40,
    });
  });
});
