// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeResizeCanvas } from './resize-canvas';
import { createRasterLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';

function makeDoc(): { doc: DocumentState; pixelData: Map<string, ImageData> } {
  const layer = createRasterLayer({ name: 'Background', width: 4, height: 4 });
  const pixelData = new Map<string, ImageData>();
  const imgData = new ImageData(4, 4);
  // Red pixel at (0,0)
  imgData.data[0] = 255;
  imgData.data[3] = 255;
  pixelData.set(layer.id, imgData);
  return {
    doc: {
      id: 'doc-1',
      name: 'Test',
      width: 4,
      height: 4,
      layers: [layer],
      layerOrder: [layer.id],
      activeLayerId: layer.id,
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    },
    pixelData,
  };
}

describe('computeResizeCanvas', () => {
  it('updates document dimensions', () => {
    const { doc, pixelData } = makeDoc();
    const result = computeResizeCanvas(doc, pixelData, 0, 8, 6, 0, 0);
    expect(result.document!.width).toBe(8);
    expect(result.document!.height).toBe(6);
  });

  it('applies anchor offset to pixel data', () => {
    const { doc, pixelData } = makeDoc();
    // anchorX=0.5 centers horizontally: offset = (8-4)*0.5 = 2
    const result = computeResizeCanvas(doc, pixelData, 0, 8, 4, 0.5, 0);
    const layerId = doc.layers[0]!.id;
    const resized = result.layerPixelData!.get(layerId)!;
    // Original (0,0) pixel should now be at (2,0)
    const di = (0 * 8 + 2) * 4;
    expect(resized.data[di]).toBe(255);
    expect(resized.data[di + 3]).toBe(255);
    // Original position (0,0) in new canvas should be empty
    expect(resized.data[0]).toBe(0);
  });
});
