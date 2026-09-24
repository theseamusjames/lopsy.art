import { describe, it, expect } from 'vitest';
import { polygonToPathAnchors, ellipseToPathAnchors } from './shape';

// #794 — a 4-sided polygon (Shape → Polygon, Sides = 4) is expected
// to render as a rectangle at the drag's aspect ratio, both for the
// Pixels output and for the Path output. The path variant used to
// draw a stretched diamond because `polygonToPathAnchors` never
// applied the even-N `π/n` rotation the GPU renderer / CPU rasterizer
// both apply. Points ordered anchor 0..n-1 anti/clockwise from top.
describe('polygonToPathAnchors (#794)', () => {
  it('a 4-sided polygon at rx=150, ry=50 is a rectangle, not a diamond', () => {
    const anchors = polygonToPathAnchors(0, 0, 150, 50, 4);
    expect(anchors).toHaveLength(4);
    // Each vertex sits at ±150 in x and ±50 in y (rectangle corners),
    // not (0, ±50) / (±150, 0) (diamond vertices).
    for (const a of anchors) {
      expect(Math.abs(a.point.x)).toBeCloseTo(150, 4);
      expect(Math.abs(a.point.y)).toBeCloseTo(50, 4);
    }
    // Path is closed and covers all four rectangle corners.
    const corners = anchors.map((a) => `${Math.round(a.point.x)},${Math.round(a.point.y)}`).sort();
    expect(corners).toEqual(['-150,-50', '-150,50', '150,-50', '150,50']);
  });

  it('a 6-sided polygon (hexagon) uses inscribed circle vertices (pointy top)', () => {
    const anchors = polygonToPathAnchors(0, 0, 100, 100, 6);
    // Hexagon still uses the general N-gon formula (rx*cos, ry*sin
    // with rot=0), which puts the first vertex at (0, -100).
    const top = anchors[0]!;
    expect(top.point.x).toBeCloseTo(0, 4);
    expect(top.point.y).toBeCloseTo(-100, 4);
  });

  it('a 5-sided polygon (pentagon, odd N) has the top vertex on the y axis', () => {
    const anchors = polygonToPathAnchors(0, 0, 100, 100, 5);
    // Odd N: rot = 0. The first vertex (angle = -π/2) lands at (0, -100).
    const [first] = anchors;
    expect(first!.point.x).toBeCloseTo(0, 4);
    expect(first!.point.y).toBeCloseTo(-100, 4);
  });
});

describe('ellipseToPathAnchors', () => {
  it('places anchors at the axis extremities', () => {
    const anchors = ellipseToPathAnchors(50, 50, 20, 10);
    const points = anchors.map((a) => a.point);
    expect(points).toEqual([
      { x: 50, y: 40 },
      { x: 70, y: 50 },
      { x: 50, y: 60 },
      { x: 30, y: 50 },
    ]);
  });
});
