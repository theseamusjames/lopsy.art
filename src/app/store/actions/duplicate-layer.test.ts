// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeDuplicateLayer } from './duplicate-layer';
import { createRasterLayer } from '../../../layers/layer-model';
import type { DocumentState, RasterLayer } from '../../../types';

function makeDoc(opts?: {
  layerWidth?: number;
  layerHeight?: number;
  layerX?: number;
  layerY?: number;
  docWidth?: number;
  docHeight?: number;
}): { doc: DocumentState; pixelData: Map<string, ImageData> } {
  const layerW = opts?.layerWidth ?? 10;
  const layerH = opts?.layerHeight ?? 10;
  const docW = opts?.docWidth ?? 1024;
  const docH = opts?.docHeight ?? 1024;
  const baseLayer = createRasterLayer({ name: 'Background', width: layerW, height: layerH });
  const layer: RasterLayer = { ...baseLayer, x: opts?.layerX ?? 0, y: opts?.layerY ?? 0 };
  const pixelData = new Map<string, ImageData>();
  const imgData = new ImageData(layerW, layerH);
  imgData.data[0] = 200;
  imgData.data[1] = 100;
  pixelData.set(layer.id, imgData);
  return {
    doc: {
      id: 'doc-1',
      name: 'Test',
      width: docW,
      height: docH,
      layers: [layer],
      layerOrder: [layer.id],
      activeLayerId: layer.id,
      selectedLayerIds: [layer.id],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    },
    pixelData,
  };
}

describe('computeDuplicateLayer', () => {
  it('returns undefined when no active layer', () => {
    const { doc, pixelData } = makeDoc();
    const result = computeDuplicateLayer({ ...doc, activeLayerId: null }, pixelData);
    expect(result).toBeUndefined();
  });

  it('creates a new layer in the document', () => {
    const { doc, pixelData } = makeDoc();
    const result = computeDuplicateLayer(doc, pixelData)!;
    const newLayerId = result.document!.activeLayerId!;
    expect(newLayerId).not.toBe(doc.activeLayerId);
    expect(result.document!.layers).toHaveLength(2);
  });

  it('inserts after the original in layerOrder', () => {
    const { doc, pixelData } = makeDoc();
    const r = result(doc, pixelData);
    const origIdx = r.layerOrder.indexOf(doc.activeLayerId!);
    const newIdx = r.layerOrder.indexOf(r.activeLayerId!);
    expect(newIdx).toBe(origIdx + 1);
  });

  it('offsets a layer that fits comfortably within the canvas', () => {
    const { doc, pixelData } = makeDoc({
      layerWidth: 100, layerHeight: 100, layerX: 50, layerY: 50,
      docWidth: 1024, docHeight: 1024,
    });
    const dup = newLayer(doc, pixelData);
    expect(dup.x).toBe(60);
    expect(dup.y).toBe(60);
  });

  // Regression for issue #348: a wide layer (wider than the canvas) must not
  // get an offset that pushes its already-clipped edge further off the canvas.
  it('does not offset a layer wider than the canvas', () => {
    const { doc, pixelData } = makeDoc({
      layerWidth: 4000, layerHeight: 100, layerX: 0, layerY: 50,
      docWidth: 1024, docHeight: 1024,
    });
    const dup = newLayer(doc, pixelData);
    expect(dup.x).toBe(0);
    // Y axis fits, so it still gets the small visual offset.
    expect(dup.y).toBe(60);
  });

  it('does not offset a layer taller than the canvas', () => {
    const { doc, pixelData } = makeDoc({
      layerWidth: 100, layerHeight: 4000, layerX: 50, layerY: 0,
      docWidth: 1024, docHeight: 1024,
    });
    const dup = newLayer(doc, pixelData);
    expect(dup.x).toBe(60);
    expect(dup.y).toBe(0);
  });

  it('clamps the offset so the duplicate edge does not pass the canvas edge', () => {
    // Layer's right edge is 5px from the canvas edge — only 5px of horizontal
    // shift is allowed before the duplicate would clip.
    const { doc, pixelData } = makeDoc({
      layerWidth: 100, layerHeight: 100, layerX: 919, layerY: 919,
      docWidth: 1024, docHeight: 1024,
    });
    const dup = newLayer(doc, pixelData);
    expect(dup.x).toBe(924);
    expect(dup.y).toBe(924);
  });

  it('does not offset when layer is already at the far edge', () => {
    const { doc, pixelData } = makeDoc({
      layerWidth: 100, layerHeight: 100, layerX: 924, layerY: 924,
      docWidth: 1024, docHeight: 1024,
    });
    const dup = newLayer(doc, pixelData);
    expect(dup.x).toBe(924);
    expect(dup.y).toBe(924);
  });
});

function result(doc: DocumentState, pixelData: Map<string, ImageData>): DocumentState {
  return computeDuplicateLayer(doc, pixelData)!.document!;
}

function newLayer(doc: DocumentState, pixelData: Map<string, ImageData>) {
  const r = result(doc, pixelData);
  const dup = r.layers.find((l) => l.id === r.activeLayerId);
  if (!dup) throw new Error('duplicate not found');
  return dup;
}
