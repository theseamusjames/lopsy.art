import { describe, it, expect } from 'vitest';
import { getMirroredPoints, mirrorBatchPoints, isSymmetryActive } from './symmetry';
import type { SymmetryConfig } from './symmetry';

const config = (h: boolean, v: boolean): SymmetryConfig => ({
  horizontal: h,
  vertical: v,
  centerX: 100,
  centerY: 50,
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
