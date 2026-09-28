import { describe, it, expect } from 'vitest';
import { polygonToPathAnchors } from './shape';

describe('polygonToPathAnchors', () => {
  it('draws a 4-sided polygon as a rectangle at the drag aspect, not a diamond (#794)', () => {
    const anchors = polygonToPathAnchors(0, 0, 150, 50, 4);
    const corners = anchors
      .map((a) => `${Math.round(a.point.x)},${Math.round(a.point.y)}`)
      .sort();
    expect(corners).toEqual(['-150,-50', '-150,50', '150,-50', '150,50']);
  });

  it('offsets the rectangle to the given centre', () => {
    const anchors = polygonToPathAnchors(540, 375, 470, 165, 4);
    const xs = anchors.map((a) => a.point.x);
    const ys = anchors.map((a) => a.point.y);
    expect(Math.min(...xs)).toBe(70);
    expect(Math.max(...xs)).toBe(1010);
    expect(Math.min(...ys)).toBe(210);
    expect(Math.max(...ys)).toBe(540);
  });

  it('keeps straight segments on the rectangle', () => {
    for (const a of polygonToPathAnchors(0, 0, 10, 20, 4)) {
      expect(a.handleIn).toBeNull();
      expect(a.handleOut).toBeNull();
    }
  });

  it('still starts other polygons at the top vertex', () => {
    for (const sides of [3, 5, 6]) {
      const [first] = polygonToPathAnchors(0, 0, 100, 100, sides);
      expect(first!.point.x).toBeCloseTo(0, 6);
      expect(first!.point.y).toBeCloseTo(-100, 6);
    }
  });
});
