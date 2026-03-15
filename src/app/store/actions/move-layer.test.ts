// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeMoveLayer } from './move-layer';
import { createRasterLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';

function makeDoc(): DocumentState {
  const layers = [
    createRasterLayer({ name: 'Layer 1', width: 50, height: 50 }),
    createRasterLayer({ name: 'Layer 2', width: 50, height: 50 }),
    createRasterLayer({ name: 'Layer 3', width: 50, height: 50 }),
  ];
  return {
    id: 'doc-1',
    name: 'Test',
    width: 50,
    height: 50,
    layers,
    layerOrder: layers.map((l) => l.id),
    activeLayerId: layers[0]!.id,
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
  };
}

describe('computeMoveLayer', () => {
  it('reorders both layers and layerOrder arrays', () => {
    const doc = makeDoc();
    const result = computeMoveLayer(doc, 0, 0, 2)!;
    expect(result.document!.layers[2]!.name).toBe('Layer 1');
    expect(result.document!.layerOrder[2]).toBe(doc.layers[0]!.id);
  });

  it('returns undefined for invalid indices', () => {
    const doc = makeDoc();
    const result = computeMoveLayer(doc, 0, 10, 0);
    expect(result).toBeUndefined();
  });

  it('increments renderVersion', () => {
    const doc = makeDoc();
    const result = computeMoveLayer(doc, 5, 0, 1)!;
    expect(result.renderVersion).toBe(6);
  });
});
