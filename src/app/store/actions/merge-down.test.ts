// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeMergeDown } from './merge-down';
import { createRasterLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';

function makeDoc(): { doc: DocumentState; pixelData: Map<string, ImageData> } {
  const bottom = createRasterLayer({ name: 'Bottom', width: 4, height: 4 });
  const top = createRasterLayer({ name: 'Top', width: 4, height: 4 });
  const pixelData = new Map<string, ImageData>();
  const bottomData = new ImageData(4, 4);
  const topData = new ImageData(4, 4);
  // Fill top layer pixel 0 with opaque red
  topData.data[0] = 255;
  topData.data[3] = 255;
  pixelData.set(bottom.id, bottomData);
  pixelData.set(top.id, topData);
  return {
    doc: {
      id: 'doc-1',
      name: 'Test',
      width: 4,
      height: 4,
      layers: [bottom, top],
      layerOrder: [bottom.id, top.id],
      activeLayerId: top.id,
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    },
    pixelData,
  };
}

describe('computeMergeDown', () => {
  it('returns undefined when active layer is at bottom', () => {
    const { doc, pixelData } = makeDoc();
    const bottomDoc = { ...doc, activeLayerId: doc.layerOrder[0]! };
    const result = computeMergeDown(bottomDoc, pixelData);
    expect(result).toBeUndefined();
  });

  it('removes the top layer after merge', () => {
    const { doc, pixelData } = makeDoc();
    const topId = doc.activeLayerId!;
    const result = computeMergeDown(doc, pixelData)!;
    expect(result.document!.layers.find((l) => l.id === topId)).toBeUndefined();
    expect(result.document!.layerOrder).not.toContain(topId);
    expect(result.layerPixelData!.has(topId)).toBe(false);
  });

  it('result pixel data contains composited content', () => {
    const { doc, pixelData } = makeDoc();
    const bottomId = doc.layerOrder[0]!;
    const result = computeMergeDown(doc, pixelData)!;
    const mergedData = result.layerPixelData!.get(bottomId)!;
    // Top layer had opaque red at pixel 0 — composited onto empty bottom
    expect(mergedData.data[0]).toBe(255);
    expect(mergedData.data[3]).toBe(255);
  });
});
