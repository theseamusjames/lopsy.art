// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeAlignLayer } from './align-layer';
import { createRasterLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';
import type { SelectionData } from '../types';

function makeDoc(): { doc: DocumentState; pixelData: Map<string, ImageData>; selection: SelectionData } {
  const layer = createRasterLayer({ name: 'Layer 1', width: 20, height: 20 });
  const pixelData = new Map<string, ImageData>();
  const imgData = new ImageData(20, 20);
  // Put an opaque pixel at (5, 5) so getContentBounds returns a result
  const idx = (5 * 20 + 5) * 4;
  imgData.data[idx + 3] = 255;
  pixelData.set(layer.id, imgData);
  return {
    doc: {
      id: 'doc-1',
      name: 'Test',
      width: 100,
      height: 100,
      layers: [layer],
      layerOrder: [layer.id],
      activeLayerId: layer.id,
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    },
    pixelData,
    selection: { active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 },
  };
}

describe('computeAlignLayer', () => {
  it('returns undefined when no active layer', () => {
    const { doc, pixelData, selection } = makeDoc();
    const result = computeAlignLayer({ ...doc, activeLayerId: null }, pixelData, selection, 0, 'left');
    expect(result).toBeUndefined();
  });

  it('aligns layer position to the left edge', () => {
    const { doc, pixelData, selection } = makeDoc();
    const result = computeAlignLayer(doc, pixelData, selection, 0, 'left')!;
    const layer = result.document!.layers[0]!;
    // Content is at pixel (5,5), so aligning left: x = -5
    expect(layer.x).toBe(-5);
  });

  it('aligns layer position to the right edge', () => {
    const { doc, pixelData, selection } = makeDoc();
    const result = computeAlignLayer(doc, pixelData, selection, 0, 'right')!;
    const layer = result.document!.layers[0]!;
    // Content bounds: x=5, width=1, canvas=100 -> x = 100 - 1 - 5 = 94
    expect(layer.x).toBe(94);
  });

  it('increments renderVersion', () => {
    const { doc, pixelData, selection } = makeDoc();
    const result = computeAlignLayer(doc, pixelData, selection, 3, 'left')!;
    expect(result.renderVersion).toBe(4);
  });
});
