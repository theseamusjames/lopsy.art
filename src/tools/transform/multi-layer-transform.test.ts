import { describe, it, expect } from 'vitest';
import type { Layer, Rect } from '../../types';
import { createTransformState } from './transform';
import type { TransformState } from './transform';
import { createTransformPointMapper } from './transform-point';
import {
  flipTransform,
  pixelRectCovering,
  resolveLayerTransformTargets,
  rotateTransform90,
  selectionWantsLayerTransform,
  transformedSubRectBounds,
  unionRects,
} from './multi-layer-transform';

function raster(id: string, extra: Partial<Layer> = {}): Layer {
  return {
    id, name: id, type: 'raster', visible: true, locked: false, opacity: 1,
    blendMode: 'normal', x: 0, y: 0, width: 10, height: 10, clipToBelow: false,
    effects: {} as Layer['effects'], mask: null, ...extra,
  } as Layer;
}

function group(id: string, children: string[], extra: Partial<Layer> = {}): Layer {
  return {
    id, name: id, type: 'group', visible: true, locked: false, opacity: 1,
    blendMode: 'pass-through', x: 0, y: 0, clipToBelow: false,
    effects: {} as Layer['effects'], mask: null, children, collapsed: false,
    adjustments: [], adjustmentsEnabled: true, ...extra,
  } as Layer;
}

function closeRect(actual: Rect, expected: Rect): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  expect(actual.width).toBeCloseTo(expected.width, 6);
  expect(actual.height).toBeCloseTo(expected.height, 6);
}

describe('selectionWantsLayerTransform', () => {
  const layers = [raster('a'), raster('b'), group('g', ['a'])];

  it('needs two layers or a group', () => {
    expect(selectionWantsLayerTransform(layers, [])).toBe(false);
    expect(selectionWantsLayerTransform(layers, ['a'])).toBe(false);
    expect(selectionWantsLayerTransform(layers, ['a', 'b'])).toBe(true);
    expect(selectionWantsLayerTransform(layers, ['g'])).toBe(true);
  });
});

describe('resolveLayerTransformTargets', () => {
  it('keeps document order and drops duplicates', () => {
    const layers = [raster('a'), raster('b'), raster('c'), group('g', ['b'])];
    expect(resolveLayerTransformTargets(layers, ['c', 'a', 'g', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('stands a group for its descendants, nested groups included', () => {
    const layers = [raster('a'), raster('b'), raster('c'), group('inner', ['b', 'c']), group('outer', ['a', 'inner'])];
    expect(resolveLayerTransformTargets(layers, ['outer'])).toEqual(['a', 'b', 'c']);
  });

  it('leaves locked layers, and everything in a locked group, in place', () => {
    const layers = [
      raster('a'),
      raster('b', { locked: true }),
      raster('c'),
      raster('d'),
      group('locked-group', ['c'], { locked: true }),
      group('g', ['d', 'locked-group']),
    ];
    expect(resolveLayerTransformTargets(layers, ['a', 'b', 'g'])).toEqual(['a', 'd']);
  });

  it('ignores ids that are not in the document', () => {
    expect(resolveLayerTransformTargets([raster('a')], ['a', 'gone'])).toEqual(['a']);
  });
});

describe('unionRects', () => {
  it('covers every rect', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([
      { x: 10, y: 20, width: 30, height: 40 },
      { x: -5, y: 50, width: 10, height: 30 },
    ])).toEqual({ x: -5, y: 20, width: 45, height: 60 });
  });
});

describe('shared pivot', () => {
  // Three 100×100 layers side by side: the box is their union, 300×100,
  // so every layer turns and scales about (150, 50).
  const left: Rect = { x: 0, y: 0, width: 100, height: 100 };
  const middle: Rect = { x: 100, y: 0, width: 100, height: 100 };
  const right: Rect = { x: 200, y: 0, width: 100, height: 100 };
  const box = createTransformState(unionRects([left, middle, right])!);

  it('turns each layer about the union centre, not its own', () => {
    const quarter: TransformState = { ...box, rotation: Math.PI / 2 };
    // (x, y) → (150 − (y − 50), 50 + (x − 150)): the row becomes a column.
    closeRect(transformedSubRectBounds(quarter, left), { x: 100, y: -100, width: 100, height: 100 });
    closeRect(transformedSubRectBounds(quarter, middle), { x: 100, y: 0, width: 100, height: 100 });
    closeRect(transformedSubRectBounds(quarter, right), { x: 100, y: 100, width: 100, height: 100 });
  });

  it('scales each layer away from the union centre', () => {
    const doubled: TransformState = { ...box, scaleX: 2, scaleY: 2 };
    closeRect(transformedSubRectBounds(doubled, left), { x: -150, y: -50, width: 200, height: 200 });
    closeRect(transformedSubRectBounds(doubled, right), { x: 250, y: -50, width: 200, height: 200 });
  });

  it('carries a translation to every layer alike', () => {
    const moved: TransformState = { ...box, rotation: Math.PI, translateX: 10, translateY: -20 };
    closeRect(transformedSubRectBounds(moved, left), { x: 210, y: -20, width: 100, height: 100 });
  });

  it('maps a layer inside the box through the corner homography', () => {
    const corners: TransformState = {
      ...createTransformState(box.originalBounds, 'distort'),
      corners: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 60, y: 0 }, { x: -60, y: 0 }],
    };
    // The bottom edge widens from 300 to 420; the left layer's bottom-left
    // corner follows the box corner.
    const r = transformedSubRectBounds(corners, left);
    expect(r.x).toBeCloseTo(-60, 6);
    expect(r.y).toBeCloseTo(0, 6);
    expect(r.height).toBeCloseTo(100, 6);
  });
});

describe('pixelRectCovering', () => {
  it('rounds outwards with a pixel of slack', () => {
    expect(pixelRectCovering({ x: 10.2, y: -3.5, width: 5.1, height: 2 })).toEqual({ x: 9, y: -5, width: 8, height: 5 });
  });
});

describe('flipTransform', () => {
  const pending: TransformState = {
    ...createTransformState({ x: 20, y: 40, width: 200, height: 100 }),
    rotation: 0.4, scaleX: 1.5, scaleY: 0.75, skewX: 0.2, translateX: 12, translateY: -7,
  };
  const samples = [{ x: 20, y: 40 }, { x: 220, y: 40 }, { x: 120, y: 90 }, { x: 33, y: 131 }];

  it('mirrors the pending result about its own centre', () => {
    const map = createTransformPointMapper(pending);
    const c = { x: 120 + 12, y: 90 - 7 };
    const h = createTransformPointMapper(flipTransform(pending, 'horizontal'));
    const v = createTransformPointMapper(flipTransform(pending, 'vertical'));
    for (const p of samples) {
      const before = map(p.x, p.y)!;
      const fh = h(p.x, p.y)!;
      const fv = v(p.x, p.y)!;
      expect(fh.x).toBeCloseTo(2 * c.x - before.x, 6);
      expect(fh.y).toBeCloseTo(before.y, 6);
      expect(fv.x).toBeCloseTo(before.x, 6);
      expect(fv.y).toBeCloseTo(2 * c.y - before.y, 6);
    }
  });

  it('mirrors distorted corners about the middle of the quad', () => {
    const quad: TransformState = {
      ...createTransformState({ x: 0, y: 0, width: 100, height: 100 }, 'perspective'),
      corners: [{ x: 20, y: 0 }, { x: -20, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    };
    const map = createTransformPointMapper(quad);
    const flipped = createTransformPointMapper(flipTransform(quad, 'horizontal'));
    for (const p of [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 25, y: 75 }]) {
      const before = map(p.x, p.y)!;
      const after = flipped(p.x, p.y)!;
      expect(after.x).toBeCloseTo(100 - before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });
});

describe('rotateTransform90', () => {
  const isHalfPixel = (v: number): boolean => Math.abs(v - Math.floor(v) - 0.5) < 1e-6;

  it('lands pixel centres on pixel centres for an even-difference box', () => {
    const t = rotateTransform90(createTransformState({ x: 10, y: 20, width: 40, height: 20 }), 'cw');
    expect(t.translateX).toBe(0);
    const map = createTransformPointMapper(t);
    const p = map(10.5, 20.5)!;
    expect(isHalfPixel(p.x) && isHalfPixel(p.y)).toBe(true);
  });

  it('shifts an odd-difference box half a pixel so it stays on the grid', () => {
    const box = createTransformState({ x: 10, y: 20, width: 41, height: 20 });
    const cw = rotateTransform90(box, 'cw');
    const p = createTransformPointMapper(cw)(10.5, 20.5)!;
    expect(isHalfPixel(p.x) && isHalfPixel(p.y)).toBe(true);
    // Clockwise then counter-clockwise lands back where it started.
    const back = rotateTransform90(cw, 'ccw');
    expect(back.rotation).toBeCloseTo(0, 12);
    expect(back.translateX).toBe(0);
    expect(back.translateY).toBe(0);
  });

  it('turns clockwise on screen (y down)', () => {
    const t = rotateTransform90(createTransformState({ x: 0, y: 0, width: 100, height: 100 }), 'cw');
    // The top-left corner swings to the top-right.
    const p = createTransformPointMapper(t)(0, 0)!;
    expect(p.x).toBeCloseTo(100, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });
});
