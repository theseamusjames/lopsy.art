// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeRemoveLayer } from './remove-layer';
import { createRasterLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';

function makeDoc(layerCount: number): { doc: DocumentState; pixelData: Map<string, ImageData> } {
  const layers = Array.from({ length: layerCount }, (_, i) =>
    createRasterLayer({ name: `Layer ${i + 1}`, width: 50, height: 50 }),
  );
  const pixelData = new Map<string, ImageData>();
  for (const l of layers) {
    pixelData.set(l.id, new ImageData(50, 50));
  }
  return {
    doc: {
      id: 'doc-1',
      name: 'Test',
      width: 50,
      height: 50,
      layers,
      layerOrder: layers.map((l) => l.id),
      activeLayerId: layers[layers.length - 1]!.id,
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    },
    pixelData,
  };
}

describe('computeRemoveLayer', () => {
  it('returns undefined when only 1 layer', () => {
    const { doc, pixelData } = makeDoc(1);
    const result = computeRemoveLayer(doc, pixelData, doc.layers[0]!.id);
    expect(result).toBeUndefined();
  });

  it('removes the layer and its pixel data', () => {
    const { doc, pixelData } = makeDoc(2);
    const removeId = doc.layers[0]!.id;
    const result = computeRemoveLayer(doc, pixelData, removeId)!;
    expect(result.document!.layers).toHaveLength(1);
    expect(result.document!.layerOrder).not.toContain(removeId);
    expect(result.layerPixelData!.has(removeId)).toBe(false);
  });

  it('updates activeLayerId if removed layer was active', () => {
    const { doc, pixelData } = makeDoc(2);
    const activeId = doc.activeLayerId!;
    const result = computeRemoveLayer(doc, pixelData, activeId)!;
    expect(result.document!.activeLayerId).not.toBe(activeId);
    expect(result.document!.layerOrder).toContain(result.document!.activeLayerId);
  });
});
