// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect, vi } from 'vitest';
import { computeMergeDown, canMergeDown } from './merge-down';
import { createRasterLayer, createTextLayer, createGroupLayer } from '../../../layers/layer-model';
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

  // #859: merging onto a text layer must not leave the result as
  // `type: 'text'` with stale text properties — the merged content is a
  // raster composite, and a later text-tool edit would otherwise re-typeset
  // over it and discard the merge.
  it('converts the result to raster when the bottom (surviving) layer is text', () => {
    const bottom = createTextLayer({ name: 'Bottom', text: 'TOP' });
    const top = createRasterLayer({ name: 'Top', width: 4, height: 4 });
    const doc: DocumentState = {
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

    const result = computeMergeDown(doc)!;
    const merged = result.document!.layers.find((l) => l.id === bottom.id)!;
    expect(merged.type).toBe('raster');
    expect((merged as { text?: string }).text).toBeUndefined();
    expect(merged.x).toBe(0);
    expect(merged.y).toBe(0);
    expect((merged as { width: number }).width).toBe(doc.width);
    expect((merged as { height: number }).height).toBe(doc.height);
  });

  it('converts the result to raster when the top (merged-away) layer is text', () => {
    const bottom = createRasterLayer({ name: 'Bottom', width: 4, height: 4 });
    const top = createTextLayer({ name: 'Top', text: 'BOTTOM' });
    const doc: DocumentState = {
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

    const result = computeMergeDown(doc)!;
    const merged = result.document!.layers.find((l) => l.id === bottom.id)!;
    expect(merged.type).toBe('raster');
    expect((merged as { text?: string }).text).toBeUndefined();
  });

  it('leaves a raster-onto-raster merge as raster with no text fields', () => {
    const doc = makeDoc();
    const bottomId = doc.layerOrder[0]!;
    const result = computeMergeDown(doc)!;
    const merged = result.document!.layers.find((l) => l.id === bottomId)!;
    expect(merged.type).toBe('raster');
  });

  // #879: merging onto a group must never silently drop the active
  // layer's pixels — there is no raster texture on the other side to
  // composite into, so the operation must refuse entirely.
  it('returns undefined (no-op) when the layer below is a group', () => {
    const group = createGroupLayer({ name: 'Group' });
    const top = createRasterLayer({ name: 'Top', width: 4, height: 4 });
    const doc: DocumentState = {
      id: 'doc-1',
      name: 'Test',
      width: 4,
      height: 4,
      layers: [group, top],
      layerOrder: [group.id, top.id],
      activeLayerId: top.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    };

    const result = computeMergeDown(doc);
    expect(result).toBeUndefined();
  });

  it('leaves the document layers and layerOrder untouched when the target is a group', () => {
    const group = createGroupLayer({ name: 'Group' });
    const top = createRasterLayer({ name: 'Top', width: 4, height: 4 });
    const doc: DocumentState = {
      id: 'doc-1',
      name: 'Test',
      width: 4,
      height: 4,
      layers: [group, top],
      layerOrder: [group.id, top.id],
      activeLayerId: top.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    };

    computeMergeDown(doc);
    // computeMergeDown must not mutate the doc it was given either.
    expect(doc.layers).toHaveLength(2);
    expect(doc.layerOrder).toEqual([group.id, top.id]);
  });
});

describe('canMergeDown', () => {
  it('is true when the layer below the active layer is raster', () => {
    const doc = makeDoc();
    expect(canMergeDown(doc)).toBe(true);
  });

  it('is false when the active layer is at the bottom', () => {
    const doc = makeDoc();
    const bottomDoc = { ...doc, activeLayerId: doc.layerOrder[0]! };
    expect(canMergeDown(bottomDoc)).toBe(false);
  });

  it('is false when the layer below is a group', () => {
    const group = createGroupLayer({ name: 'Group' });
    const top = createRasterLayer({ name: 'Top', width: 4, height: 4 });
    const doc: DocumentState = {
      id: 'doc-1',
      name: 'Test',
      width: 4,
      height: 4,
      layers: [group, top],
      layerOrder: [group.id, top.id],
      activeLayerId: top.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    };
    expect(canMergeDown(doc)).toBe(false);
  });

  it('is false when there is no active layer', () => {
    const doc = makeDoc();
    expect(canMergeDown({ ...doc, activeLayerId: null })).toBe(false);
  });
});
