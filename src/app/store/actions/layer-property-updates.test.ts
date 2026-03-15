// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import {
  computeSetActiveLayer,
  computeToggleVisibility,
  computeUpdateOpacity,
  computeUpdatePosition,
  computeUpdateEffects,
  computeToggleMask,
  computeUpdateMaskData,
} from './layer-property-updates';
import { createRasterLayer, DEFAULT_EFFECTS } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';
import type { Layer } from '../../../types/layers';
import type { LayerMask } from '../../../types/effects';

function makeDoc(): DocumentState {
  const layer = createRasterLayer({ name: 'Layer 1', width: 10, height: 10 });
  return {
    id: 'doc-1',
    name: 'Test',
    width: 100,
    height: 100,
    layers: [layer],
    layerOrder: [layer.id],
    activeLayerId: layer.id,
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
  };
}

function makeDocWithMask(enabled: boolean): DocumentState {
  const layer = createRasterLayer({ name: 'Layer 1', width: 10, height: 10 });
  const mask: LayerMask = {
    id: 'mask-1',
    enabled,
    data: new Uint8ClampedArray(10 * 10).fill(255),
    width: 10,
    height: 10,
  };
  const layerWithMask = { ...layer, mask } as Layer;
  return {
    id: 'doc-1',
    name: 'Test',
    width: 100,
    height: 100,
    layers: [layerWithMask],
    layerOrder: [layer.id],
    activeLayerId: layer.id,
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
  };
}

describe('computeSetActiveLayer', () => {
  it('changes activeLayerId', () => {
    const doc = makeDoc();
    const result = computeSetActiveLayer(doc, 'new-id');
    expect(result.document!.activeLayerId).toBe('new-id');
  });
});

describe('computeToggleVisibility', () => {
  it('flips visible', () => {
    const doc = makeDoc();
    const layerId = doc.layers[0]!.id;
    const result = computeToggleVisibility(doc, layerId);
    const layer = result.document!.layers.find((l) => l.id === layerId)!;
    expect(layer.visible).toBe(false);

    const result2 = computeToggleVisibility(result.document!, layerId);
    const layer2 = result2.document!.layers.find((l) => l.id === layerId)!;
    expect(layer2.visible).toBe(true);
  });
});

describe('computeUpdateOpacity', () => {
  it('sets opacity', () => {
    const doc = makeDoc();
    const layerId = doc.layers[0]!.id;
    const result = computeUpdateOpacity(doc, layerId, 0.5);
    const layer = result.document!.layers.find((l) => l.id === layerId)!;
    expect(layer.opacity).toBe(0.5);
  });
});

describe('computeUpdatePosition', () => {
  it('sets x/y and increments renderVersion', () => {
    const doc = makeDoc();
    const layerId = doc.layers[0]!.id;
    const result = computeUpdatePosition(doc, 3, layerId, 42, 99);
    const layer = result.document!.layers.find((l) => l.id === layerId)!;
    expect(layer.x).toBe(42);
    expect(layer.y).toBe(99);
    expect(result.renderVersion).toBe(4);
  });
});

describe('computeUpdateEffects', () => {
  it('sets effects and increments renderVersion', () => {
    const doc = makeDoc();
    const layerId = doc.layers[0]!.id;
    const newEffects = {
      ...DEFAULT_EFFECTS,
      stroke: { ...DEFAULT_EFFECTS.stroke, enabled: true },
    };
    const result = computeUpdateEffects(doc, 0, layerId, newEffects);
    const layer = result.document!.layers.find((l) => l.id === layerId)!;
    expect(layer.effects.stroke.enabled).toBe(true);
    expect(result.renderVersion).toBe(1);
  });
});

describe('computeToggleMask', () => {
  it('flips mask.enabled', () => {
    const doc = makeDocWithMask(true);
    const layerId = doc.layers[0]!.id;
    const result = computeToggleMask(doc, 0, layerId)!;
    const layer = result.document!.layers.find((l) => l.id === layerId)!;
    expect(layer.mask!.enabled).toBe(false);
  });

  it('returns undefined if no mask', () => {
    const doc = makeDoc();
    const layerId = doc.layers[0]!.id;
    const result = computeToggleMask(doc, 0, layerId);
    expect(result).toBeUndefined();
  });
});

describe('computeUpdateMaskData', () => {
  it('sets mask.data', () => {
    const doc = makeDocWithMask(true);
    const layerId = doc.layers[0]!.id;
    const newData = new Uint8ClampedArray(10 * 10).fill(128);
    const result = computeUpdateMaskData(doc, 0, layerId, newData);
    const layer = result.document!.layers.find((l) => l.id === layerId)!;
    expect(layer.mask!.data[0]).toBe(128);
    expect(result.renderVersion).toBe(1);
  });
});
