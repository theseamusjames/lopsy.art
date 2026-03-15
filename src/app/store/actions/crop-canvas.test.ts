// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeCropCanvas } from './crop-canvas';
import { createRasterLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';

function makeDoc(): { doc: DocumentState; pixelData: Map<string, ImageData> } {
  const layer = createRasterLayer({ name: 'Background', width: 10, height: 10 });
  const pixelData = new Map<string, ImageData>();
  const imgData = new ImageData(10, 10);
  // Fill pixel at (2,3) with red
  const idx = (3 * 10 + 2) * 4;
  imgData.data[idx] = 255;
  imgData.data[idx + 3] = 255;
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

describe('computeCropCanvas', () => {
  it('updates document dimensions to crop rect', () => {
    const { doc, pixelData } = makeDoc();
    const result = computeCropCanvas(doc, pixelData, 0, { x: 0, y: 0, width: 5, height: 5 })!;
    expect(result.document!.width).toBe(5);
    expect(result.document!.height).toBe(5);
  });

  it('crops layer pixel data correctly', () => {
    const { doc, pixelData } = makeDoc();
    // Crop to region that includes pixel (2,3)
    const result = computeCropCanvas(doc, pixelData, 0, { x: 1, y: 2, width: 4, height: 4 })!;
    const layerId = doc.layers[0]!.id;
    const cropped = result.layerPixelData!.get(layerId)!;
    // Pixel (2,3) in original -> (1,1) in cropped (offset by crop x=1, y=2)
    const ci = (1 * 4 + 1) * 4;
    expect(cropped.data[ci]).toBe(255);
    expect(cropped.data[ci + 3]).toBe(255);
  });

  it('returns undefined for zero-size crop', () => {
    const { doc, pixelData } = makeDoc();
    const result = computeCropCanvas(doc, pixelData, 0, { x: 0, y: 0, width: 0, height: 5 });
    expect(result).toBeUndefined();
  });
});
