import { describe, it, expect } from 'vitest';
import {
  applyAffine,
  composeAffine,
  documentRotation90,
  invertAffine,
  layerFlip,
  layerRotation90,
  planMaskRemap,
  scaling,
  translation,
  type Affine,
} from './mask-remap';
import { createRasterLayer, createTextLayer, createGroupLayer } from './layer-model';
import type { Layer, LayerMask } from '../types';

function mask(width: number, height: number): LayerMask {
  return { id: 'm', enabled: true, data: new Uint8ClampedArray(width * height), width, height };
}

function masked(layer: Layer, width: number, height: number): Layer {
  return { ...layer, mask: mask(width, height) } as Layer;
}

function expectPoint(m: Affine, p: { x: number; y: number }, expected: { x: number; y: number }): void {
  const q = applyAffine(m, p);
  expect(q.x).toBeCloseTo(expected.x);
  expect(q.y).toBeCloseTo(expected.y);
}

describe('affine helpers', () => {
  it('inverts a composed map', () => {
    const m = composeAffine(translation(5, -3), composeAffine(documentRotation90('cw', 80, 60), scaling(2, 0.5)));
    const inv = invertAffine(m);
    expect(inv).not.toBeNull();
    expectPoint(composeAffine(inv!, m), { x: 17, y: 9 }, { x: 17, y: 9 });
  });

  it('rotates the document CW as (x, y) → (H − y, x) and CCW as (x, y) → (y, W − x)', () => {
    expectPoint(documentRotation90('cw', 800, 600), { x: 0, y: 0 }, { x: 600, y: 0 });
    expectPoint(documentRotation90('cw', 800, 600), { x: 800, y: 600 }, { x: 0, y: 800 });
    expectPoint(documentRotation90('ccw', 800, 600), { x: 0, y: 0 }, { x: 0, y: 800 });
    expectPoint(documentRotation90('ccw', 800, 600), { x: 800, y: 600 }, { x: 600, y: 0 });
  });

  it('flips a texture span onto its new placement', () => {
    // A 100-wide texture at x 50 moved to x 20: its left edge lands on 120.
    expectPoint(layerFlip('horizontal', 50, 20, 100), { x: 50, y: 7 }, { x: 120, y: 7 });
    expectPoint(layerFlip('horizontal', 50, 20, 100), { x: 150, y: 7 }, { x: 20, y: 7 });
    expectPoint(layerFlip('vertical', 10, 10, 40), { x: 3, y: 10 }, { x: 3, y: 50 });
  });

  it('turns a texture about its placements', () => {
    const cw = layerRotation90('cw', { x: 10, y: 20 }, { x: 100, y: 200 }, 40, 30);
    // Texture-local top-left (0, 0) → (H, 0) of the turned texture.
    expectPoint(cw, { x: 10, y: 20 }, { x: 130, y: 200 });
    expectPoint(cw, { x: 50, y: 50 }, { x: 100, y: 240 });
    const ccw = layerRotation90('ccw', { x: 10, y: 20 }, { x: 100, y: 200 }, 40, 30);
    expectPoint(ccw, { x: 10, y: 20 }, { x: 100, y: 240 });
    expectPoint(ccw, { x: 50, y: 50 }, { x: 130, y: 200 });
  });
});

describe('planMaskRemap (#1357)', () => {
  it('halves a document-anchored raster mask with Image Size', () => {
    const before = masked(createRasterLayer({ name: 'r', width: 800, height: 600 }), 800, 600);
    const after = { ...before, width: 400, height: 300 } as Layer;
    const plan = planMaskRemap(before, after, scaling(0.5, 0.5), 400, 300);
    expect(plan).not.toBeNull();
    expect(plan!.width).toBe(400);
    expect(plan!.height).toBe(300);
    // New texel (200, 150) samples old (400, 300).
    expectPoint(plan!.inverse, { x: 200, y: 150 }, { x: 400, y: 300 });
  });

  it('crops a document-anchored mask to the crop rect', () => {
    const before = masked(createRasterLayer({ name: 'r', width: 800, height: 600 }), 800, 600);
    const plan = planMaskRemap(before, before, translation(-100, -50), 300, 200);
    expect(plan).toMatchObject({ width: 300, height: 200 });
    expectPoint(plan!.inverse, { x: 0, y: 0 }, { x: 100, y: 50 });
  });

  it('rebuilds a group mask at the rotated document size', () => {
    const before = masked(createGroupLayer({ name: 'g' }), 800, 600);
    const plan = planMaskRemap(before, before, documentRotation90('cw', 800, 600), 600, 800);
    expect(plan).toMatchObject({ width: 600, height: 800 });
    // New top-right corner came from the old top-left.
    expectPoint(plan!.inverse, { x: 600, y: 0 }, { x: 0, y: 0 });
  });

  it('leaves a text mask alone when the layer moved with the crop', () => {
    const before = masked({ ...createTextLayer({ name: 't', text: 'hi' }), x: 300, y: 200 } as Layer, 800, 600);
    const after = { ...before, x: 200, y: 150 } as Layer;
    expect(planMaskRemap(before, after, translation(-100, -50), 500, 400)).toBeNull();
  });

  it('scales a text mask from the layer origin', () => {
    const before = masked({ ...createTextLayer({ name: 't', text: 'hi' }), x: 100, y: 60 } as Layer, 800, 600);
    const after = { ...before, x: 50, y: 30 } as Layer;
    const plan = planMaskRemap(before, after, scaling(0.5, 0.5), 400, 300);
    expect(plan).toMatchObject({ width: 400, height: 300 });
    expectPoint(plan!.inverse, { x: 10, y: 10 }, { x: 20, y: 20 });
  });

  it('returns null for a layer without a mask', () => {
    const layer = createRasterLayer({ name: 'r', width: 10, height: 10 });
    expect(planMaskRemap(layer, layer, scaling(2, 2), 20, 20)).toBeNull();
  });
});
