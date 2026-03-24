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

  it('creates single layer from multiple layers', () => {
    const { doc, pixelData } = makeDoc(2);
    const result = computeFlattenImage(doc, pixelData)!;
    expect(result.document!.layers).toHaveLength(1);
    expect(result.document!.layerOrder).toHaveLength(1);
    expect(result.document!.layers[0]!.name).toBe('Background');
  });

  it('clears JS pixel data (GPU is source of truth)', () => {
    const { doc, pixelData } = makeDoc(2);
    const result = computeFlattenImage(doc, pixelData)!;
    // No JS pixel data — compositing happens on GPU
    expect(result.layerPixelData!.size).toBe(0);
  });
});
