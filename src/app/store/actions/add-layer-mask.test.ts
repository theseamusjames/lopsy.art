// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeAddLayerMask } from './add-layer-mask';
import { createRasterLayer } from '../../../layers/layer-model';
import type { DocumentState, Layer } from '../../../types';

function makeDoc(): DocumentState {
  const layer = createRasterLayer({ name: 'Layer 1', width: 8, height: 6 });
  return {
    id: 'doc-1',
    name: 'Test',
    width: 100,
    height: 100,
    layers: [layer],
    layerOrder: [layer.id],
    activeLayerId: layer.id,
    selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
  };
}

describe('computeAddLayerMask', () => {
  it('returns undefined when layer not found', () => {
    const doc = makeDoc();
    const result = computeAddLayerMask(doc, 0, 'nonexistent-id');
    expect(result).toBeUndefined();
  });

  it('creates a document-sized raster mask filled with 255', () => {
    const doc = makeDoc();
    const layerId = doc.layers[0]!.id;
    const result = computeAddLayerMask(doc, 0, layerId)!;
    const layer = result.document!.layers.find((l) => l.id === layerId)!;
    expect(layer.mask).not.toBeNull();
    expect(layer.mask!.width).toBe(100);
    expect(layer.mask!.height).toBe(100);
    expect(layer.mask!.enabled).toBe(true);
    for (let i = 0; i < layer.mask!.data.length; i++) {
      expect(layer.mask!.data[i]).toBe(255);
    }
  });

  // #907: a moved / cropped raster layer's own box is not where its mask is
  // sampled — raster masks are doc-anchored, so the mask must cover the doc.
  it('sizes a moved, cropped raster layer mask to the document', () => {
    const doc = makeDoc();
    const moved = { ...doc.layers[0]!, x: 65, y: 34, width: 40, height: 9 } as Layer;
    const result = computeAddLayerMask({ ...doc, layers: [moved] }, 0, moved.id)!;
    const layer = result.document!.layers.find((l) => l.id === moved.id)!;
    expect(layer.mask!.width).toBe(100);
    expect(layer.mask!.height).toBe(100);
  });
});
