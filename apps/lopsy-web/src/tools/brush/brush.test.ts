import { describe, it, expect } from 'vitest';
import {
  generateBrushStamp,
  interpolatePoints,
  defaultBrushSettings,
} from './brush';

describe('defaultBrushSettings', () => {
  it('returns valid defaults', () => {
    const s = defaultBrushSettings();
    expect(s.size).toBeGreaterThan(0);
    expect(s.hardness).toBeGreaterThanOrEqual(0);
    expect(s.opacity).toBeGreaterThan(0);
  });
});

describe('generateBrushStamp', () => {
  it('center pixel is 1.0 for any hardness', () => {
    for (const hardness of [0, 0.5, 1]) {
      const stamp = generateBrushStamp(5, hardness);
      expect(stamp[2 * 5 + 2]).toBe(1);
    }
  });

  it('edge pixel is 0 for hardness=1', () => {
    const stamp = generateBrushStamp(11, 1);
    expect(stamp[0 * 11 + 0]).toBe(0);
  });

  it('has falloff for hardness=0', () => {
    const stamp = generateBrushStamp(11, 0);
    const center = stamp[5 * 11 + 5]!;
    const edge = stamp[5 * 11 + 8]!; // not at corner, but towards edge
    expect(center).toBe(1);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
  });
});

describe('interpolatePoints', () => {
  it('returns correct count for given spacing', () => {
    const points = interpolatePoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 5);
    expect(points.length).toBe(3); // 0, 5, 10
  });

  it('returns single point for same start/end', () => {
    const points = interpolatePoints({ x: 5, y: 5 }, { x: 5, y: 5 }, 1);
    expect(points.length).toBe(1);
    expect(points[0]).toEqual({ x: 5, y: 5 });
  });
});
