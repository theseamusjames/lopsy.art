// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeDuplicateLayer } from './duplicate-layer';
import { createRasterLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';

function makeDoc(): { doc: DocumentState; pixelData: Map<string, ImageData> } {
  const layer = createRasterLayer({ name: 'Background', width: 10, height: 10 });
  const pixelData = new Map<string, ImageData>();
  const imgData = new ImageData(10, 10);
  imgData.data[0] = 200;
  imgData.data[1] = 100;
  pixelData.set(layer.id, imgData);
  return {
    doc: {
      id: 'doc-1',
      name: 'Test',
      width: 10,
      height: 10,
      layers: [layer],
      layerOrder: [layer.id],
      activeLayerId: layer.id,
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    },
    pixelData,
  };
}

describe('computeDuplicateLayer', () => {
  it('returns undefined when no active layer', () => {
    const { doc, pixelData } = makeDoc();
    const result = computeDuplicateLayer({ ...doc, activeLayerId: null }, pixelData);
    expect(result).toBeUndefined();
  });

  it('creates a new layer with cloned pixel data', () => {
    const { doc, pixelData } = makeDoc();
    const result = computeDuplicateLayer(doc, pixelData)!;
    const newLayerId = result.document!.activeLayerId!;
    expect(newLayerId).not.toBe(doc.activeLayerId);
    const cloned = result.layerPixelData!.get(newLayerId)!;
    expect(cloned.data[0]).toBe(200);
    expect(cloned.data[1]).toBe(100);
    // Verify it's a clone, not the same reference
    expect(cloned).not.toBe(pixelData.get(doc.activeLayerId!));
  });

  it('inserts after the original in layerOrder', () => {
    const { doc, pixelData } = makeDoc();
    const result = computeDuplicateLayer(doc, pixelData)!;
    const order = result.document!.layerOrder;
    const origIdx = order.indexOf(doc.activeLayerId!);
    const newIdx = order.indexOf(result.document!.activeLayerId!);
    expect(newIdx).toBe(origIdx + 1);
  });
});
