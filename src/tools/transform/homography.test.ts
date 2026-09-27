import { describe, it, expect } from 'vitest';
import { applyHomography, invertHomography, squareToQuad } from './homography';

const tl = { x: 0, y: 0 };
const tr = { x: 800, y: 0 };

describe('squareToQuad (#927)', () => {
  it('maps the unit square corners onto the quad corners', () => {
    const br = { x: 1200, y: 800 };
    const bl = { x: -400, y: 800 };
    const m = squareToQuad(tl, tr, br, bl);
    const corners: [number, number, { x: number; y: number }][] = [
      [0, 0, tl], [1, 0, tr], [1, 1, br], [0, 1, bl],
    ];
    for (const [u, v, expected] of corners) {
      const p = applyHomography(m, u, v)!;
      expect(p.x).toBeCloseTo(expected.x, 6);
      expect(p.y).toBeCloseTo(expected.y, 6);
    }
  });

  it('foreshortens: rows near the narrow edge are shorter', () => {
    // Bottom edge twice as wide as the top → the top is "far".
    const m = squareToQuad(tl, tr, { x: 1200, y: 800 }, { x: -400, y: 800 });
    const ys = [0, 0.25, 0.5, 0.75, 1].map((v) => applyHomography(m, 0.5, v)!.y);
    const firstRow = ys[1]! - ys[0]!;
    const lastRow = ys[4]! - ys[3]!;
    expect(lastRow / firstRow).toBeGreaterThan(1.5);
    // A 2:1 width ratio makes the near half twice the height of the far
    // half: v = 0.5 lands at 1/3 of the height, not the middle.
    expect(ys[2]!).toBeCloseTo(800 / 3, 3);
  });

  it('reduces to the affine map for parallelograms', () => {
    const m = squareToQuad(tl, tr, { x: 900, y: 400 }, { x: 100, y: 400 });
    expect(m[6]).toBe(0);
    expect(m[7]).toBe(0);
    const p = applyHomography(m, 0.5, 0.5)!;
    expect(p.x).toBeCloseTo(450);
    expect(p.y).toBeCloseTo(200);
  });
});

describe('invertHomography', () => {
  it('round-trips points through the inverse', () => {
    const m = squareToQuad({ x: 10, y: 20 }, { x: 300, y: 5 }, { x: 350, y: 400 }, { x: -20, y: 380 });
    const inv = invertHomography(m)!;
    for (const [u, v] of [[0.1, 0.2], [0.5, 0.5], [0.9, 0.7]] as const) {
      const p = applyHomography(m, u, v)!;
      const back = applyHomography(inv, p.x, p.y)!;
      expect(back.x).toBeCloseTo(u, 6);
      expect(back.y).toBeCloseTo(v, 6);
    }
  });

  it('returns null for a degenerate quad', () => {
    const p = { x: 5, y: 5 };
    expect(invertHomography(squareToQuad(p, p, p, p))).toBeNull();
  });
});
