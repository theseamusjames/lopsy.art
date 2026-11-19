import { describe, expect, it } from 'vitest';
import { addPoint, curvePath, hitPoint, isStraight, movePoint, removePoint } from './curve-editor-math';

const LINE = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

describe('addPoint', () => {
  it('adds a point on the curve and reports its index', () => {
    const { points, index } = addPoint(LINE, 0.25);
    expect(index).toBe(1);
    expect(points[1]?.x).toBe(0.25);
    expect(points[1]?.y).toBeCloseTo(0.25);
  });

  it('grabs the existing point instead of crowding it', () => {
    const { points, index } = addPoint([...LINE, { x: 0.5, y: 0.6 }], 0.505, 0.9);
    expect(points).toHaveLength(3);
    expect(index).toBe(1);
  });
});

describe('movePoint', () => {
  const curve = [{ x: 0, y: 0 }, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.6 }, { x: 1, y: 1 }];

  it('keeps inner points between their neighbours', () => {
    const moved = movePoint(curve, 1, 0.9, 1.4);
    expect(moved[1]?.x).toBeCloseTo(0.59);
    expect(moved[1]?.y).toBe(1);
  });

  it('moves end points only up and down', () => {
    expect(movePoint(curve, 0, 0.3, 0.2)[0]).toEqual({ x: 0, y: 0.2 });
  });
});

describe('removePoint and hitPoint', () => {
  it('removes inner points only, and finds the nearest point', () => {
    const curve = [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }];
    expect(removePoint(curve, 1)).toEqual(LINE);
    expect(removePoint(curve, 0)).toEqual(curve);
    expect(hitPoint(curve, 0.51, 0.62)).toBe(1);
    expect(hitPoint(curve, 0.3, 0.9)).toBeNull();
  });
});

describe('curvePath', () => {
  it('draws from the bottom-left to the top-right for the straight line', () => {
    const path = curvePath(LINE, 100, 4);
    expect(path).toBe('M0,100L25,75L50,50L75,25L100,0');
    expect(isStraight(LINE)).toBe(true);
    expect(isStraight([{ x: 0, y: 0.1 }, { x: 1, y: 1 }])).toBe(false);
  });
});
