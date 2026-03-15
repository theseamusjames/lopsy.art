// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeAddLayer } from './add-layer';
import { createRasterLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';

function makeDoc(): DocumentState {
  const layer = createRasterLayer({ name: 'Background', width: 100, height: 100 });
  return {
    id: 'doc-1',
    name: 'Test',
    width: 100,
    height: 100,
    layers: [layer],
    layerOrder: [layer.id],
    activeLayerId: layer.id,
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
  };
}

describe('computeAddLayer', () => {
  it('adds a new layer to layers array', () => {
    const doc = makeDoc();
    const pixelData = new Map<string, ImageData>();
    const result = computeAddLayer(doc, pixelData);
    expect(result.document!.layers).toHaveLength(2);
  });

  it('adds to layerOrder', () => {
    const doc = makeDoc();
    const pixelData = new Map<string, ImageData>();
    const result = computeAddLayer(doc, pixelData);
    expect(result.document!.layerOrder).toHaveLength(2);
  });

  it('sets new layer as active', () => {
    const doc = makeDoc();
    const pixelData = new Map<string, ImageData>();
    const result = computeAddLayer(doc, pixelData);
    const newLayer = result.document!.layers[1]!;
    expect(result.document!.activeLayerId).toBe(newLayer.id);
  });

  it('creates empty pixel data for new layer', () => {
    const doc = makeDoc();
    const pixelData = new Map<string, ImageData>();
    const result = computeAddLayer(doc, pixelData);
    const newLayer = result.document!.layers[1]!;
    const data = result.layerPixelData!.get(newLayer.id)!;
    expect(data.width).toBe(100);
    expect(data.height).toBe(100);
    for (let i = 0; i < data.data.length; i++) {
      expect(data.data[i]).toBe(0);
    }
  });
});
