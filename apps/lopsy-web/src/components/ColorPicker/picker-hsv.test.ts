import { describe, it, expect } from 'vitest';
import { hsvToRgb } from '../../utils/color';
import { syncHsvToColor } from './picker-hsv';

describe('syncHsvToColor', () => {
  it('keeps the same HSV object when it still produces the colour', () => {
    const prev = { h: 216, s: 99, v: 99 };
    const color = { ...hsvToRgb(prev), a: 1 };
    expect(syncHsvToColor(prev, color)).toBe(prev);
  });

  it('keeps hue and saturation through black', () => {
    const prev = { h: 216, s: 80, v: 0 };
    expect(syncHsvToColor(prev, { r: 0, g: 0, b: 0, a: 1 })).toBe(prev);
  });

  it('rebuilds from a different chromatic colour (a newly selected stop)', () => {
    const prev = { h: 0, s: 0, v: 0 };
    const next = syncHsvToColor(prev, { r: 255, g: 0, b: 0, a: 1 });
    expect(next).toEqual({ h: 0, s: 100, v: 100 });
  });

  it('moves to white when a white stop is selected after a blue one, keeping the hue', () => {
    const blue = { h: 216, s: 99, v: 99 };
    const next = syncHsvToColor(blue, { r: 255, g: 255, b: 255, a: 1 });
    expect(next).toEqual({ h: 216, s: 0, v: 100 });
  });

  it('moves to mid grey with zero saturation', () => {
    const next = syncHsvToColor({ h: 120, s: 100, v: 100 }, { r: 128, g: 128, b: 128, a: 1 });
    expect(next.h).toBe(120);
    expect(next.s).toBe(0);
    expect(next.v).toBeCloseTo(50.2, 1);
  });

  it('ignores alpha', () => {
    const prev = { h: 0, s: 100, v: 100 };
    expect(syncHsvToColor(prev, { r: 255, g: 0, b: 0, a: 0.25 })).toBe(prev);
  });
});
