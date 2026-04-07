import { describe, it, expect } from 'vitest';
import type { Point } from '../../types';
import {
  HOLD_TIMEOUT_MS,
  HOLD_RADIUS_PX,
  isStraightStroke,
  rdpSimplify,
  smoothStroke,
  hasMovedBeyondRadius,
} from './smooth-line';

describe('smooth-line constants', () => {
  it('HOLD_TIMEOUT_MS is 2000', () => {
    expect(HOLD_TIMEOUT_MS).toBe(2000);
  });

  it('HOLD_RADIUS_PX is 4', () => {
    expect(HOLD_RADIUS_PX).toBe(4);
  });
});

describe('isStraightStroke', () => {
  it('returns true for a single point', () => {
    expect(isStraightStroke([{ x: 0, y: 0 }])).toBe(true);
  });

  it('returns true for two points', () => {
    expect(isStraightStroke([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toBe(true);
  });

  it('returns true for collinear points', () => {
    const pts: Point[] = [];
    for (let i = 0; i <= 10; i++) {
      pts.push({ x: i * 10, y: i * 5 });
    }
    expect(isStraightStroke(pts)).toBe(true);
  });

  it('returns true for nearly-collinear points within tolerance', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 2 },
      { x: 100, y: 0 },
    ];
    expect(isStraightStroke(pts, 4)).toBe(true);
  });

  it('returns false for a clearly curved stroke', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 0 },
    ];
    expect(isStraightStroke(pts, 4)).toBe(false);
  });
});

describe('rdpSimplify', () => {
  it('returns both endpoints for a straight line', () => {
    const pts: Point[] = [];
    for (let i = 0; i <= 20; i++) {
      pts.push({ x: i * 5, y: i * 3 });
    }
    const result = rdpSimplify(pts, 1);
    expect(result.length).toBe(2);
    expect(result[0]).toEqual(pts[0]);
    expect(result[1]).toEqual(pts[pts.length - 1]);
  });

  it('preserves corners in an L-shaped path', () => {
    const pts: Point[] = [];
    for (let i = 0; i <= 10; i++) pts.push({ x: i * 10, y: 0 });
    for (let i = 1; i <= 10; i++) pts.push({ x: 100, y: i * 10 });
    const result = rdpSimplify(pts, 2);
    expect(result.length).toBe(3);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[1]).toEqual({ x: 100, y: 0 });
    expect(result[2]).toEqual({ x: 100, y: 100 });
  });

  it('handles two-point input', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
    const result = rdpSimplify(pts, 5);
    expect(result).toEqual(pts);
  });

  it('handles single-point input', () => {
    const pts: Point[] = [{ x: 42, y: 7 }];
    const result = rdpSimplify(pts, 5);
    expect(result).toEqual(pts);
  });
});

describe('smoothStroke', () => {
  it('returns a straight line for collinear input', () => {
    const pts: Point[] = [];
    for (let i = 0; i <= 50; i++) {
      pts.push({ x: i * 2, y: i });
    }
    const result = smoothStroke(pts, 5);
    expect(result.isStraight).toBe(true);
    expect(result.controlPoints.length).toBe(2);
    expect(result.sampledPoints.length).toBeGreaterThan(2);

    // All sampled points should lie on the line from first to last
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    for (const sp of result.sampledPoints) {
      const dx = last.x - first.x;
      const dy = last.y - first.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const cross = Math.abs((sp.x - first.x) * dy - (sp.y - first.y) * dx) / len;
      expect(cross).toBeLessThan(0.1);
    }
  });

  it('returns a spline for curved input', () => {
    // Quarter circle
    const pts: Point[] = [];
    for (let i = 0; i <= 40; i++) {
      const angle = (Math.PI / 2) * (i / 40);
      pts.push({ x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 });
    }
    const result = smoothStroke(pts, 3);
    expect(result.isStraight).toBe(false);
    expect(result.controlPoints.length).toBeGreaterThanOrEqual(2);
    expect(result.sampledPoints.length).toBeGreaterThan(2);
  });

  it('returns input as-is for a single point', () => {
    const result = smoothStroke([{ x: 10, y: 20 }], 5);
    expect(result.isStraight).toBe(true);
    expect(result.sampledPoints).toEqual([{ x: 10, y: 20 }]);
  });

  it('first and last sampled points match first and last raw points', () => {
    const pts: Point[] = [];
    for (let i = 0; i <= 30; i++) {
      const angle = (Math.PI / 3) * (i / 30);
      pts.push({ x: Math.cos(angle) * 80, y: Math.sin(angle) * 80 });
    }
    const result = smoothStroke(pts, 2);
    const first = result.sampledPoints[0]!;
    const last = result.sampledPoints[result.sampledPoints.length - 1]!;
    expect(Math.abs(first.x - pts[0]!.x)).toBeLessThan(0.1);
    expect(Math.abs(first.y - pts[0]!.y)).toBeLessThan(0.1);
    expect(Math.abs(last.x - pts[pts.length - 1]!.x)).toBeLessThan(0.1);
    expect(Math.abs(last.y - pts[pts.length - 1]!.y)).toBeLessThan(0.1);
  });
});

describe('hasMovedBeyondRadius', () => {
  it('returns false when within radius', () => {
    expect(hasMovedBeyondRadius({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
  });

  it('returns true when beyond radius', () => {
    expect(hasMovedBeyondRadius({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true);
  });

  it('uses custom radius', () => {
    expect(hasMovedBeyondRadius({ x: 0, y: 0 }, { x: 5, y: 0 }, 10)).toBe(false);
    expect(hasMovedBeyondRadius({ x: 0, y: 0 }, { x: 11, y: 0 }, 10)).toBe(true);
  });
});
