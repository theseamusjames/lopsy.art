import { describe, expect, it } from 'vitest';
import { createTransformState, computeRotation, computeScale, computeSkew } from '../../tools/transform/transform';
import { hitTestBoxHandle } from '../../tools/transform/transform-handles';
import {
  anchorAxes,
  handleForAnchor,
  isConvexQuad,
  pressPoint,
  rotateRelease,
  rotationReached,
  scaleReached,
  scaleRelease,
  skewAxis,
  skewReached,
  skewRelease,
  wrapAngle,
  type DragFrame,
} from './transform-geometry';

const LIMITS = { min: -16384, max: 32768 };
const BOX = { x: 100, y: 70, width: 60, height: 40 };
const PIVOT = { x: 130, y: 90 };

const identity: DragFrame = { box: BOX, toLocal: (p) => p, toDoc: (p) => p, pivot: PIVOT };

const rad = (deg: number): number => (deg * Math.PI) / 180;

describe('rotateRelease', () => {
  it('finds a whole-pixel release that turns within a hair of the angle, as the rotate handler measures it', () => {
    const press = { x: 180, y: 50 };
    for (const deg of [30, -45, 7.5, 135, -200, 359]) {
      const found = rotateRelease(PIVOT, press, rad(deg), LIMITS);
      expect(found).not.toBeNull();
      expect(Number.isInteger(found!.point.x) && Number.isInteger(found!.point.y)).toBe(true);
      expect(Math.abs(wrapAngle(found!.reached - rad(deg)))).toBeLessThan(rad(0.001));
      // The handler's own measure of the same drag: rotation = angle(release) - angle(press).
      const state = createTransformState(BOX);
      const handler = computeRotation(found!.point, state) - computeRotation(press, state);
      expect(handler).toBe(found!.reached);
    }
  });

  it('gives back the release of a whole-pixel drag for the angle that drag turned', () => {
    const press = { x: 180, y: 50 };
    const release = { x: 190, y: 120 };
    const found = rotateRelease(PIVOT, press, rotationReached(PIVOT, press, release), LIMITS);
    expect(found!.reached).toBe(rotationReached(PIVOT, press, release));
  });

  it('stays inside the coordinate range, and gives up when the ray leaves it at once', () => {
    const found = rotateRelease(PIVOT, { x: 180, y: 50 }, rad(30), { min: 0, max: 300 });
    expect(found!.point.x).toBeLessThanOrEqual(300);
    expect(found!.point.y).toBeGreaterThanOrEqual(0);
    expect(rotateRelease({ x: 0.5, y: 0.5 }, { x: 10, y: 0.5 }, 0, { min: 0, max: 0 })).toBeNull();
  });
});

describe('scaleRelease', () => {
  it('drags the handle opposite the anchor by the factor, reaching what computeScale reads', () => {
    const handle = handleForAnchor('top-left');
    expect(handle).toBe('bottom-right');
    const press = { x: 160, y: 110 };
    const found = scaleRelease(identity, handle, press, { x: 1.5, y: 1.375 }, LIMITS);
    expect(found).toEqual({ point: { x: 190, y: 125 }, reached: { x: 1.5, y: 1.375 } });
    const read = computeScale(handle, press, found!.point, createTransformState(BOX), false);
    expect({ x: read.scaleX, y: read.scaleY }).toEqual(found!.reached);
  });

  it('moves the left edge for a right anchor, and only along x', () => {
    const handle = handleForAnchor('right');
    expect(anchorAxes('right')).toEqual({ x: true, y: false });
    const found = scaleRelease(identity, handle, { x: 100, y: 90 }, { x: 2, y: 1 }, LIMITS);
    expect(found).toEqual({ point: { x: 40, y: 90 }, reached: { x: 2, y: 1 } });
  });

  it('lands on the nearest whole pixel for a factor between them', () => {
    const found = scaleRelease(identity, 'right', { x: 160, y: 90 }, { x: 1.3333, y: 1 }, LIMITS);
    expect(found!.point).toEqual({ x: 180, y: 90 });
    expect(Math.abs(found!.reached.x - 1.3333) * BOX.width).toBeLessThanOrEqual(0.5);
  });

  it('works in a turned box\'s own axes', () => {
    const a = rad(30);
    const turned: DragFrame = {
      box: { x: 0, y: 0, width: 50, height: 20 },
      toLocal: (p) => ({ x: Math.cos(a) * (p.x - 10) + Math.sin(a) * (p.y - 10), y: -Math.sin(a) * (p.x - 10) + Math.cos(a) * (p.y - 10) }),
      toDoc: (p) => ({ x: 10 + Math.cos(a) * p.x - Math.sin(a) * p.y, y: 10 + Math.sin(a) * p.x + Math.cos(a) * p.y }),
      pivot: { x: 0, y: 0 },
    };
    const press = turned.toDoc({ x: 50, y: 20 });
    const found = scaleRelease(turned, 'bottom-right', press, { x: 2, y: 2 }, LIMITS);
    expect(Math.abs(found!.reached.x - 2) * 50).toBeLessThan(0.75);
    expect(Math.abs(found!.reached.y - 2) * 20).toBeLessThan(0.75);
    expect(scaleReached(turned, 'bottom-right', press, found!.point)).toEqual(found!.reached);
  });

  it('refuses a release outside the coordinate range', () => {
    expect(scaleRelease(identity, 'bottom-right', { x: 160, y: 110 }, { x: 20, y: 20 }, { min: 0, max: 500 })).toBeNull();
  });
});

describe('pressPoint', () => {
  it('presses the handle\'s own pixel when the hit test takes it', () => {
    const state = createTransformState(BOX);
    expect(pressPoint({ x: 180, y: 50 }, 'rotate-top-right', (p) => hitTestBoxHandle(p, state, 1))).toEqual({ x: 180, y: 50 });
  });

  it('tries the pixels around a handle between pixels, and gives up when none grabs it', () => {
    const hits = (p: { x: number; y: number }) => (p.x === 10 && p.y === 21 ? 'top' : null);
    expect(pressPoint({ x: 10.4, y: 20.5 }, 'top', hits)).toEqual({ x: 10, y: 21 });
    expect(pressPoint({ x: 10.4, y: 20.5 }, 'left', hits)).toBeNull();
  });
});

describe('wrapAngle', () => {
  it('brings angles into (-π, π]', () => {
    expect(wrapAngle(rad(200))).toBeCloseTo(rad(-160));
    expect(wrapAngle(rad(-200))).toBeCloseTo(rad(160));
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
  });
});

describe('skewRelease', () => {
  const skewBox = createTransformState(BOX, 'skew');

  it('slides the edge opposite the anchor along itself, reaching what computeSkew reads', () => {
    // The bottom edge is 40 px from the top: tan 0.5 slides it 20 px right.
    const bottom = skewRelease(identity, 'bottom', { x: 130, y: 110 }, 0.5, LIMITS);
    expect(bottom).toEqual({ point: { x: 150, y: 110 }, reached: 0.5 });
    expect(Math.tan(computeSkew('bottom', { x: 130, y: 110 }, bottom!.point, skewBox).skewX)).toBeCloseTo(0.5, 12);
    // The same shear with the bottom held slides the top edge the other way.
    const top = skewRelease(identity, 'top', { x: 130, y: 70 }, 0.5, LIMITS);
    expect(top!.point).toEqual({ x: 110, y: 70 });
    expect(Math.tan(computeSkew('top', { x: 130, y: 70 }, top!.point, skewBox).skewX)).toBeCloseTo(0.5, 12);
  });

  it('shears along y from the left and right edges', () => {
    // The right edge is 60 px from the left: tan 0.25 slides it 15 px down.
    const right = skewRelease(identity, 'right', { x: 160, y: 90 }, 0.25, LIMITS);
    expect(right).toEqual({ point: { x: 160, y: 105 }, reached: 0.25 });
    expect(Math.tan(computeSkew('right', { x: 160, y: 90 }, right!.point, skewBox).skewY)).toBeCloseTo(0.25, 12);
    const left = skewRelease(identity, 'left', { x: 100, y: 90 }, 0.25, LIMITS);
    expect(left!.point).toEqual({ x: 100, y: 75 });
    expect(Math.tan(computeSkew('left', { x: 100, y: 90 }, left!.point, skewBox).skewY)).toBeCloseTo(0.25, 12);
  });

  it('lands on the nearest whole pixel, and on the press itself for a shear under half a pixel', () => {
    const found = skewRelease(identity, 'bottom', { x: 130, y: 110 }, Math.tan(rad(10)), LIMITS);
    expect(found!.point).toEqual({ x: 137, y: 110 });
    expect(found!.reached).toBe(7 / 40);
    expect(skewRelease(identity, 'bottom', { x: 130, y: 110 }, 0.01, LIMITS)!.reached).toBe(0);
  });

  it('gives back the release of a whole-pixel drag for the shear that drag gave', () => {
    const press = { x: 100, y: 90 };
    const release = { x: 100, y: 69 };
    const reached = skewReached(identity, 'left', press, release)!;
    expect(skewRelease(identity, 'left', press, reached, LIMITS)).toEqual({ point: release, reached });
  });

  it('works in a turned box\'s own axes, and refuses a release outside the range', () => {
    // A box turned a quarter: its own x runs down the document.
    const turned: DragFrame = {
      box: BOX,
      toLocal: (p) => ({ x: PIVOT.x + (p.y - PIVOT.y), y: PIVOT.y - (p.x - PIVOT.x) }),
      toDoc: (p) => ({ x: PIVOT.x - (p.y - PIVOT.y), y: PIVOT.y + (p.x - PIVOT.x) }),
      pivot: PIVOT,
    };
    const press = turned.toDoc({ x: 130, y: 110 });
    const found = skewRelease(turned, 'bottom', press, 0.5, LIMITS);
    expect(found!.point).toEqual({ x: press.x, y: press.y + 20 });
    expect(found!.reached).toBeCloseTo(0.5, 12);
    expect(skewRelease(identity, 'bottom', { x: 130, y: 110 }, 0.5, { min: 0, max: 140 })).toBeNull();
  });

  it('knows which axis each anchor shears along', () => {
    expect([skewAxis('top'), skewAxis('bottom'), skewAxis('left'), skewAxis('right')]).toEqual(['x', 'x', 'y', 'y']);
  });
});

describe('isConvexQuad', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

  it('takes a convex quad in either winding', () => {
    expect(isConvexQuad(square)).toBe(true);
    expect(isConvexQuad([...square].reverse())).toBe(true);
    expect(isConvexQuad([{ x: 3, y: 0 }, { x: 7, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(true);
  });

  it('refuses a dented quad, a crossed one, and three corners in a line', () => {
    expect(isConvexQuad([{ x: 8, y: 8 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(false);
    expect(isConvexQuad([{ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(false);
    expect(isConvexQuad([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(false);
    expect(isConvexQuad(square.slice(0, 3))).toBe(false);
  });
});
