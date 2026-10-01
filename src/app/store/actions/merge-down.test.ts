// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect, vi } from 'vitest';
import { computeMergeDown, canMergeDown } from './merge-down';
import { createRasterLayer, createTextLayer, createGroupLayer, DEFAULT_EFFECTS } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';

const mocks = vi.hoisted(() => ({
  engine: null as object | null,
  updateLayer: vi.fn<(engine: unknown, json: string) => void>(),
  mergeLayers: vi.fn(),
  rasterizeLayerEffects: vi.fn((..._args: unknown[]) => new Uint8Array(4 * 4 * 4)),
}));

// #746: computeMergeDown must not read the JS pixel map — it is a
// GPU-only operation.
vi.mock('../../../engine-wasm/engine-state', () => ({
  getEngine: () => mocks.engine,
  clearEngine: () => {},
}));

vi.mock('../../../engine-wasm/wasm-bridge', () => ({
  mergeLayers: mocks.mergeLayers,
  rasterizeLayerEffects: mocks.rasterizeLayerEffects,
  updateLayer: mocks.updateLayer,
  uploadLayerPixels: () => {},
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

  // #920: the bottom child of a group has no sibling below it within
  // the group, so its only "layerOrder neighbor" is whatever sits below
  // the group itself, outside it. Merging into that layer would pull
  // the active layer out of the group entirely, silently discarding the
  // group's visibility/opacity/blend-mode/adjustments (and, if the
  // group was hidden, un-hiding the merged content).
  it('returns undefined (no-op) for the bottom child of a group with nothing below it in the same parent', () => {
    const belowGroup = createRasterLayer({ name: 'Layer 1', width: 4, height: 4 });
    const child = createRasterLayer({ name: 'Child', width: 4, height: 4 });
    const group = createGroupLayer({ name: 'Group', children: [child.id] });
    const doc: DocumentState = {
      id: 'doc-1',
      name: 'Test',
      width: 4,
      height: 4,
      // layerOrder is a flat bottom-to-top stack: belowGroup, then the
      // group's child, then the group marker itself.
      layers: [belowGroup, child, group],
      layerOrder: [belowGroup.id, child.id, group.id],
      activeLayerId: child.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    };

    const result = computeMergeDown(doc);
    expect(result).toBeUndefined();
  });

  it('leaves the document layers and layerOrder untouched when there is no valid same-parent target', () => {
    const belowGroup = createRasterLayer({ name: 'Layer 1', width: 4, height: 4 });
    const child = createRasterLayer({ name: 'Child', width: 4, height: 4 });
    const group = createGroupLayer({ name: 'Group', children: [child.id] });
    const doc: DocumentState = {
      id: 'doc-1',
      name: 'Test',
      width: 4,
      height: 4,
      layers: [belowGroup, child, group],
      layerOrder: [belowGroup.id, child.id, group.id],
      activeLayerId: child.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    };

    computeMergeDown(doc);
    expect(doc.layers).toHaveLength(3);
    expect(doc.layerOrder).toEqual([belowGroup.id, child.id, group.id]);
    expect(group.children).toEqual([child.id]);
  });

  // A sibling below the active layer within the same group is still a
  // valid merge target — only crossing out of the group is refused.
  it('merges normally between two siblings inside the same group', () => {
    const bottomChild = createRasterLayer({ name: 'BottomChild', width: 4, height: 4 });
    const topChild = createRasterLayer({ name: 'TopChild', width: 4, height: 4 });
    const group = createGroupLayer({ name: 'Group', children: [topChild.id, bottomChild.id] });
    const doc: DocumentState = {
      id: 'doc-1',
      name: 'Test',
      width: 4,
      height: 4,
      layers: [bottomChild, topChild, group],
      layerOrder: [bottomChild.id, topChild.id, group.id],
      activeLayerId: topChild.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    };

    const result = computeMergeDown(doc);
    expect(result).toBeDefined();
    expect(result!.document!.layers.find((l) => l.id === topChild.id)).toBeUndefined();
    expect(result!.document!.layers.find((l) => l.id === bottomChild.id)).toBeDefined();
  });
});

describe('canMergeDown', () => {
  it('is true when the layer below the active layer is raster and shares its parent', () => {
    const doc = makeDoc();
    expect(canMergeDown(doc)).toBe(true);
  });

  it('is false when the active layer is at the bottom', () => {
    const doc = makeDoc();
    const bottomDoc = { ...doc, activeLayerId: doc.layerOrder[0]! };
    expect(canMergeDown(bottomDoc)).toBe(false);
  });

  it('is false when there is no active layer', () => {
    const doc = makeDoc();
    expect(canMergeDown({ ...doc, activeLayerId: null })).toBe(false);
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

  // #920
  it('is false for the bottom child of a group when nothing below it shares its parent', () => {
    const belowGroup = createRasterLayer({ name: 'Layer 1', width: 4, height: 4 });
    const child = createRasterLayer({ name: 'Child', width: 4, height: 4 });
    const group = createGroupLayer({ name: 'Group', children: [child.id] });
    const doc: DocumentState = {
      id: 'doc-1',
      name: 'Test',
      width: 4,
      height: 4,
      layers: [belowGroup, child, group],
      layerOrder: [belowGroup.id, child.id, group.id],
      activeLayerId: child.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    };
    expect(canMergeDown(doc)).toBe(false);
  });

  it('is true for a sibling below the active layer inside the same group', () => {
    const bottomChild = createRasterLayer({ name: 'BottomChild', width: 4, height: 4 });
    const topChild = createRasterLayer({ name: 'TopChild', width: 4, height: 4 });
    const group = createGroupLayer({ name: 'Group', children: [topChild.id, bottomChild.id] });
    const doc: DocumentState = {
      id: 'doc-1',
      name: 'Test',
      width: 4,
      height: 4,
      layers: [bottomChild, topChild, group],
      layerOrder: [bottomChild.id, topChild.id, group.id],
      activeLayerId: topChild.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    };
    expect(canMergeDown(doc)).toBe(true);
  });
});

describe('computeMergeDown with effects (#1007)', () => {
  it('sends the baked layer to the merge at opacity 1', () => {
    mocks.engine = {};
    mocks.updateLayer.mockClear();
    const doc = makeDoc();
    const topId = doc.activeLayerId!;
    const effects = { ...DEFAULT_EFFECTS, innerGlow: { ...DEFAULT_EFFECTS.innerGlow, enabled: true } };
    const withEffect: DocumentState = {
      ...doc,
      layers: doc.layers.map((l) => (l.id === topId ? { ...l, opacity: 0.5, effects } : l)),
    };

    computeMergeDown(withEffect);
    mocks.engine = null;

    expect(mocks.mergeLayers).toHaveBeenCalled();
    expect(mocks.updateLayer).toHaveBeenCalledTimes(1);
    const desc = JSON.parse(mocks.updateLayer.mock.calls[0]![1]) as { id: string; opacity: number };
    expect(desc.id).toBe(topId);
    expect(desc.opacity).toBe(1);
  });

  it('bakes the upper layer\'s mask with its effects and drops it from the merge', () => {
    mocks.engine = {};
    mocks.updateLayer.mockClear();
    mocks.rasterizeLayerEffects.mockClear();
    const doc = makeDoc();
    const topId = doc.activeLayerId!;
    const effects = { ...DEFAULT_EFFECTS, dropShadow: { ...DEFAULT_EFFECTS.dropShadow, enabled: true } };
    const mask = { id: 'm', enabled: true, width: 4, height: 4, data: new Uint8ClampedArray(16) };
    const withMask: DocumentState = {
      ...doc,
      layers: doc.layers.map((l) => (l.id === topId ? { ...l, effects, mask } : l)),
    };

    computeMergeDown(withMask);
    mocks.engine = null;

    expect(mocks.rasterizeLayerEffects).toHaveBeenCalledWith(expect.anything(), topId, true);
    const desc = JSON.parse(mocks.updateLayer.mock.calls[0]![1]) as { id: string; mask: unknown };
    expect(desc.id).toBe(topId);
    expect(desc.mask ?? null).toBeNull();
  });
});

describe('computeMergeDown keeps the lower layer\'s style (#1068)', () => {
  function withBottom(patch: Record<string, unknown>): { doc: DocumentState; bottomId: string } {
    const doc = makeDoc();
    const bottomId = doc.layerOrder[0]!;
    return {
      bottomId,
      doc: { ...doc, layers: doc.layers.map((l) => (l.id === bottomId ? { ...l, ...patch } : l)) },
    };
  }

  function mergedBottom(doc: DocumentState, bottomId: string) {
    mocks.engine = {};
    mocks.mergeLayers.mockClear();
    mocks.updateLayer.mockClear();
    const result = computeMergeDown(doc);
    mocks.engine = null;
    const merged = result!.document!.layers.find((l) => l.id === bottomId)!;
    return { merged, mergeArgs: mocks.mergeLayers.mock.calls[0] as unknown[] };
  }

  it('keeps the lower layer\'s blend mode and bakes its opacity when it has no effects', () => {
    const { doc, bottomId } = withBottom({ blendMode: 'multiply', opacity: 0.4 });
    const { merged, mergeArgs } = mergedBottom(doc, bottomId);
    expect(merged.blendMode).toBe('multiply');
    expect(merged.opacity).toBe(1);
    expect(mergeArgs[3]).toBe(true);
  });

  it('keeps the lower layer\'s effects and opacity live when it has effects', () => {
    const effects = { ...DEFAULT_EFFECTS, stroke: { ...DEFAULT_EFFECTS.stroke, enabled: true } };
    const { doc, bottomId } = withBottom({ blendMode: 'screen', opacity: 0.4, effects });
    const { merged, mergeArgs } = mergedBottom(doc, bottomId);
    expect(merged.blendMode).toBe('screen');
    expect(merged.opacity).toBe(0.4);
    expect(merged.effects.stroke.enabled).toBe(true);
    expect(mergeArgs[3]).toBe(false);
    // The lower layer's effects stay live, so nothing is baked into it.
    expect(mocks.updateLayer).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining(bottomId));
  });

  it('keeps the lower text layer\'s style when the merge rasterizes it', () => {
    const effects = { ...DEFAULT_EFFECTS, dropShadow: { ...DEFAULT_EFFECTS.dropShadow, enabled: true } };
    const doc = makeDoc();
    const text = createTextLayer({ name: 'Title', text: 'Hi' });
    const textDoc: DocumentState = {
      ...doc,
      layers: [{ ...text, blendMode: 'overlay', opacity: 0.7, effects }, doc.layers[1]!],
      layerOrder: [text.id, doc.layerOrder[1]!],
    };
    const { merged } = mergedBottom(textDoc, text.id);
    expect(merged.type).toBe('raster');
    expect(merged.blendMode).toBe('overlay');
    expect(merged.opacity).toBe(0.7);
    expect(merged.effects.dropShadow.enabled).toBe(true);
  });
});
