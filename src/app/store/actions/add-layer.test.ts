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
    const result = computeAddLayer(doc);
    expect(result.document!.layers).toHaveLength(2);
  });

  it('adds to layerOrder', () => {
    const doc = makeDoc();
    const result = computeAddLayer(doc);
    expect(result.document!.layerOrder).toHaveLength(2);
  });

  it('sets new layer as active', () => {
    const doc = makeDoc();
    const result = computeAddLayer(doc);
    const newLayer = result.document!.layers[1]!;
    expect(result.document!.activeLayerId).toBe(newLayer.id);
  });

  it('does not include layerPixelData in result', () => {
    const doc = makeDoc();
    const result = computeAddLayer(doc);
    expect(result.layerPixelData).toBeUndefined();
  });
});
