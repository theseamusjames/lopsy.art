// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeRemoveLayerMask } from './remove-layer-mask';
import { createRasterLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';
import type { LayerMask } from '../../../types/effects';
import type { Layer } from '../../../types/layers';

function makeDoc(hasMask: boolean): DocumentState {
  const layer = createRasterLayer({ name: 'Layer 1', width: 8, height: 6 });
  const mask: LayerMask | null = hasMask
    ? { id: 'mask-1', enabled: true, data: new Uint8ClampedArray(8 * 6).fill(255), width: 8, height: 6 }
    : null;
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

describe('computeRemoveLayerMask', () => {
  it('returns undefined when no mask exists', () => {
    const doc = makeDoc(false);
    const result = computeRemoveLayerMask(doc, 0, doc.layers[0]!.id);
    expect(result).toBeUndefined();
  });

  it('sets mask to null', () => {
    const doc = makeDoc(true);
    const layerId = doc.layers[0]!.id;
    const result = computeRemoveLayerMask(doc, 0, layerId)!;
    const layer = result.document!.layers.find((l) => l.id === layerId)!;
    expect(layer.mask).toBeNull();
  });
});
