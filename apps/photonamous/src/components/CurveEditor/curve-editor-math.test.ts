import { describe, expect, it } from 'vitest';
import { addPoint, curvePath, describeCurve, hitPoint, isStraight, keyMovePoint, movePoint, newPointX, pointName, removePoint, toLevel } from './curve-editor-math';

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

describe('keyboard editing', () => {
  const curve = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }];

  it('moves a point by a level, ten with Shift', () => {
    expect(toLevel(keyMovePoint(curve, 1, 'ArrowUp', false)?.[1]?.y ?? 0)).toBe(129);
    expect(toLevel(keyMovePoint(curve, 1, 'ArrowDown', true)?.[1]?.y ?? 0)).toBe(118);
    expect(toLevel(keyMovePoint(curve, 1, 'ArrowRight', false)?.[1]?.x ?? 0)).toBe(129);
    expect(toLevel(keyMovePoint(curve, 1, 'PageUp', false)?.[1]?.y ?? 0)).toBe(138);
    expect(keyMovePoint(curve, 1, 'End', false)?.[1]?.y).toBe(1);
  });

  it('steps onto whole levels, so every press reads one more', () => {
    let points = curve;
    for (let i = 0; i < 3; i++) points = keyMovePoint(points, 1, 'ArrowUp', true) ?? points;
    expect(toLevel(points[1]?.y ?? 0)).toBe(158);
    expect(toLevel(keyMovePoint(points, 1, 'ArrowLeft', false)?.[1]?.x ?? 0)).toBe(127);
  });

  it('keeps end points at their ends and outputs in range', () => {
    expect(keyMovePoint(curve, 0, 'ArrowRight', true)?.[0]).toEqual({ x: 0, y: 0 });
    expect(keyMovePoint(curve, 2, 'ArrowUp', false)?.[2]).toEqual({ x: 1, y: 1 });
    expect(keyMovePoint(curve, 0, 'ArrowUp', false)?.[0]?.y).toBeCloseTo(1 / 255);
  });

  it('ignores other keys', () => {
    expect(keyMovePoint(curve, 1, 'Enter', false)).toBeNull();
    expect(keyMovePoint(curve, 5, 'ArrowUp', false)).toBeNull();
  });

  it('adds in the widest gap', () => {
    expect(newPointX(LINE)).toBe(0.5);
    expect(newPointX([{ x: 0, y: 0 }, { x: 0.2, y: 0.3 }, { x: 1, y: 1 }])).toBeCloseTo(0.6);
  });

  it('names and describes points as levels', () => {
    expect([0, 1, 2].map((i) => pointName(i, 3))).toEqual(['Black point', 'Point 1', 'White point']);
    expect(describeCurve(LINE)).toBe('Straight: every tone stays as it is.');
    expect(describeCurve([{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }])).toBe('3 points, input to output: 0 to 0, 128 to 153, 255 to 255.');
  });
});
