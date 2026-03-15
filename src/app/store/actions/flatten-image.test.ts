// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeFlattenImage } from './flatten-image';
import { createRasterLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';

function makeDoc(layerCount: number): { doc: DocumentState; pixelData: Map<string, ImageData> } {
  const layers = Array.from({ length: layerCount }, (_, i) =>
    createRasterLayer({ name: `Layer ${i + 1}`, width: 4, height: 4 }),
  );
  const pixelData = new Map<string, ImageData>();
  for (const l of layers) {
    pixelData.set(l.id, new ImageData(4, 4));
  }
  return {
    doc: {
      id: 'doc-1',
      name: 'Test',
      width: 4,
      height: 4,
      layers,
      layerOrder: layers.map((l) => l.id),
      activeLayerId: layers[0]!.id,
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    },
    pixelData,
  };
}

describe('computeFlattenImage', () => {
  it('returns undefined when only 1 layer', () => {
    const { doc, pixelData } = makeDoc(1);
    const result = computeFlattenImage(doc, pixelData);
    expect(result).toBeUndefined();
  });

  it('creates single layer with all visible layers composited', () => {
    const { doc, pixelData } = makeDoc(2);
    // Put opaque blue pixel in layer 2
    const layer2Data = pixelData.get(doc.layers[1]!.id)!;
    layer2Data.data[2] = 255;
    layer2Data.data[3] = 255;

    const result = computeFlattenImage(doc, pixelData)!;
    expect(result.document!.layers).toHaveLength(1);
    expect(result.document!.layerOrder).toHaveLength(1);
    const flatId = result.document!.layers[0]!.id;
    const flatData = result.layerPixelData!.get(flatId)!;
    // Background is white, blue composited on top
    expect(flatData.data[3]).toBe(255);
  });

  it('skips invisible layers', () => {
    const { doc, pixelData } = makeDoc(2);
    // Make layer 2 invisible and put red in it
    const layer2 = doc.layers[1]!;
    const hiddenDoc = {
      ...doc,
      layers: [doc.layers[0]!, { ...layer2, visible: false }],
    };
    const layer2Data = pixelData.get(layer2.id)!;
    layer2Data.data[0] = 255;
    layer2Data.data[3] = 255;

    const result = computeFlattenImage(hiddenDoc, pixelData)!;
    const flatId = result.document!.layers[0]!.id;
    const flatData = result.layerPixelData!.get(flatId)!;
    // Pixel 0 should be white bg, not red from hidden layer
    expect(flatData.data[0]).toBe(255);
    expect(flatData.data[1]).toBe(255);
    expect(flatData.data[2]).toBe(255);
  });
});
