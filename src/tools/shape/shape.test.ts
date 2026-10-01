import { describe, it, expect } from 'vitest';
import { fitRegularPolygon, polygonToPathAnchors, rectangleToPathAnchors } from './shape';
import type { PathAnchor } from '../path/path';
import type { Point } from '../../types';

const KAPPA = 0.5522847498;

describe('rectangleToPathAnchors (#794)', () => {
  it('puts four straight corners on the full box for any aspect', () => {
    const anchors = rectangleToPathAnchors(300, 200, 150, 50, 0);
    expect(anchors.map((a) => a.point)).toEqual([
      { x: 150, y: 150 },
      { x: 450, y: 150 },
      { x: 450, y: 250 },
      { x: 150, y: 250 },
    ]);
    for (const a of anchors) {
      expect(a.handleIn).toBeNull();
      expect(a.handleOut).toBeNull();
    }
  });

  it('rounds each corner with a quarter-circle cubic', () => {
    const anchors = rectangleToPathAnchors(0, 0, 100, 50, 20);
    expect(anchors).toHaveLength(8);
    const k = 20 * KAPPA;
    // Top edge, then the top-right arc into the right edge.
    expect(anchors[0]).toEqual({ point: { x: -80, y: -50 }, handleIn: { x: -80 - k, y: -50 }, handleOut: null });
    expect(anchors[1]).toEqual({ point: { x: 80, y: -50 }, handleIn: null, handleOut: { x: 80 + k, y: -50 } });
    expect(anchors[2]).toEqual({ point: { x: 100, y: -30 }, handleIn: { x: 100, y: -30 - k }, handleOut: null });
    expect(anchors[3]!.point).toEqual({ x: 100, y: 30 });
    expect(anchors[4]!.point).toEqual({ x: 80, y: 50 });
    expect(anchors[5]!.point).toEqual({ x: -80, y: 50 });
    expect(anchors[6]!.point).toEqual({ x: -100, y: 30 });
    expect(anchors[7]).toEqual({ point: { x: -100, y: -30 }, handleIn: null, handleOut: { x: -100, y: -30 - k } });
  });

  it('caps the radius at the shorter half extent and merges zero-length sides', () => {
    // r 50 on a 200 × 100 box: the left and right sides vanish (a stadium).
    const anchors = rectangleToPathAnchors(0, 0, 100, 50, 80);
    expect(anchors).toHaveLength(6);
    const k = 50 * KAPPA;
    expect(anchors[2]).toEqual({
      point: { x: 100, y: 0 },
      handleIn: { x: 100, y: -k },
      handleOut: { x: 100, y: k },
    });
    expect(anchors[5]).toEqual({
      point: { x: -100, y: 0 },
      handleIn: { x: -100, y: k },
      handleOut: { x: -100, y: -k },
    });
  });

  it('collapses a rounded square of full radius to a four-anchor circle', () => {
    const anchors = rectangleToPathAnchors(0, 0, 40, 40, 40);
    expect(anchors.map((a) => a.point)).toEqual([
      { x: 0, y: -40 },
      { x: 40, y: 0 },
      { x: 0, y: 40 },
      { x: -40, y: 0 },
    ]);
  });

  it('treats a negative radius as square corners', () => {
    expect(rectangleToPathAnchors(0, 0, 10, 5, -3)).toHaveLength(4);
  });
});

/**
 * Line-for-line port of `sdPolygon` in shape_fill.glsl (p relative to the
 * drag centre, y down), so the path can be checked against the exact
 * geometry the Pixels output rasterizes.
 */
function shaderSdPolygon(px: number, py: number, hx: number, hy: number, n: number, cr: number): number {
  const an = Math.PI / n;
  const cosAn = Math.cos(an);
  const rot = n % 2 === 0 ? an : Math.PI;
  let xMaxUnit = 0;
  let yMaxUnit = -1;
  let yMinUnit = 1;
  for (let i = 0; i < n; i++) {
    const a = rot + 2 * Math.PI * i / n;
    xMaxUnit = Math.max(xMaxUnit, Math.abs(Math.sin(a)));
    yMaxUnit = Math.max(yMaxUnit, Math.cos(a));
    yMinUnit = Math.min(yMinUnit, Math.cos(a));
  }
  const scaleX = hx / Math.max(xMaxUnit, 1e-6);
  const scaleY = (2 * hy) / Math.max(yMaxUnit - yMinUnit, 1e-6);
  const circumR = Math.min(scaleX, scaleY);
  const faceR = circumR * cosAn;
  const clampedCr = Math.min(cr, faceR * 0.99);
  const insetCircumR = (faceR - clampedCr) / cosAn;
  const yShift = (yMaxUnit + yMinUnit) * 0.5 * circumR;
  const qx = px;
  const qy = py + yShift;
  let minEdgeDist = 1e6;
  let isOutside = false;
  for (let i = 0; i < n; i++) {
    const a0 = rot + 2 * Math.PI * i / n;
    const a1 = rot + 2 * Math.PI * (i + 1) / n;
    const v0x = insetCircumR * Math.sin(a0);
    const v0y = insetCircumR * Math.cos(a0);
    const ex = insetCircumR * Math.sin(a1) - v0x;
    const ey = insetCircumR * Math.cos(a1) - v0y;
    const tx = qx - v0x;
    const ty = qy - v0y;
    const t = Math.max(0, Math.min(1, (tx * ex + ty * ey) / (ex * ex + ey * ey)));
    minEdgeDist = Math.min(minEdgeDist, Math.hypot(qx - (v0x + ex * t), qy - (v0y + ey * t)));
    if (ex * ty - ey * tx > 0) isOutside = true;
  }
  return (isOutside ? minEdgeDist : -minEdgeDist) - clampedCr;
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** Dense samples along the closed path, segment by segment. */
function samplePath(anchors: readonly PathAnchor[], perSegment: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]!;
    const b = anchors[(i + 1) % anchors.length]!;
    for (let s = 0; s < perSegment; s++) {
      out.push(cubicAt(a.point, a.handleOut ?? a.point, b.handleIn ?? b.point, b.point, s / perSegment));
    }
  }
  return out;
}

function distanceToPolyline(p: Point, pts: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + ex * t), p.y - (a.y + ey * t)));
  }
  return best;
}

const BOXES = [
  { name: 'wide', cx: 200, cy: 150, rx: 120, ry: 70 },
  { name: 'tall', cx: 90, cy: 260, rx: 60, ry: 110 },
];

describe('polygonToPathAnchors matches the Pixels polygon (sdPolygon)', () => {
  for (const n of [3, 4, 5, 6, 8]) {
    for (const radius of [0, 15]) {
      for (const box of BOXES) {
        it(`n=${n}, radius ${radius}, ${box.name} box: the path lies on and covers the shader's outline`, () => {
          const { cx, cy, rx, ry } = box;
          const anchors = polygonToPathAnchors(cx, cy, rx, ry, n, radius);
          const sd = (p: Point) => shaderSdPolygon(p.x - cx, p.y - cy, rx, ry, n, Math.min(radius, rx, ry));

          for (const a of anchors) expect(Math.abs(sd(a.point))).toBeLessThan(1e-6);
          const samples = samplePath(anchors, 40);
          for (const p of samples) expect(Math.abs(sd(p))).toBeLessThan(0.01);

          // Coverage: walk rays from the outline's interior and find where each
          // ray crosses the shader outline; the path must pass through it.
          const fit = fitRegularPolygon(cx, cy, rx, ry, n);
          for (let k = 0; k < 180; k++) {
            const th = (2 * Math.PI * k) / 180;
            let lo = 0;
            let hi = Math.max(rx, ry) * 3;
            for (let it = 0; it < 60; it++) {
              const mid = (lo + hi) / 2;
              const q = { x: fit.centre.x + mid * Math.cos(th), y: fit.centre.y + mid * Math.sin(th) };
              if (sd(q) < 0) lo = mid; else hi = mid;
            }
            const edge = { x: fit.centre.x + lo * Math.cos(th), y: fit.centre.y + lo * Math.sin(th) };
            expect(distanceToPolyline(edge, samples)).toBeLessThan(0.02);
          }
        });
      }
    }

    it(`n=${n} without radius: one sharp anchor per shader vertex, clockwise from the top`, () => {
      const { cx, cy, rx, ry } = BOXES[0]!;
      const anchors = polygonToPathAnchors(cx, cy, rx, ry, n);
      expect(anchors).toHaveLength(n);
      for (const a of anchors) {
        expect(a.handleIn).toBeNull();
        expect(a.handleOut).toBeNull();
      }
      const ys = anchors.map((a) => a.point.y);
      expect(anchors[0]!.point.y).toBeCloseTo(Math.min(...ys), 6);
      // Clockwise on a y-down screen: positive shoelace area.
      let area = 0;
      for (let i = 0; i < n; i++) {
        const p = anchors[i]!.point;
        const q = anchors[(i + 1) % n]!.point;
        area += p.x * q.y - q.x * p.y;
      }
      expect(area).toBeGreaterThan(0);
    });
  }

  it('fits the box on its tighter axis and centres the vertex bounding box (odd n)', () => {
    // Triangle in a 240 × 140 box: height-limited, so it spans the full 140px
    // height, centred on the drag centre even though its centroid is lower.
    const anchors = polygonToPathAnchors(200, 150, 120, 70, 3);
    const ys = anchors.map((a) => a.point.y);
    const xs = anchors.map((a) => a.point.x);
    expect(Math.min(...ys)).toBeCloseTo(80, 6);
    expect(Math.max(...ys)).toBeCloseTo(220, 6);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(200, 6);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(240);
  });

  it('a 4-sided polygon is a flat-topped square, not a diamond', () => {
    const anchors = polygonToPathAnchors(200, 150, 120, 70, 4);
    expect(anchors.map((a) => a.point)).toEqual([
      { x: expect.closeTo(130, 6), y: expect.closeTo(80, 6) },
      { x: expect.closeTo(270, 6), y: expect.closeTo(80, 6) },
      { x: expect.closeTo(270, 6), y: expect.closeTo(220, 6) },
      { x: expect.closeTo(130, 6), y: expect.closeTo(220, 6) },
    ]);
  });

  it('rounds each corner with arcs of at most 90°', () => {
    // Triangle corners turn 120°, so each needs two cubics (three anchors).
    expect(polygonToPathAnchors(200, 150, 120, 70, 3, 15)).toHaveLength(9);
    expect(polygonToPathAnchors(200, 150, 120, 70, 6, 15)).toHaveLength(12);
  });
});
