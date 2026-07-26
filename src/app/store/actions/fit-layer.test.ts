// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeFitLayer } from './fit-layer';
import { createRasterLayer, createTextLayer } from '../../../layers/layer-model';
import type { DocumentState, RasterLayer } from '../../../types';

function makeDoc(opts: {
  layerWidth: number;
  layerHeight: number;
  layerX?: number;
  layerY?: number;
  docWidth?: number;
  docHeight?: number;
}): DocumentState {
  const docW = opts.docWidth ?? 1024;
  const docH = opts.docHeight ?? 1024;
  const base = createRasterLayer({ name: 'Pasted', width: opts.layerWidth, height: opts.layerHeight });
  const layer: RasterLayer = { ...base, x: opts.layerX ?? 0, y: opts.layerY ?? 0 };
  return {
    id: 'doc-1',
    name: 'Test',
    width: docW,
    height: docH,
    layers: [layer],
    layerOrder: [layer.id],
    activeLayerId: layer.id,
    selectedLayerIds: [layer.id],
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    colorMode: 'rgb',
  };
}

describe('computeFitLayer', () => {
  // Issue #347: pasted/dropped image overflows canvas — Fit shrinks it so the
  // longest side matches the canvas while preserving aspect ratio.
  it('shrinks an oversized wide layer to fit the canvas width', () => {
    const doc = makeDoc({ layerWidth: 4000, layerHeight: 2000 });
    const result = computeFitLayer(doc, 0)!;
    const layer = result.document!.layers[0]!;
    expect(layer.type === 'raster' && layer.width).toBe(1024);
    expect(layer.type === 'raster' && layer.height).toBe(512);
    expect(layer.x).toBe(0);
    expect(layer.y).toBe(256);
  });

  it('shrinks an oversized tall layer to fit the canvas height', () => {
    const doc = makeDoc({ layerWidth: 2000, layerHeight: 4000 });
    const result = computeFitLayer(doc, 0)!;
    const layer = result.document!.layers[0]!;
    expect(layer.type === 'raster' && layer.width).toBe(512);
    expect(layer.type === 'raster' && layer.height).toBe(1024);
    expect(layer.x).toBe(256);
    expect(layer.y).toBe(0);
  });

  it('returns undefined when no active layer', () => {
    const doc = makeDoc({ layerWidth: 100, layerHeight: 100 });
    const result = computeFitLayer({ ...doc, activeLayerId: null }, 0);
    expect(result).toBeUndefined();
  });

  it('returns undefined when active layer is not a raster layer', () => {
    const doc = makeDoc({ layerWidth: 100, layerHeight: 100 });
    const text = createTextLayer({ name: 'T', text: 'Hi' });
    const result = computeFitLayer(
      { ...doc, layers: [text], layerOrder: [text.id], activeLayerId: text.id },
      0,
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined when the layer already exactly fills the canvas', () => {
    const doc = makeDoc({ layerWidth: 1024, layerHeight: 1024 });
    expect(computeFitLayer(doc, 0)).toBeUndefined();
  });
});
