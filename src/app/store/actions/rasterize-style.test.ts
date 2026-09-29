// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect, vi } from 'vitest';
import { computeRasterizeStyle, canRasterizeLayerStyle } from './rasterize-style';
import { createRasterLayer, DEFAULT_EFFECTS } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';
import type { LayerEffects } from '../../../types/effects';

const mocks = vi.hoisted(() => ({ engine: null as object | null }));

vi.mock('../../../engine-wasm/engine-state', () => ({
  getEngine: () => mocks.engine,
  clearEngine: () => {},
}));

vi.mock('../../../engine-wasm/wasm-bridge', () => ({
  rasterizeLayerEffects: () => new Uint8Array(4 * 4 * 4),
  uploadLayerPixels: () => {},
}));

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

  // #1007: the bake multiplies the layer's opacity into its pixels, so the
  // layer must drop to opacity 1 or the composite applies it twice.
  it('resets the layer opacity to 1 after baking', () => {
    mocks.engine = {};
    const doc = makeDoc(enabledEffects());
    const halfOpacity: DocumentState = {
      ...doc,
      layers: doc.layers.map((l) => ({ ...l, opacity: 0.5, blendMode: 'multiply' as const })),
    };
    const result = computeRasterizeStyle(halfOpacity);
    mocks.engine = null;

    const layer = result!.document!.layers[0]!;
    expect(layer.opacity).toBe(1);
    expect(layer.blendMode).toBe('multiply');
    expect(layer.effects).toEqual(DEFAULT_EFFECTS);
  });
});

describe('canRasterizeLayerStyle', () => {
  it('is false when no active layer', () => {
    const doc = makeDoc(enabledEffects());
    expect(canRasterizeLayerStyle({ ...doc, activeLayerId: null })).toBe(false);
  });

  it('is false when no enabled effects', () => {
    const doc = makeDoc(DEFAULT_EFFECTS);
    expect(canRasterizeLayerStyle(doc)).toBe(false);
  });

  it('is false when no GPU engine available', () => {
    const doc = makeDoc(enabledEffects());
    // getEngine() returns null in unit tests — rasterize requires GPU
    expect(canRasterizeLayerStyle(doc)).toBe(false);
  });
});
