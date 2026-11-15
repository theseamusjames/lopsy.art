// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeAddLayerMask } from './add-layer-mask';
import { createRasterLayer } from '../../../layers/layer-model';
import type { DocumentState, Layer } from '../../../types';
import type { SelectionData } from '../types';

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
  // #1545: an active selection becomes a reveal-selection mask.
  it('reveals only the selection when one is active', () => {
    const doc = makeDoc();
    const layerId = doc.layers[0]!.id;
    const mask = new Uint8ClampedArray(100 * 100);
    for (let y = 20; y < 40; y++) for (let x = 10; x < 30; x++) mask[y * 100 + x] = 255;
    mask[50 * 100 + 50] = 128;
    const selection: SelectionData = {
      active: true, bounds: { x: 10, y: 20, width: 20, height: 20 }, mask, maskWidth: 100, maskHeight: 100,
    };
    const result = computeAddLayerMask(doc, 0, layerId, selection)!;
    const m = result.document!.layers.find((l) => l.id === layerId)!.mask!;
    expect(m.data[25 * 100 + 15]).toBe(255);
    expect(m.data[5 * 100 + 5]).toBe(0);
    expect(m.data[50 * 100 + 50]).toBe(128);
    expect(m.data).not.toBe(mask);
  });

  it('offsets the selection into a shape layer mask box', () => {
    const doc = makeDoc();
    const shape = { ...doc.layers[0]!, type: 'shape', x: 10, y: 20, width: 5, height: 5 } as unknown as Layer;
    const mask = new Uint8ClampedArray(100 * 100);
    mask[20 * 100 + 10] = 255;
    const selection: SelectionData = {
      active: true, bounds: { x: 10, y: 20, width: 1, height: 1 }, mask, maskWidth: 100, maskHeight: 100,
    };
    const result = computeAddLayerMask({ ...doc, layers: [shape] }, 0, shape.id, selection)!;
    const m = result.document!.layers.find((l) => l.id === shape.id)!.mask!;
    expect(m.width).toBe(5);
    expect(m.data[0]).toBe(255);
    expect(m.data[1]).toBe(0);
  });
});
