import { describe, expect, it } from 'vitest';
import {
  IDENTITY_CURVES,
  buildCurveLUT,
  buildCurvesLutRgba,
  evaluateCurve,
  isIdentityCurves,
  normalizePoints,
} from './curves';

describe('normalizePoints', () => {
  it('sorts, clamps and adds the end points', () => {
    expect(normalizePoints([{ x: 0.5, y: 0.7 }, { x: -1, y: 2 }])).toEqual([
      { x: 0, y: 1 },
      { x: 0.5, y: 0.7 },
      { x: 1, y: 0.7 },
    ]);
  });
});

describe('buildCurveLUT', () => {
  it('is the identity for the straight line', () => {
    const lut = buildCurveLUT([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(lut[0]).toBe(0);
    expect(lut[128]).toBe(128);
    expect(lut[255]).toBe(255);
  });

  it('lifts the midtones through a raised middle point and stays monotone', () => {
    const lut = buildCurveLUT([{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }]);
    expect(lut[128]).toBeGreaterThan(170);
    for (let i = 1; i < 256; i++) expect(lut[i] ?? 0).toBeGreaterThanOrEqual(lut[i - 1] ?? 0);
    expect(evaluateCurve([{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }], 0.5)).toBeCloseTo(0.7);
  });
});

describe('buildCurvesLutRgba', () => {
  it('packs red, green, blue and the master curve as RGBA', () => {
    const lut = buildCurvesLutRgba({ ...IDENTITY_CURVES, r: [{ x: 0, y: 1 }, { x: 1, y: 1 }] });
    expect(lut).toHaveLength(1024);
    expect(Array.from(lut.slice(0, 4))).toEqual([255, 0, 0, 0]);
    expect(Array.from(lut.slice(400, 404))).toEqual([255, 100, 100, 100]);
    expect(isIdentityCurves(IDENTITY_CURVES)).toBe(true);
  });
});
