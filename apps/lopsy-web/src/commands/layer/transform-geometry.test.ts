import { describe, expect, it } from 'vitest';
import { createTransformState, computeRotation, computeScale } from '../../tools/transform/transform';
import { hitTestBoxHandle } from '../../tools/transform/transform-handles';
import {
  anchorAxes,
  handleForAnchor,
  pressPoint,
  rotateRelease,
  rotationReached,
  scaleReached,
  scaleRelease,
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
