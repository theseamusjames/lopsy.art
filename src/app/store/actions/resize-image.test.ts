// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeResizeImage } from './resize-image';
import { createRasterLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';
import type { RasterLayer } from '../../../types/layers';

function makeDoc(): { doc: DocumentState; pixelData: Map<string, ImageData> } {
  const layer = { ...createRasterLayer({ name: 'Background', width: 10, height: 10 }), x: 2, y: 4 };
  const pixelData = new Map<string, ImageData>();
  pixelData.set(layer.id, new ImageData(10, 10));
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

describe('computeResizeImage', () => {
  it('scales document and all layer dimensions', () => {
    const { doc, pixelData } = makeDoc();
    const result = computeResizeImage(doc, pixelData, 0, 20, 20);
    expect(result.document!.width).toBe(20);
    expect(result.document!.height).toBe(20);
    const layer = result.document!.layers[0]! as RasterLayer;
    expect(layer.width).toBe(20);
    expect(layer.height).toBe(20);
  });

  it('scales layer positions', () => {
    const { doc, pixelData } = makeDoc();
    const result = computeResizeImage(doc, pixelData, 0, 20, 20);
    const layer = result.document!.layers[0]!;
    // scaleX = 2, scaleY = 2
    expect(layer.x).toBe(4); // 2 * 2
    expect(layer.y).toBe(8); // 4 * 2
  });
});
