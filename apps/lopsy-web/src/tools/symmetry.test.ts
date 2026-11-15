import { describe, it, expect } from 'vitest';
import { getMirroredPoints, mirrorBatchPoints, isSymmetryActive, getSymmetryMatrices, dabSampleMatrix } from './symmetry';
import type { SymmetryConfig, SymmetryMatrix } from './symmetry';

const config = (h: boolean, v: boolean, radial = 0): SymmetryConfig => ({
  horizontal: h,
  vertical: v,
  centerX: 100,
  centerY: 50,
  radialSegments: radial,
});

describe('getMirroredPoints', () => {
  it('returns empty when no symmetry', () => {
    expect(getMirroredPoints(30, 20, config(false, false))).toEqual([]);
  });

  it('mirrors vertically (left-right)', () => {
    const pts = getMirroredPoints(30, 20, config(false, true));
    expect(pts).toEqual([{ x: 170, y: 20 }]);
  });

  it('mirrors horizontally (top-bottom)', () => {
    const pts = getMirroredPoints(30, 20, config(true, false));
    expect(pts).toEqual([{ x: 30, y: 80 }]);
  });

  it('mirrors both axes (4-way)', () => {
    const pts = getMirroredPoints(30, 20, config(true, true));
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ x: 170, y: 20 });
    expect(pts[1]).toEqual({ x: 30, y: 80 });
    expect(pts[2]).toEqual({ x: 170, y: 80 });
  });
});

describe('mirrorBatchPoints', () => {
  it('mirrors a flat point array vertically', () => {
    const pts = new Float64Array([30, 20, 60, 40]);
    const result = mirrorBatchPoints(pts, config(false, true));
    expect(result).toHaveLength(1);
    expect(Array.from(result[0]!)).toEqual([170, 20, 140, 40]);
  });

  it('returns 3 mirrored batches for both axes', () => {
    const pts = new Float64Array([30, 20]);
    const result = mirrorBatchPoints(pts, config(true, true));
    expect(result).toHaveLength(3);
  });
});

describe('stroke-start centering', () => {
  it('mirrors around the stroke start point, not document center', () => {
    // Stroke starts at (50, 30), cursor moves to (70, 30)
    // With vertical symmetry, the mirror should be at (30, 30)
    // i.e., 2*50 - 70 = 30
    const startConfig: SymmetryConfig = {
      horizontal: false,
      vertical: true,
      centerX: 50,
      centerY: 30,
      radialSegments: 0,
    };
    const pts = getMirroredPoints(70, 30, startConfig);
    expect(pts).toEqual([{ x: 30, y: 30 }]);
  });
});

describe('isSymmetryActive', () => {
  it('returns false when both off', () => {
    expect(isSymmetryActive(config(false, false))).toBe(false);
  });

  it('returns true when either on', () => {
    expect(isSymmetryActive(config(true, false))).toBe(true);
    expect(isSymmetryActive(config(false, true))).toBe(true);
  });
});

describe('getSymmetryMatrices (#1599)', () => {
  const apply = (m: SymmetryMatrix, x: number, y: number) => ({
    x: m.m00 * x + m.m01 * y,
    y: m.m10 * x + m.m11 * y,
  });
  const det = (m: SymmetryMatrix) => m.m00 * m.m11 - m.m01 * m.m10;

  const cases: Array<[string, SymmetryConfig]> = [
    ['vertical', config(false, true)],
    ['horizontal', config(true, false)],
    ['4-way', config(true, true)],
    ['radial 4', config(false, false, 4)],
    ['radial 7', config(false, false, 7)],
  ];

  it.each(cases)('%s: one matrix per mirrored point, mapping offsets about the centre', (_name, cfg) => {
    const px = 30;
    const py = 20;
    const points = getMirroredPoints(px, py, cfg);
    const matrices = getSymmetryMatrices(cfg);
    expect(matrices).toHaveLength(points.length);
    matrices.forEach((m, i) => {
      const off = apply(m, px - cfg.centerX, py - cfg.centerY);
      expect(cfg.centerX + off.x).toBeCloseTo(points[i]!.x, 9);
      expect(cfg.centerY + off.y).toBeCloseTo(points[i]!.y, 9);
    });
  });

  it('a vertical-axis mirror flips the tip horizontally rather than rotating it', () => {
    const [m] = getSymmetryMatrices(config(false, true));
    expect(m).toEqual({ m00: -1, m01: 0, m10: 0, m11: 1 });
    expect(det(m!)).toBe(-1);
  });

  it('a horizontal-axis mirror flips the tip vertically', () => {
    const [m] = getSymmetryMatrices(config(true, false));
    expect(m).toEqual({ m00: 1, m01: 0, m10: 0, m11: -1 });
    expect(det(m!)).toBe(-1);
  });

  it('the 4-way diagonal copy is a 180 degree turn, not a flip', () => {
    const m = getSymmetryMatrices(config(true, true))[2]!;
    expect(det(m)).toBe(1);
    const v = apply(m, 1, 0);
    expect(v.x).toBeCloseTo(-1);
    expect(v.y).toBeCloseTo(0);
  });

  it('radial copy k rotates the tip by k * 360/n degrees', () => {
    const n = 4;
    getSymmetryMatrices(config(false, false, n)).forEach((m, i) => {
      const angle = (2 * Math.PI * (i + 1)) / n;
      const v = apply(m, 1, 0);
      expect(det(m)).toBeCloseTo(1);
      expect(Math.atan2(v.y, v.x)).toBeCloseTo(Math.atan2(Math.sin(angle), Math.cos(angle)));
    });
  });

  it('returns nothing when symmetry is off', () => {
    expect(getSymmetryMatrices(config(false, false))).toEqual([]);
  });
});

describe('dabSampleMatrix (#1599)', () => {
  it('inverts every copy transform so a copy samples the tip texel of its source pixel', () => {
    for (const cfg of [config(false, true), config(true, true), config(false, false, 5)]) {
      for (const m of getSymmetryMatrices(cfg)) {
        const inv = dabSampleMatrix(m);
        expect(inv.m00 * m.m00 + inv.m01 * m.m10).toBeCloseTo(1);
        expect(inv.m00 * m.m01 + inv.m01 * m.m11).toBeCloseTo(0);
        expect(inv.m10 * m.m00 + inv.m11 * m.m10).toBeCloseTo(0);
        expect(inv.m10 * m.m01 + inv.m11 * m.m11).toBeCloseTo(1);
      }
    }
  });
});
