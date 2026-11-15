import { describe, it, expect } from 'vitest';
import type { Layer, GroupLayer, RasterLayer } from '../types';
import { createRasterLayer, createGroupLayer } from './layer-model';
import {
  buildLayerIndex,
  isEffectivelyVisible,
  getLayerDepth,
  isAncestorOf,
} from './layer-index';

function raster(id: string, visible = true): RasterLayer {
  const base = createRasterLayer({ name: id, width: 100, height: 100 });
  return { ...base, id, visible };
}

function group(id: string, children: string[], visible = true): GroupLayer {
  const base = createGroupLayer({ name: id, children });
  return { ...base, id, visible };
}

describe('buildLayerIndex', () => {
  it('maps ids to layers', () => {
    const a = raster('a');
    const b = raster('b');
    const index = buildLayerIndex([a, b]);
    expect(index.byId.get('a')).toBe(a);
    expect(index.byId.get('b')).toBe(b);
  });

  it('records parent for children of groups', () => {
    const a = raster('a');
    const b = raster('b');
    const g = group('g', ['a', 'b']);
    const index = buildLayerIndex([a, b, g]);
    expect(index.parentOf.get('a')).toBe('g');
    expect(index.parentOf.get('b')).toBe('g');
    expect(index.parentOf.get('g')).toBe(null);
  });

  it('handles nested groups', () => {
    const a = raster('a');
    const inner = group('inner', ['a']);
    const outer = group('outer', ['inner']);
    const layers: Layer[] = [a, inner, outer];
    const index = buildLayerIndex(layers);
    expect(index.parentOf.get('a')).toBe('inner');
    expect(index.parentOf.get('inner')).toBe('outer');
    expect(index.parentOf.get('outer')).toBe(null);
  });
});

describe('isEffectivelyVisible', () => {
  it('returns true for a visible root layer', () => {
    const a = raster('a');
    const index = buildLayerIndex([a]);
    expect(isEffectivelyVisible(index, 'a')).toBe(true);
  });

  it('returns false when the layer itself is hidden', () => {
    const a = raster('a', false);
    const index = buildLayerIndex([a]);
    expect(isEffectivelyVisible(index, 'a')).toBe(false);
  });

  it('returns false when an ancestor group is hidden', () => {
    const a = raster('a');
    const g = group('g', ['a'], false);
    const index = buildLayerIndex([a, g]);
    expect(isEffectivelyVisible(index, 'a')).toBe(false);
  });

  it('returns true when layer and all ancestors are visible', () => {
    const a = raster('a');
    const inner = group('inner', ['a']);
    const outer = group('outer', ['inner']);
    const index = buildLayerIndex([a, inner, outer]);
    expect(isEffectivelyVisible(index, 'a')).toBe(true);
  });

  it('returns false when a deep ancestor is hidden', () => {
    const a = raster('a');
    const inner = group('inner', ['a']);
    const outer = group('outer', ['inner'], false);
    const index = buildLayerIndex([a, inner, outer]);
    expect(isEffectivelyVisible(index, 'a')).toBe(false);
  });

  it('returns false for a missing layer id', () => {
    const index = buildLayerIndex([raster('a')]);
    expect(isEffectivelyVisible(index, 'missing')).toBe(false);
  });
});

describe('getLayerDepth', () => {
  it('is 0 for root layers', () => {
    const a = raster('a');
    const index = buildLayerIndex([a]);
    expect(getLayerDepth(index, 'a')).toBe(0);
  });

  it('increments once per ancestor group', () => {
    const a = raster('a');
    const inner = group('inner', ['a']);
    const outer = group('outer', ['inner']);
    const index = buildLayerIndex([a, inner, outer]);
    expect(getLayerDepth(index, 'a')).toBe(2);
    expect(getLayerDepth(index, 'inner')).toBe(1);
    expect(getLayerDepth(index, 'outer')).toBe(0);
  });
});

describe('isAncestorOf', () => {
  it('is true for direct parent', () => {
    const a = raster('a');
    const g = group('g', ['a']);
    const index = buildLayerIndex([a, g]);
    expect(isAncestorOf(index, 'g', 'a')).toBe(true);
  });

  it('is true for indirect ancestor', () => {
    const a = raster('a');
    const inner = group('inner', ['a']);
    const outer = group('outer', ['inner']);
    const index = buildLayerIndex([a, inner, outer]);
    expect(isAncestorOf(index, 'outer', 'a')).toBe(true);
  });

  it('is false for a sibling', () => {
    const a = raster('a');
    const b = raster('b');
    const g = group('g', ['a', 'b']);
    const index = buildLayerIndex([a, b, g]);
    expect(isAncestorOf(index, 'a', 'b')).toBe(false);
  });

  it('is false for self', () => {
    const a = raster('a');
    const index = buildLayerIndex([a]);
    expect(isAncestorOf(index, 'a', 'a')).toBe(false);
  });
});
