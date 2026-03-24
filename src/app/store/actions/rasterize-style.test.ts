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

function makeDoc(effects: LayerEffects): { doc: DocumentState; pixelData: Map<string, ImageData> } {
  const layer = createRasterLayer({ name: 'Layer 1', width: 4, height: 4 });
  const layerWithEffects = { ...layer, effects };
  const pixelData = new Map<string, ImageData>();
  pixelData.set(layer.id, new ImageData(4, 4));
  return {
    doc: {
      id: 'doc-1',
      name: 'Test',
      width: 4,
      height: 4,
      layers: [layerWithEffects],
      layerOrder: [layer.id],
      activeLayerId: layer.id,
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    },
    pixelData,
  };
}

describe('computeRasterizeStyle', () => {
  it('returns undefined when no active layer', () => {
    const { doc, pixelData } = makeDoc(enabledEffects());
    const result = computeRasterizeStyle({ ...doc, activeLayerId: null }, pixelData);
    expect(result).toBeUndefined();
  });

  it('returns undefined when no enabled effects', () => {
    const { doc, pixelData } = makeDoc(DEFAULT_EFFECTS);
    const result = computeRasterizeStyle(doc, pixelData);
    expect(result).toBeUndefined();
  });

  it('returns undefined when no GPU engine available', () => {
    const { doc, pixelData } = makeDoc(enabledEffects());
    // getEngine() returns null in unit tests — rasterize requires GPU
    const result = computeRasterizeStyle(doc, pixelData);
    expect(result).toBeUndefined();
  });
});
