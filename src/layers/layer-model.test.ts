import { describe, it, expect } from 'vitest';
import {
  createRasterLayer,
  createTextLayer,
  createGroupLayer,
  reorderLayers,
  duplicateLayer,
  duplicateOffsetForLayer,
  updateLayer,
} from './layer-model';
import type { RasterLayer } from '../types';

describe('createRasterLayer', () => {
  it('creates a raster layer with unique ID', () => {
    const a = createRasterLayer({ name: 'Layer 1', width: 100, height: 100 });
    const b = createRasterLayer({ name: 'Layer 2', width: 100, height: 100 });
    expect(a.id).not.toBe(b.id);
    expect(a.type).toBe('raster');
    expect(a.name).toBe('Layer 1');
    expect(a.width).toBe(100);
    expect(a.visible).toBe(true);
    expect(a.opacity).toBe(1);
  });
});

describe('createTextLayer', () => {
  it('creates text layer with defaults', () => {
    const l = createTextLayer({ name: 'Text', text: 'Hello' });
    expect(l.type).toBe('text');
    expect(l.text).toBe('Hello');
    expect(l.fontFamily).toBe('Inter');
    expect(l.fontSize).toBe(24);
  });
});

describe('createGroupLayer', () => {
  it('creates empty group', () => {
    const g = createGroupLayer({ name: 'Group 1' });
    expect(g.type).toBe('group');
    expect(g.children).toEqual([]);
  });

  // Issue #523: pass-through groups attenuate each child's opacity individually
  // when the group's opacity is lowered, so an opaque top child no longer hides
  // the layer below it within the group. New groups default to normal (isolated)
  // compositing so group opacity behaves intuitively. Pass-through remains a
  // user-selectable blend mode for layouts that need it.
  it('defaults to normal (isolated) blend mode', () => {
    const g = createGroupLayer({ name: 'Group 1' });
    expect(g.blendMode).toBe('normal');
  });
});

describe('reorderLayers', () => {
  it('moves a layer from one position to another', () => {
    const layers = [
      createRasterLayer({ name: 'A', width: 1, height: 1 }),
      createRasterLayer({ name: 'B', width: 1, height: 1 }),
      createRasterLayer({ name: 'C', width: 1, height: 1 }),
    ];
    const result = reorderLayers(layers, 0, 2);
    expect(result[0]?.name).toBe('B');
    expect(result[1]?.name).toBe('C');
    expect(result[2]?.name).toBe('A');
  });
});

describe('duplicateLayer', () => {
  it('produces a new ID but same data', () => {
    const original = createRasterLayer({ name: 'Original', width: 50, height: 50 });
    const copy = duplicateLayer(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('Original copy');
    expect(copy.type).toBe('raster');
  });
});

describe('duplicateOffsetForLayer', () => {
  function rasterAt(x: number, y: number, w: number, h: number): RasterLayer {
    const base = createRasterLayer({ name: 'L', width: w, height: h });
    return { ...base, x, y };
  }

  it('shifts a fitting layer by (10, 10)', () => {
    expect(duplicateOffsetForLayer(rasterAt(0, 0, 100, 100), 1024, 1024))
      .toEqual({ dx: 10, dy: 10 });
  });

  // Issue #348: a layer wider than the canvas must not get a horizontal offset
  // — any positive shift would push the already-clipped right edge further off
  // the canvas, hiding more content.
  it('does not shift horizontally when layer is wider than canvas', () => {
    expect(duplicateOffsetForLayer(rasterAt(0, 50, 4000, 100), 1024, 1024))
      .toEqual({ dx: 0, dy: 10 });
  });

  it('does not shift vertically when layer is taller than canvas', () => {
    expect(duplicateOffsetForLayer(rasterAt(50, 0, 100, 4000), 1024, 1024))
      .toEqual({ dx: 10, dy: 0 });
  });

  it('clamps the shift so the duplicate edge does not pass the canvas edge', () => {
    expect(duplicateOffsetForLayer(rasterAt(919, 919, 100, 100), 1024, 1024))
      .toEqual({ dx: 5, dy: 5 });
  });

  it('does not shift when there is no room left on either axis', () => {
    expect(duplicateOffsetForLayer(rasterAt(924, 924, 100, 100), 1024, 1024))
      .toEqual({ dx: 0, dy: 0 });
  });

  it('does not shift when the layer is already off the canvas to the right', () => {
    expect(duplicateOffsetForLayer(rasterAt(2000, 50, 100, 100), 1024, 1024))
      .toEqual({ dx: 0, dy: 10 });
  });
});

describe('updateLayer', () => {
  it('preserves unmodified fields', () => {
    const layer = createRasterLayer({ name: 'Test', width: 100, height: 100 });
    const updated = updateLayer(layer, { name: 'Renamed', opacity: 0.5 });
    expect(updated.name).toBe('Renamed');
    expect(updated.opacity).toBe(0.5);
    expect(updated.width).toBe(100);
    expect(updated.id).toBe(layer.id);
  });
});
