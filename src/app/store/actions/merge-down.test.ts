// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect, vi } from 'vitest';
import { computeMergeDown } from './merge-down';
import { createRasterLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';

// #746: computeMergeDown must not read the JS pixel map — it is a
// GPU-only operation.
vi.mock('../../../engine-wasm/engine-state', () => ({
  getEngine: () => null,
  clearEngine: () => {},
}));

function makeDoc(): DocumentState {
  const bottom = createRasterLayer({ name: 'Bottom', width: 4, height: 4 });
  const top = createRasterLayer({ name: 'Top', width: 4, height: 4 });
  return {
    id: 'doc-1',
    name: 'Test',
    width: 4,
    height: 4,
    layers: [bottom, top],
    layerOrder: [bottom.id, top.id],
    activeLayerId: top.id,
    selectedLayerIds: [],
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    colorMode: 'rgb',
  };
}

describe('computeMergeDown', () => {
  it('returns undefined when active layer is at bottom', () => {
    const doc = makeDoc();
    const bottomDoc = { ...doc, activeLayerId: doc.layerOrder[0]! };
    const result = computeMergeDown(bottomDoc);
    expect(result).toBeUndefined();
  });

  it('removes the top layer after merge', () => {
    const doc = makeDoc();
    const topId = doc.activeLayerId!;
    const result = computeMergeDown(doc)!;
    expect(result.document!.layers.find((l) => l.id === topId)).toBeUndefined();
    expect(result.document!.layerOrder).not.toContain(topId);
  });

  // #746: the compute is GPU-only — it invalidates the JS pixel cache
  // for the two touched layers directly, without returning a full-doc
  // pixel map for `applyActionResult` to replay.
  it('does not return a layerPixelData map (GPU-only)', () => {
    const doc = makeDoc();
    const result = computeMergeDown(doc)!;
    expect(result.layerPixelData).toBeUndefined();
  });
});
