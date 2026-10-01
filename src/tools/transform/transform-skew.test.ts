import { describe, expect, it } from 'vitest';
import type { Point } from '../../types';
import { createTransformState, type TransformHandle, type TransformState } from './transform';
import { computeSkew } from './transform-skew';
import { getHandlePositions } from './transform-handles';

const OPPOSITE: Record<string, TransformHandle> = {
  'top': 'bottom',
  'top-left': 'bottom-left',
  'top-right': 'bottom-right',
  'bottom': 'top',
  'bottom-left': 'top-left',
  'bottom-right': 'top-right',
  'left': 'right',
  'right': 'left',
};

function skewState(overrides: Partial<TransformState> = {}): TransformState {
  return { ...createTransformState({ x: 100, y: 200, width: 300, height: 60 }, 'skew'), ...overrides };
}

function drag(state: TransformState, handle: TransformHandle, delta: Point): TransformState {
  const start = getHandlePositions(state)[handle];
  const end = { x: start.x + delta.x, y: start.y + delta.y };
  return { ...state, ...computeSkew(handle, start, end, state) };
}

function expectPoint(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

/** Direction the edge of `handle` slides along, in the box's own axes. */
function shearAxis(handle: TransformHandle): Point {
  return handle === 'left' || handle === 'right' ? { x: 0, y: 1 } : { x: 1, y: 0 };
}

function rotate(p: Point, angle: number): Point {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

const HANDLES = Object.keys(OPPOSITE) as TransformHandle[];

describe('computeSkew (#1074)', () => {
  it('moves the dragged right edge by the pointer distance, not twice it', () => {
    const before = skewState();
    const after = drag(before, 'right', { x: 0, y: -60 });
    const h = getHandlePositions(after);
    expectPoint(h['right'], { x: 400, y: 170 });
    expectPoint(h['top-right'], { x: 400, y: 140 });
    expectPoint(h['left'], getHandlePositions(before)['left']);
    expect(Math.tan(after.skewY)).toBeCloseTo(-60 / 300, 6);
  });

  it('moves the top edge with the pointer, not against it', () => {
    const before = createTransformState({ x: 300, y: 200, width: 100, height: 200 }, 'skew');
    const after = drag(before, 'top', { x: 60, y: 0 });
    const h = getHandlePositions(after);
    expectPoint(h['top'], { x: 410, y: 200 });
    expectPoint(h['bottom'], { x: 350, y: 400 });
  });

  it('moves the left edge with the pointer, not against it', () => {
    const before = createTransformState({ x: 200, y: 250, width: 300, height: 100 }, 'skew');
    const after = drag(before, 'left', { x: 0, y: -60 });
    const h = getHandlePositions(after);
    expectPoint(h['left'], { x: 200, y: 240 });
    expectPoint(h['right'], { x: 500, y: 300 });
  });

  for (const handle of HANDLES) {
    it(`${handle}: dragged edge tracks the pointer 1:1, opposite edge stays put`, () => {
      const before = skewState();
      const along = shearAxis(handle);
      const delta = { x: along.x * 25, y: along.y * 25 };
      const after = drag(before, handle, delta);
      const b = getHandlePositions(before);
      const a = getHandlePositions(after);
      expectPoint(a[handle], { x: b[handle].x + delta.x, y: b[handle].y + delta.y });
      expectPoint(a[OPPOSITE[handle]!], b[OPPOSITE[handle]!]);
    });

    it(`${handle}: tracks the pointer on a rotated, scaled box that is already skewed`, () => {
      const rotation = Math.PI / 6;
      const before = skewState({
        rotation,
        scaleX: 1.5,
        scaleY: 0.75,
        skewX: 0.2,
        skewY: -0.15,
        translateX: 30,
        translateY: -10,
      });
      const along = rotate(shearAxis(handle), rotation);
      const delta = { x: along.x * 20, y: along.y * 20 };
      const after = drag(before, handle, delta);
      const b = getHandlePositions(before);
      const a = getHandlePositions(after);
      expectPoint(a[handle], { x: b[handle].x + delta.x, y: b[handle].y + delta.y });
      expectPoint(a[OPPOSITE[handle]!], b[OPPOSITE[handle]!]);
    });
  }

  it('ignores the pointer component across the edge', () => {
    const before = skewState();
    const after = drag(before, 'right', { x: 40, y: -30 });
    const h = getHandlePositions(after);
    expectPoint(h['right'], { x: 400, y: 200 });
  });

  it('clamps at ±60° and keeps the opposite edge pinned', () => {
    const before = skewState();
    const after = drag(before, 'bottom', { x: 5000, y: 0 });
    expect(after.skewX).toBeCloseTo(Math.PI / 3, 6);
    expectPoint(getHandlePositions(after)['top'], getHandlePositions(before)['top']);
    const back = drag(before, 'top', { x: 5000, y: 0 });
    expect(back.skewX).toBeCloseTo(-Math.PI / 3, 6);
    expectPoint(getHandlePositions(back)['bottom'], getHandlePositions(before)['bottom']);
  });

  it('leaves the transform unchanged for a rotation handle', () => {
    const before = skewState({ skewX: 0.1 });
    const result = computeSkew('rotate-top-left', { x: 0, y: 0 }, { x: 50, y: 50 }, before);
    expect(result).toEqual({ skewX: 0.1, skewY: 0, translateX: 0, translateY: 0 });
  });
});
