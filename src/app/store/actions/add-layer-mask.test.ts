// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeAddLayerMask } from './add-layer-mask';
import { createRasterLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';

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
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
  };
}

describe('computeAddLayerMask', () => {
  it('returns undefined when layer not found', () => {
    const doc = makeDoc();
    const result = computeAddLayerMask(doc, 0, 'nonexistent-id');
    expect(result).toBeUndefined();
  });

  it('creates mask with correct dimensions filled with 255', () => {
    const doc = makeDoc();
    const layerId = doc.layers[0]!.id;
    const result = computeAddLayerMask(doc, 0, layerId)!;
    const layer = result.document!.layers.find((l) => l.id === layerId)!;
    expect(layer.mask).not.toBeNull();
    expect(layer.mask!.width).toBe(8);
    expect(layer.mask!.height).toBe(6);
    expect(layer.mask!.enabled).toBe(true);
    for (let i = 0; i < layer.mask!.data.length; i++) {
      expect(layer.mask!.data[i]).toBe(255);
    }
  });
});
