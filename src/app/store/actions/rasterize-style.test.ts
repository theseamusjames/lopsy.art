// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeRasterizeStyle } from './rasterize-style';
import { createRasterLayer, DEFAULT_EFFECTS } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';
import type { LayerEffects } from '../../../types/effects';

function enabledEffects(): LayerEffects {
  return {
    ...DEFAULT_EFFECTS,
    stroke: { ...DEFAULT_EFFECTS.stroke, enabled: true },
  };
}

function makeDoc(effects: LayerEffects): DocumentState {
  const layer = createRasterLayer({ name: 'Layer 1', width: 4, height: 4 });
  const layerWithEffects = { ...layer, effects };
  return {
    id: 'doc-1',
    name: 'Test',
    width: 4,
    height: 4,
    layers: [layerWithEffects],
    layerOrder: [layer.id],
    activeLayerId: layer.id,
    selectedLayerIds: [],
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    colorMode: 'rgb',
  };
}

describe('computeRasterizeStyle', () => {
  it('returns undefined when no active layer', () => {
    const doc = makeDoc(enabledEffects());
    const result = computeRasterizeStyle({ ...doc, activeLayerId: null });
    expect(result).toBeUndefined();
  });

  it('returns undefined when no enabled effects', () => {
    const doc = makeDoc(DEFAULT_EFFECTS);
    const result = computeRasterizeStyle(doc);
    expect(result).toBeUndefined();
  });

  it('returns undefined when no GPU engine available', () => {
    const doc = makeDoc(enabledEffects());
    // getEngine() returns null in unit tests — rasterize requires GPU
    const result = computeRasterizeStyle(doc);
    expect(result).toBeUndefined();
  });
});
