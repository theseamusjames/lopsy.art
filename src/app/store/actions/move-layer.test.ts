// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeMoveLayer } from './move-layer';
import { createRasterLayer, createGroupLayer } from '../../../layers/layer-model';
import { isGroupLayer, getDescendantIds } from '../../../layers/group-utils';
import type { DocumentState, Layer } from '../../../types';

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

function namesByOrder(doc: DocumentState): string[] {
  const map = new Map(doc.layers.map((l) => [l.id, l]));
  return doc.layerOrder.map((id) => map.get(id)!.name);
}

/**
 * Verify that every group's members (the group + all descendants) form a
 * contiguous block in layerOrder with no non-members interleaved.
 */
function assertGroupBlocksContiguous(doc: DocumentState): void {
  const { layers, layerOrder } = doc;
  for (const layer of layers) {
    if (!isGroupLayer(layer)) continue;
    const memberIds = new Set([layer.id, ...getDescendantIds(layers, layer.id)]);
    const indices = layerOrder
      .map((id, i) => (memberIds.has(id) ? i : -1))
      .filter((i) => i !== -1);
    if (indices.length === 0) continue;
    const min = indices[0]!;
    const max = indices[indices.length - 1]!;
    for (let i = min; i <= max; i++) {
      const id = layerOrder[i]!;
      if (!memberIds.has(id)) {
        const intruder = layers.find((l) => l.id === id);
        const intruderName = intruder?.name ?? id;
        throw new Error(
          `Group "${layer.name}" block is not contiguous: ` +
          `"${intruderName}" at index ${i} is not a member but sits between members`,
        );
      }
    }
  }
}

/**
 * Build a document with a group structure:
 *   layerOrder (bottom->top): [BG, L1, L2, L3, L4, G1, Root]
 *   Root.children = [BG, L1, G1]
 *   G1.children = [L2, L3, L4]
 */
function makeGroupDoc(): DocumentState {
  const bg = createRasterLayer({ name: 'BG', width: 50, height: 50 });
  const l1 = createRasterLayer({ name: 'L1', width: 50, height: 50 });
  const l2 = createRasterLayer({ name: 'L2', width: 50, height: 50 });
  const l3 = createRasterLayer({ name: 'L3', width: 50, height: 50 });
  const l4 = createRasterLayer({ name: 'L4', width: 50, height: 50 });
  const g1 = createGroupLayer({ name: 'G1', children: [l2.id, l3.id, l4.id] });
  const rootGroup = createGroupLayer({ name: 'Root', children: [bg.id, l1.id, g1.id] });
  const layers: Layer[] = [bg, l1, l2, l3, l4, g1, rootGroup];
  return {
    id: 'doc-1',
    name: 'Test',
    width: 50,
    height: 50,
    layers,
    layerOrder: layers.map((l) => l.id),
    activeLayerId: bg.id,
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    rootGroupId: rootGroup.id,
  };
}

/**
 * Build a document with two sibling groups:
 *   layerOrder: [BG, L2, L3, G1, L4, L5, G2, L1, Root]
 *   Root.children = [BG, G1, G2, L1]
 *   G1.children = [L2, L3]
 *   G2.children = [L4, L5]
 */
function makeTwoGroupDoc(): DocumentState {
  const bg = createRasterLayer({ name: 'BG', width: 50, height: 50 });
  const l1 = createRasterLayer({ name: 'L1', width: 50, height: 50 });
  const l2 = createRasterLayer({ name: 'L2', width: 50, height: 50 });
  const l3 = createRasterLayer({ name: 'L3', width: 50, height: 50 });
  const l4 = createRasterLayer({ name: 'L4', width: 50, height: 50 });
  const l5 = createRasterLayer({ name: 'L5', width: 50, height: 50 });
  const g1 = createGroupLayer({ name: 'G1', children: [l2.id, l3.id] });
  const g2 = createGroupLayer({ name: 'G2', children: [l4.id, l5.id] });
  const rootGroup = createGroupLayer({ name: 'Root', children: [bg.id, g1.id, g2.id, l1.id] });
  const layers: Layer[] = [bg, l2, l3, g1, l4, l5, g2, l1, rootGroup];
  return {
    id: 'doc-1',
    name: 'Test',
    width: 50,
    height: 50,
    layers,
    layerOrder: layers.map((l) => l.id),
    activeLayerId: bg.id,
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    rootGroupId: rootGroup.id,
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

describe('computeMoveLayer — group block moves', () => {
  it('moves a group and all its children as a block downward', () => {
    const doc = makeGroupDoc();
    const result = computeMoveLayer(doc, 0, 5, 1)!;
    expect(namesByOrder(result.document!)).toEqual([
      'BG', 'L2', 'L3', 'L4', 'G1', 'L1', 'Root',
    ]);
  });

  it('moves a group and all its children as a block upward', () => {
    const doc = makeGroupDoc();
    const bg = doc.layers[0]!;
    const l1 = doc.layers[1]!;
    const l2 = doc.layers[2]!;
    const l3 = doc.layers[3]!;
    const l4 = doc.layers[4]!;
    const g1 = doc.layers[5]!;
    const root = doc.layers[6]!;
    const reordered: DocumentState = {
      ...doc,
      layers: [bg, l2, l3, l4, g1, l1, root],
      layerOrder: [bg.id, l2.id, l3.id, l4.id, g1.id, l1.id, root.id],
    };
    const result = computeMoveLayer(reordered, 0, 4, 5)!;
    expect(namesByOrder(result.document!)).toEqual([
      'BG', 'L1', 'L2', 'L3', 'L4', 'G1', 'Root',
    ]);
  });

  it('group block move to same position is a no-op', () => {
    const doc = makeGroupDoc();
    const result = computeMoveLayer(doc, 0, 5, 4)!;
    expect(namesByOrder(result.document!)).toEqual([
      'BG', 'L1', 'L2', 'L3', 'L4', 'G1', 'Root',
    ]);
  });

  it('preserves children order within the group block', () => {
    const doc = makeGroupDoc();
    const result = computeMoveLayer(doc, 0, 5, 0)!;
    const order = namesByOrder(result.document!);
    const g1Idx = order.indexOf('G1');
    const l2Idx = order.indexOf('L2');
    const l3Idx = order.indexOf('L3');
    const l4Idx = order.indexOf('L4');
    expect(l2Idx).toBeLessThan(l3Idx);
    expect(l3Idx).toBeLessThan(l4Idx);
    expect(l4Idx).toBeLessThan(g1Idx);
  });

  it('keeps layers array in sync with layerOrder after group move', () => {
    const doc = makeGroupDoc();
    const result = computeMoveLayer(doc, 0, 5, 1)!;
    const { layers, layerOrder } = result.document!;
    expect(layers.map((l) => l.id)).toEqual(layerOrder);
  });

  it('keeps layers array in sync with layerOrder after single move', () => {
    const doc = makeGroupDoc();
    const result = computeMoveLayer(doc, 0, 1, 0)!;
    const { layers, layerOrder } = result.document!;
    expect(layers.map((l) => l.id)).toEqual(layerOrder);
  });
});

describe('group block contiguity invariant', () => {
  it('holds for every possible toIndex when moving a non-group layer', () => {
    const doc = makeGroupDoc();
    // L1 is at index 1 (outside G1). Try moving it to every valid position.
    // layerOrder: [BG(0), L1(1), L2(2), L3(3), L4(4), G1(5), Root(6)]
    for (let to = 0; to < doc.layerOrder.length; to++) {
      if (to === 1) continue; // same position → no-op in caller
      const result = computeMoveLayer(doc, 0, 1, to);
      if (!result) continue;
      assertGroupBlocksContiguous(result.document!);
    }
  });

  it('holds for every possible toIndex when moving a group', () => {
    const doc = makeGroupDoc();
    // G1 is at index 5. Try moving it to every valid position.
    for (let to = 0; to < doc.layerOrder.length; to++) {
      if (to === 5) continue;
      const result = computeMoveLayer(doc, 0, 5, to);
      if (!result) continue;
      assertGroupBlocksContiguous(result.document!);
    }
  });

  it('holds with two sibling groups — moving layer to every position', () => {
    const doc = makeTwoGroupDoc();
    // L1 is at index 7 (outside both groups).
    // layerOrder: [BG(0), L2(1), L3(2), G1(3), L4(4), L5(5), G2(6), L1(7), Root(8)]
    for (let to = 0; to < doc.layerOrder.length; to++) {
      if (to === 7) continue;
      const result = computeMoveLayer(doc, 0, 7, to);
      if (!result) continue;
      assertGroupBlocksContiguous(result.document!);
    }
  });

  it('holds with two sibling groups — moving G1 to every position', () => {
    const doc = makeTwoGroupDoc();
    for (let to = 0; to < doc.layerOrder.length; to++) {
      if (to === 3) continue;
      const result = computeMoveLayer(doc, 0, 3, to);
      if (!result) continue;
      assertGroupBlocksContiguous(result.document!);
    }
  });

  it('holds with two sibling groups — moving G2 to every position', () => {
    const doc = makeTwoGroupDoc();
    for (let to = 0; to < doc.layerOrder.length; to++) {
      if (to === 6) continue;
      const result = computeMoveLayer(doc, 0, 6, to);
      if (!result) continue;
      assertGroupBlocksContiguous(result.document!);
    }
  });

  it('holds after successive moves', () => {
    let doc = makeGroupDoc();
    // Move L1 into G1, then move it back out, then move BG around
    const r1 = computeMoveLayer(doc, 0, 1, 3)!;
    doc = r1.document!;
    assertGroupBlocksContiguous(doc);

    const r2 = computeMoveLayer(doc, 0, 3, 0)!;
    doc = r2.document!;
    assertGroupBlocksContiguous(doc);

    const r3 = computeMoveLayer(doc, 0, 0, 4)!;
    doc = r3.document!;
    assertGroupBlocksContiguous(doc);
  });
});
