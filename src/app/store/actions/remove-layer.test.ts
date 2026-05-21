// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeRemoveLayer } from './remove-layer';
import { createRasterLayer, createTextLayer, createGroupLayer } from '../../../layers/layer-model';
import type { DocumentState, Layer } from '../../../types';

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
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    },
    pixelData,
  };
}

describe('computeRemoveLayer', () => {
  it('returns undefined when only 1 layer', () => {
    const { doc, pixelData } = makeDoc(1);
    const result = computeRemoveLayer(doc, pixelData, new Map(), doc.layers[0]!.id);
    expect(result).toBeUndefined();
  });

  it('removes the layer and its pixel data', () => {
    const { doc, pixelData } = makeDoc(2);
    const removeId = doc.layers[0]!.id;
    const result = computeRemoveLayer(doc, pixelData, new Map(), removeId)!;
    expect(result.document!.layers).toHaveLength(1);
    expect(result.document!.layerOrder).not.toContain(removeId);
    expect(result.layerPixelData!.has(removeId)).toBe(false);
  });

  it('updates activeLayerId if removed layer was active', () => {
    const { doc, pixelData } = makeDoc(2);
    const activeId = doc.activeLayerId!;
    const result = computeRemoveLayer(doc, pixelData, new Map(), activeId)!;
    expect(result.document!.activeLayerId).not.toBe(activeId);
    expect(result.document!.layerOrder).toContain(result.document!.activeLayerId);
  });

  it('returns removedLayerIds = [id] for a leaf layer', () => {
    const { doc, pixelData } = makeDoc(2);
    const removeId = doc.layers[0]!.id;
    const result = computeRemoveLayer(doc, pixelData, new Map(), removeId)!;
    expect(result.removedLayerIds).toEqual([removeId]);
  });

  it('returns every descendant id when removing a group', () => {
    // Group → [text, raster]
    const text = createTextLayer({ name: 'T', text: 'A' });
    const raster = createRasterLayer({ name: 'R', width: 10, height: 10 });
    const sibling = createRasterLayer({ name: 'Sibling', width: 10, height: 10 });
    const group = createGroupLayer({ name: 'G', children: [text.id, raster.id] });

    const layers: Layer[] = [sibling, text, raster, group];
    const doc: DocumentState = {
      id: 'doc-1', name: 'Test',
      width: 10, height: 10,
      layers,
      layerOrder: [sibling.id, text.id, raster.id, group.id],
      activeLayerId: sibling.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    };

    const result = computeRemoveLayer(doc, new Map(), new Map(), group.id)!;
    expect(result.removedLayerIds).toBeDefined();
    const removed = new Set(result.removedLayerIds);
    // Group itself, plus both children.
    expect(removed).toEqual(new Set([group.id, text.id, raster.id]));
    // Sibling is untouched.
    expect(removed.has(sibling.id)).toBe(false);
    expect(result.document!.layers.find((l) => l.id === sibling.id)).toBeDefined();
  });
});
