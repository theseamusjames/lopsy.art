// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeResizeCanvas } from './resize-canvas';
import { createRasterLayer, createTextLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';
import type { TextLayer } from '../../../types/layers';

function makeDoc(): { doc: DocumentState } {
  const layer = createRasterLayer({ name: 'Background', width: 4, height: 4 });
  return {
    doc: {
      id: 'doc-1',
      name: 'Test',
      width: 4,
      height: 4,
      layers: [layer],
      layerOrder: [layer.id],
      activeLayerId: layer.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    },
  };
}

describe('computeResizeCanvas', () => {
  it('updates document dimensions', () => {
    const { doc } = makeDoc();
    const result = computeResizeCanvas(doc, 0, 8, 6, 0, 0);
    expect(result.document!.width).toBe(8);
    expect(result.document!.height).toBe(6);
  });

  it('clears JS pixel data (GPU is source of truth)', () => {
    const { doc } = makeDoc();
    const result = computeResizeCanvas(doc, 0, 8, 4, 0.5, 0);
    expect(result.layerPixelData!.size).toBe(0);
  });

  it('offsets text layer position by canvas expansion without converting type', () => {
    const raster = createRasterLayer({ name: 'Background', width: 4, height: 4 });
    const textLayer = { ...createTextLayer({ name: 'Text 1', text: 'Hi' }), x: 1, y: 1 };
    const doc: DocumentState = {
      id: 'doc-1', name: 'Test', width: 4, height: 4,
      layers: [raster, textLayer],
      layerOrder: [raster.id, textLayer.id],
      activeLayerId: raster.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    };
    // Resize to 8x8, anchor top-left (0,0) → offsetX = 0, offsetY = 0
    const r1 = computeResizeCanvas(doc, 0, 8, 8, 0, 0);
    const t1 = r1.document!.layers.find((l) => l.id === textLayer.id)! as TextLayer;
    expect(t1.type).toBe('text');
    expect(t1.x).toBe(1); // no shift when anchor is top-left
    expect(t1.y).toBe(1);

    // Resize to 8x8, anchor center (0.5,0.5) → offsetX = 2, offsetY = 2
    const r2 = computeResizeCanvas(doc, 0, 8, 8, 0.5, 0.5);
    const t2 = r2.document!.layers.find((l) => l.id === textLayer.id)! as TextLayer;
    expect(t2.type).toBe('text');
    expect(t2.x).toBe(3); // 1 + 2
    expect(t2.y).toBe(3); // 1 + 2
  });
});
