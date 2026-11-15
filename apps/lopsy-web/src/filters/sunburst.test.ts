import { describe, it, expect, vi } from 'vitest';

vi.mock('../engine-wasm/wasm-bridge', () => ({ filterSunburst: vi.fn() }));

import { sunburst, sunburstArgs } from './sunburst';

const black = { r: 0, g: 0, b: 0, a: 1 };
const white = { r: 255, g: 255, b: 255, a: 1 };

function defaults(): Record<string, number> {
  return Object.fromEntries(sunburst.params.map((p) => [p.key, p.defaultValue]));
}

describe('sunburstArgs', () => {
  it('maps default dialog values to a centred, full-length burst', () => {
    const a = sunburstArgs(defaults(), black, white);
    expect(a.rays).toBe(24);
    expect(a.centerX).toBe(0.5);
    expect(a.centerY).toBe(0.5);
    expect(a.length).toBe(1);
    expect(a.width).toBe(0.5);
    expect(a.taper).toBe(0);
    expect(a.fade).toBe(0);
    expect(a.shouldFillGaps).toBe(false);
  });

  it('converts percentage sliders to 0-1 fractions', () => {
    const a = sunburstArgs(
      { ...defaults(), length: 150, width: 20, taper: 75, fade: 40, softness: 10, jitter: 60 },
      black,
      white,
    );
    expect(a.length).toBeCloseTo(1.5);
    expect(a.width).toBeCloseTo(0.2);
    expect(a.taper).toBeCloseTo(0.75);
    expect(a.fade).toBeCloseTo(0.4);
    expect(a.softness).toBeCloseTo(0.1);
    expect(a.jitter).toBeCloseTo(0.6);
  });

  it('uses the ray colour normalised to 0-1 with opacity folded into alpha', () => {
    const a = sunburstArgs({ ...defaults(), opacity: 50 }, { r: 255, g: 128, b: 0, a: 0.8 }, white);
    expect(a.rayColor[0]).toBe(1);
    expect(a.rayColor[1]).toBeCloseTo(128 / 255);
    expect(a.rayColor[2]).toBe(0);
    expect(a.rayColor[3]).toBeCloseTo(0.4);
  });

  it('fills gaps with the background colour only when requested', () => {
    const keep = sunburstArgs(defaults(), black, { r: 255, g: 0, b: 0, a: 1 });
    expect(keep.shouldFillGaps).toBe(false);
    const fill = sunburstArgs({ ...defaults(), gaps: 1 }, black, { r: 255, g: 0, b: 0, a: 1 });
    expect(fill.shouldFillGaps).toBe(true);
    expect(fill.gapColor).toEqual([1, 0, 0]);
  });

  it('rounds the ray count and never goes below three rays', () => {
    expect(sunburstArgs({ ...defaults(), rays: 7.6 }, black, white).rays).toBe(8);
    expect(sunburstArgs({ ...defaults(), rays: 0 }, black, white).rays).toBe(3);
  });

  it('falls back to defaults for missing values', () => {
    const a = sunburstArgs({}, black, white);
    expect(a.rays).toBe(24);
    expect(a.length).toBe(1);
    expect(a.rayColor[3]).toBe(1);
  });
});
