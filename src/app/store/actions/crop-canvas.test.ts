// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeCropCanvas } from './crop-canvas';
import { createRasterLayer, createTextLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';
import type { TextLayer } from '../../../types/layers';

function makeDoc(): { doc: DocumentState } {
  const layer = createRasterLayer({ name: 'Background', width: 10, height: 10 });
  return {
    doc: {
      id: 'doc-1',
      name: 'Test',
      width: 10,
      height: 10,
      layers: [layer],
      layerOrder: [layer.id],
      activeLayerId: layer.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    },
  };
}

describe('computeCropCanvas', () => {
  it('updates document dimensions to crop rect', () => {
    const { doc } = makeDoc();
    const result = computeCropCanvas(doc, 0, { x: 0, y: 0, width: 5, height: 5 })!;
    expect(result.document!.width).toBe(5);
    expect(result.document!.height).toBe(5);
  });

  it('clears JS pixel data (GPU is source of truth)', () => {
    const { doc } = makeDoc();
    const result = computeCropCanvas(doc, 0, { x: 1, y: 2, width: 4, height: 4 })!;
    expect(result.layerPixelData!.size).toBe(0);
  });

  it('returns undefined for zero-size crop', () => {
    const { doc } = makeDoc();
    const result = computeCropCanvas(doc, 0, { x: 0, y: 0, width: 0, height: 5 });
    expect(result).toBeUndefined();
  });

  it('adjusts text layer position by crop offset without converting type', () => {
    const raster = createRasterLayer({ name: 'Background', width: 100, height: 100 });
    const textLayer = { ...createTextLayer({ name: 'Text 1', text: 'Hi' }), x: 50, y: 60 };
    const doc: DocumentState = {
      id: 'doc-1', name: 'Test', width: 100, height: 100,
      layers: [raster, textLayer],
      layerOrder: [raster.id, textLayer.id],
      activeLayerId: raster.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    };
    const result = computeCropCanvas(doc, 0, { x: 20, y: 30, width: 80, height: 70 })!;
    const updated = result.document!.layers.find((l) => l.id === textLayer.id)! as TextLayer;
    expect(updated.type).toBe('text');
    expect(updated.x).toBe(30); // 50 - 20
    expect(updated.y).toBe(30); // 60 - 30
  });
});
