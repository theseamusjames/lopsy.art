import { describe, it, expect } from 'vitest';
import { rectangleToPathAnchors } from './shape';

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
