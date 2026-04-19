import { describe, it, expect } from 'vitest';
import { getMirroredPoints, mirrorBatchPoints, isSymmetryActive } from './symmetry';
import type { SymmetryConfig } from './symmetry';

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

describe('radial symmetry', () => {
  it('generates N-1 rotated points for N segments', () => {
    const pts = getMirroredPoints(120, 50, config(false, false, 4));
    expect(pts).toHaveLength(3);
  });

  it('rotates correctly for 4-fold (90° increments)', () => {
    const pts = getMirroredPoints(120, 50, config(false, false, 4));
    expect(pts[0]!.x).toBeCloseTo(100);
    expect(pts[0]!.y).toBeCloseTo(70);
    expect(pts[1]!.x).toBeCloseTo(80);
    expect(pts[1]!.y).toBeCloseTo(50);
    expect(pts[2]!.x).toBeCloseTo(100);
    expect(pts[2]!.y).toBeCloseTo(30);
  });

  it('rotates correctly for 3-fold (120° increments)', () => {
    const pts = getMirroredPoints(110, 50, config(false, false, 3));
    expect(pts).toHaveLength(2);
    // 120° rotation of (10, 0) relative to center
    expect(pts[0]!.x).toBeCloseTo(100 + 10 * Math.cos(2 * Math.PI / 3));
    expect(pts[0]!.y).toBeCloseTo(50 + 10 * Math.sin(2 * Math.PI / 3));
    // 240° rotation
    expect(pts[1]!.x).toBeCloseTo(100 + 10 * Math.cos(4 * Math.PI / 3));
    expect(pts[1]!.y).toBeCloseTo(50 + 10 * Math.sin(4 * Math.PI / 3));
  });

  it('overrides mirror when radialSegments >= 2', () => {
    const pts = getMirroredPoints(120, 50, config(true, true, 6));
    expect(pts).toHaveLength(5);
  });

  it('2-fold radial produces 1 point (180° rotation)', () => {
    const pts = getMirroredPoints(120, 60, config(false, false, 2));
    expect(pts).toHaveLength(1);
    expect(pts[0]!.x).toBeCloseTo(80);
    expect(pts[0]!.y).toBeCloseTo(40);
  });

  it('returns empty for radialSegments < 2 and no mirror', () => {
    expect(getMirroredPoints(30, 20, config(false, false, 0))).toEqual([]);
    expect(getMirroredPoints(30, 20, config(false, false, 1))).toEqual([]);
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

  it('returns N-1 rotated batches for radial symmetry', () => {
    const pts = new Float64Array([120, 50, 110, 50]);
    const result = mirrorBatchPoints(pts, config(false, false, 6));
    expect(result).toHaveLength(5);
  });

  it('radial batch matches single-point rotation', () => {
    const pts = new Float64Array([120, 50]);
    const batchResult = mirrorBatchPoints(pts, config(false, false, 4));
    const singleResult = getMirroredPoints(120, 50, config(false, false, 4));
    expect(batchResult).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(batchResult[i]![0]).toBeCloseTo(singleResult[i]!.x);
      expect(batchResult[i]![1]).toBeCloseTo(singleResult[i]!.y);
    }
  });
});

describe('stroke-start centering', () => {
  it('mirrors around the stroke start point, not document center', () => {
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
  it('returns false when all off', () => {
    expect(isSymmetryActive(config(false, false, 0))).toBe(false);
  });

  it('returns true when either mirror is on', () => {
    expect(isSymmetryActive(config(true, false))).toBe(true);
    expect(isSymmetryActive(config(false, true))).toBe(true);
  });

  it('returns true when radial segments >= 2', () => {
    expect(isSymmetryActive(config(false, false, 3))).toBe(true);
    expect(isSymmetryActive(config(false, false, 8))).toBe(true);
  });

  it('returns false when radial segments < 2 and no mirror', () => {
    expect(isSymmetryActive(config(false, false, 1))).toBe(false);
  });
});
