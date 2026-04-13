import { describe, it, expect } from 'vitest';
import {
  IDENTITY_POINTS,
  IDENTITY_CURVES,
  isIdentityCurve,
  isIdentityCurves,
  normalizePoints,
  computeTangents,
  evaluateCurve,
  buildCurveLUT,
  buildCurvesLutRgba,
  applyCurvesToImageData,
} from './curves';

describe('isIdentityCurve', () => {
  it('detects the canonical identity', () => {
    expect(isIdentityCurve(IDENTITY_POINTS)).toBe(true);
  });

  it('rejects curves with extra anchors', () => {
    expect(isIdentityCurve([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }])).toBe(false);
  });

  it('rejects curves that move an endpoint', () => {
    expect(isIdentityCurve([{ x: 0, y: 0.1 }, { x: 1, y: 1 }])).toBe(false);
  });
});

describe('normalizePoints', () => {
  it('inserts missing endpoints', () => {
    const pts = normalizePoints([{ x: 0.5, y: 0.5 }]);
    expect(pts[0]).toEqual({ x: 0, y: 0.5 });
    expect(pts[pts.length - 1]).toEqual({ x: 1, y: 0.5 });
  });

  it('clamps points outside the unit square', () => {
    const pts = normalizePoints([{ x: -0.5, y: 1.2 }, { x: 2, y: -1 }]);
    expect(pts).toEqual([{ x: 0, y: 1 }, { x: 1, y: 0 }]);
  });

  it('sorts unsorted input', () => {
    const pts = normalizePoints([{ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0.5, y: 0.7 }]);
    expect(pts.map((p) => p.x)).toEqual([0, 0.5, 1]);
  });

  it('dedupes points sharing an x coordinate', () => {
    const pts = normalizePoints([{ x: 0, y: 0 }, { x: 0.5, y: 0.3 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }]);
    expect(pts.filter((p) => p.x === 0.5)).toHaveLength(1);
  });
});

describe('computeTangents', () => {
  it('produces zero tangents at extrema for an inverted-V curve', () => {
    const pts = normalizePoints([{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }]);
    const t = computeTangents(pts);
    // Slope sign flips at the peak, so monotonic tangent at index 1 = 0.
    expect(t[1]).toBe(0);
  });

  it('preserves slope on a straight diagonal', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    const t = computeTangents(pts);
    expect(t[0]).toBeCloseTo(1);
    expect(t[1]).toBeCloseTo(1);
  });
});

describe('evaluateCurve', () => {
  it('returns x for the identity curve', () => {
    expect(evaluateCurve(IDENTITY_POINTS, 0)).toBeCloseTo(0);
    expect(evaluateCurve(IDENTITY_POINTS, 0.5)).toBeCloseTo(0.5);
    expect(evaluateCurve(IDENTITY_POINTS, 1)).toBeCloseTo(1);
  });

  it('passes through every control point exactly', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.25, y: 0.6 }, { x: 0.75, y: 0.2 }, { x: 1, y: 1 }];
    for (const p of pts) {
      expect(evaluateCurve(pts, p.x)).toBeCloseTo(p.y, 5);
    }
  });

  it('clamps the input to [0, 1]', () => {
    expect(evaluateCurve(IDENTITY_POINTS, -1)).toBe(0);
    expect(evaluateCurve(IDENTITY_POINTS, 2)).toBe(1);
  });

  it('never overshoots the unit interval', () => {
    // A curve with a sharp dip should not produce values < 0 or > 1.
    const pts = [{ x: 0, y: 0 }, { x: 0.4, y: 1 }, { x: 0.6, y: 0 }, { x: 1, y: 1 }];
    for (let i = 0; i <= 100; i++) {
      const v = evaluateCurve(pts, i / 100);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('buildCurveLUT', () => {
  it('returns the identity LUT [0, 1, ..., 255] for the identity curve', () => {
    const lut = buildCurveLUT(IDENTITY_POINTS);
    for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);
  });

  it('inverts when the curve is flipped', () => {
    const inverted = [{ x: 0, y: 1 }, { x: 1, y: 0 }];
    const lut = buildCurveLUT(inverted);
    expect(lut[0]).toBe(255);
    expect(lut[255]).toBe(0);
    expect(lut[128]).toBeGreaterThan(120);
    expect(lut[128]).toBeLessThan(135);
  });

  it('lifts midtones for an S-curve raised at .25', () => {
    const lut = buildCurveLUT([{ x: 0, y: 0 }, { x: 0.25, y: 0.5 }, { x: 1, y: 1 }]);
    expect(lut[64]).toBeGreaterThan(64); // midtones lifted
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
  });

  it('produces a 256-byte LUT', () => {
    expect(buildCurveLUT(IDENTITY_POINTS).length).toBe(256);
  });
});

describe('buildCurvesLutRgba', () => {
  it('packs all four channels into a 1024-byte RGBA texture', () => {
    const tex = buildCurvesLutRgba(IDENTITY_CURVES);
    expect(tex.length).toBe(1024);
    // Identity in every channel: pixel i = (i, i, i, i).
    for (let i = 0; i < 256; i++) {
      expect(tex[i * 4]).toBe(i);
      expect(tex[i * 4 + 1]).toBe(i);
      expect(tex[i * 4 + 2]).toBe(i);
      expect(tex[i * 4 + 3]).toBe(i);
    }
  });

  it('routes the master curve into the alpha channel', () => {
    const inverted = [{ x: 0, y: 1 }, { x: 1, y: 0 }];
    const tex = buildCurvesLutRgba({
      rgb: inverted,
      r: IDENTITY_POINTS,
      g: IDENTITY_POINTS,
      b: IDENTITY_POINTS,
    });
    expect(tex[0 * 4 + 3]).toBe(255);
    expect(tex[255 * 4 + 3]).toBe(0);
    // Per-channel slots stay identity.
    expect(tex[128 * 4]).toBe(128);
  });
});

describe('applyCurvesToImageData', () => {
  it('is a no-op for identity curves', () => {
    const data = new Uint8ClampedArray([10, 20, 30, 255]);
    applyCurvesToImageData(data, IDENTITY_CURVES);
    expect(Array.from(data)).toEqual([10, 20, 30, 255]);
  });

  it('inverts via the master curve', () => {
    const data = new Uint8ClampedArray([10, 20, 30, 255]);
    const curves = {
      rgb: [{ x: 0, y: 1 }, { x: 1, y: 0 }],
      r: IDENTITY_POINTS,
      g: IDENTITY_POINTS,
      b: IDENTITY_POINTS,
    };
    applyCurvesToImageData(data, curves);
    expect(data[0]).toBe(245);
    expect(data[1]).toBe(235);
    expect(data[2]).toBe(225);
    // Alpha untouched.
    expect(data[3]).toBe(255);
  });

  it('applies per-channel curves after the master', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 255]);
    const curves = {
      rgb: IDENTITY_POINTS,
      r: [{ x: 0, y: 0 }, { x: 1, y: 0 }], // crush red to 0
      g: IDENTITY_POINTS,
      b: IDENTITY_POINTS,
    };
    applyCurvesToImageData(data, curves);
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(100);
    expect(data[2]).toBe(100);
  });
});

describe('isIdentityCurves', () => {
  it('is true for undefined / null', () => {
    expect(isIdentityCurves(undefined)).toBe(true);
    expect(isIdentityCurves(null)).toBe(true);
  });

  it('is true for IDENTITY_CURVES', () => {
    expect(isIdentityCurves(IDENTITY_CURVES)).toBe(true);
  });

  it('is false when any channel is non-identity', () => {
    expect(isIdentityCurves({
      ...IDENTITY_CURVES,
      r: [{ x: 0, y: 0 }, { x: 0.5, y: 0.4 }, { x: 1, y: 1 }],
    })).toBe(false);
  });
});
