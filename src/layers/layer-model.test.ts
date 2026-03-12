import { describe, it, expect } from 'vitest';
import {
  createRasterLayer,
  createTextLayer,
  createGroupLayer,
  reorderLayers,
  duplicateLayer,
  updateLayer,
} from './layer-model';

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
