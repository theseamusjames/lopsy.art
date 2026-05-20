import { describe, it, expect } from 'vitest';
import { bresenhamLine, defaultPencilSettings } from './pencil';

describe('defaultPencilSettings', () => {
  it('returns size 1', () => {
    expect(defaultPencilSettings().size).toBe(1);
  });
});

describe('bresenhamLine', () => {
  it('horizontal line', () => {
    const points = bresenhamLine(0, 0, 4, 0);
    expect(points.length).toBe(5);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[4]).toEqual({ x: 4, y: 0 });
    for (const p of points) expect(p.y).toBe(0);
  });

  it('vertical line', () => {
    const points = bresenhamLine(0, 0, 0, 3);
    expect(points.length).toBe(4);
    for (const p of points) expect(p.x).toBe(0);
  });

  it('diagonal line', () => {
    const points = bresenhamLine(0, 0, 3, 3);
    expect(points.length).toBe(4);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[3]).toEqual({ x: 3, y: 3 });
  });

  it('single point', () => {
    const points = bresenhamLine(5, 5, 5, 5);
    expect(points.length).toBe(1);
    expect(points[0]).toEqual({ x: 5, y: 5 });
  });
});
