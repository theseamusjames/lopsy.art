// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeRemoveLayer } from './remove-layer';
import { createRasterLayer, createGroupLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';
import { buildFlatDisplayList } from '../../../layers/group-utils';

function makeDoc(layerCount: number): DocumentState {
  const layers = Array.from({ length: layerCount }, (_, i) =>
    createRasterLayer({ name: `Layer ${i + 1}`, width: 50, height: 50 }),
  );
  const rootGroup = createGroupLayer({ name: 'Project', children: layers.map((l) => l.id) });
  return {
    id: 'doc-1',
    name: 'Test',
    width: 50,
    height: 50,
    layers: [...layers, rootGroup],
    layerOrder: [...layers.map((l) => l.id), rootGroup.id],
    activeLayerId: layers[layers.length - 1]!.id,
    selectedLayerIds: [layers[layers.length - 1]!.id],
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    colorMode: 'rgb',
    rootGroupId: rootGroup.id,
  };
}

// Helper: simulate selectLayerRange pure logic
function selectRange(doc: DocumentState, fromId: string, toId: string): string[] {
  const displayList = buildFlatDisplayList(doc.layers, doc.layerOrder);
  const ids = displayList.map((e) => e.layer.id);
  const fromIdx = ids.indexOf(fromId);
  const toIdx = ids.indexOf(toId);
  if (fromIdx === -1 || toIdx === -1) return [toId];
  const start = Math.min(fromIdx, toIdx);
  const end = Math.max(fromIdx, toIdx);
  return ids.slice(start, end + 1);
}

// Helper: simulate toggleLayerSelection pure logic
function toggleSelection(current: string[], id: string, activeId: string | null): string[] {
  const isSelected = current.includes(id);
  const next = isSelected ? current.filter((sid) => sid !== id) : [...current, id];
  return activeId && !next.includes(activeId) ? [activeId, ...next] : next;
}

describe('multi-select: range selection', () => {
  it('selects contiguous layers between two IDs', () => {
    const doc = makeDoc(3);
    const ids = doc.layers
      .filter((l) => l.type !== 'group')
      .map((l) => l.id);
    const [first, , third] = ids as [string, string, string];

    const range = selectRange(doc, first, third);
    // displayList is reversed (top to bottom), so all 3 layers should be in range
    expect(range.length).toBe(3);
    expect(range).toContain(first);
    expect(range).toContain(third);
  });

  it('returns single element when from === to', () => {
    const doc = makeDoc(3);
    const layerId = doc.layers[0]!.id;
    const range = selectRange(doc, layerId, layerId);
    expect(range).toHaveLength(1);
    expect(range[0]).toBe(layerId);
  });

  it('returns [toId] when fromId not found', () => {
    const doc = makeDoc(2);
    const toId = doc.layers[0]!.id;
    const range = selectRange(doc, 'nonexistent-id', toId);
    expect(range).toEqual([toId]);
  });
});

describe('multi-select: toggle selection', () => {
  it('adds a new layer to selection', () => {
    const current = ['a'];
    const result = toggleSelection(current, 'b', 'a');
    expect(result).toContain('a');
    expect(result).toContain('b');
  });

  it('removes a layer from selection', () => {
    const current = ['a', 'b'];
    const result = toggleSelection(current, 'b', 'a');
    expect(result).toContain('a');
    expect(result).not.toContain('b');
  });

  it('keeps active layer in selection when removing it would leave it out', () => {
    const current = ['a', 'b'];
    // Removing 'a' (which is also active) — active should remain
    const result = toggleSelection(current, 'a', 'a');
    // 'a' gets removed then re-added as active
    expect(result).toContain('a');
  });

  it('prevents selection from becoming empty by keeping active layer', () => {
    const current = ['a'];
    const result = toggleSelection(current, 'a', 'a');
    // After toggle, 'a' removed from list but active forces it back in
    expect(result).toContain('a');
  });
});

describe('multi-select: remove selected layers', () => {
  it('removes all selected layers and updates selectedLayerIds', () => {
    const doc = makeDoc(3);
    const [l1, l2, l3] = doc.layers.filter((l) => l.type !== 'group') as [
      ReturnType<typeof createRasterLayer>,
      ReturnType<typeof createRasterLayer>,
      ReturnType<typeof createRasterLayer>,
    ];

    // Select first two layers
    const docWithSelection: DocumentState = {
      ...doc,
      selectedLayerIds: [l1.id, l2.id],
      activeLayerId: l1.id,
    };

    // Remove them one by one (as removeSelectedLayers does)
    let currentDoc = docWithSelection;
    for (const id of [l1.id, l2.id]) {
      const result = computeRemoveLayer(
        currentDoc,
        new Map(),
        new Map(),
        id,
      );
      if (result?.document) {
        currentDoc = result.document as DocumentState;
      }
    }

    // Only l3 should remain (non-root-group raster layers)
    const rasterLayers = currentDoc.layers.filter((l) => l.type !== 'group');
    expect(rasterLayers).toHaveLength(1);
    expect(rasterLayers[0]!.id).toBe(l3.id);
  });

  it('keeps activeLayerId in selectedLayerIds after removal', () => {
    const doc = makeDoc(2);
    const [l1, l2] = doc.layers.filter((l) => l.type !== 'group') as [
      ReturnType<typeof createRasterLayer>,
      ReturnType<typeof createRasterLayer>,
    ];

    const result = computeRemoveLayer(
      { ...doc, activeLayerId: l1.id, selectedLayerIds: [l1.id, l2.id] },
      new Map(),
      new Map(),
      l2.id,
    );
    expect(result).toBeDefined();
    // l2 removed, l1 remains active; selectedLayerIds should contain activeLayerId
    expect(result!.document!.selectedLayerIds).toContain(result!.document!.activeLayerId!);
  });

  it('removed layer IDs are excluded from selectedLayerIds', () => {
    const doc = makeDoc(3);
    const [l1] = doc.layers.filter((l) => l.type !== 'group') as [ReturnType<typeof createRasterLayer>];

    const result = computeRemoveLayer(
      { ...doc, selectedLayerIds: [l1.id] },
      new Map(),
      new Map(),
      l1.id,
    );
    expect(result).toBeDefined();
    expect(result!.document!.selectedLayerIds).not.toContain(l1.id);
  });
});
