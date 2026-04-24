// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeMoveLayer } from './move-layer';
import { createRasterLayer, createGroupLayer } from '../../../layers/layer-model';
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
 * Build a document with a group structure:
 *   layerOrder (bottom→top): [BG, L1, L2, L3, L4, G1, Root]
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
    // layerOrder: [BG, L1, L2, L3, L4, G1, Root]
    // Move G1 (index 5) to index 1 → block lands before L1
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
    // Start: [BG, L2, L3, L4, G1, L1, Root]  (group below L1)
    const reordered: DocumentState = {
      ...doc,
      layers: [bg, l2, l3, l4, g1, l1, root],
      layerOrder: [bg.id, l2.id, l3.id, l4.id, g1.id, l1.id, root.id],
    };
    // Move G1 (index 4) to index 5 → block moves above L1
    const result = computeMoveLayer(reordered, 0, 4, 5)!;
    expect(namesByOrder(result.document!)).toEqual([
      'BG', 'L1', 'L2', 'L3', 'L4', 'G1', 'Root',
    ]);
  });

  it('group block move to same position is a no-op', () => {
    const doc = makeGroupDoc();
    // G1 at index 5, target within the block → no change
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
