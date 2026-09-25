// @vitest-environment jsdom
import '../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { resolveGapDrop, currentDropTarget } from './useLayerDnd';
import { computeDropLayer } from '../../app/store/actions/drop-layer';
import { buildFlatDisplayList, findParentGroup, getDescendantIds, isGroupLayer } from '../../layers/group-utils';
import { createRasterLayer, createGroupLayer } from '../../layers/layer-model';
import type { DocumentState, GroupLayer, Layer } from '../../types';

/**
 * Tiny tree builder. `spec` lists layers bottom→top (layerOrder order);
 * a group entry's children must appear before it.
 */
interface Spec {
  name: string;
  children?: string[];
  collapsed?: boolean;
}

function buildDoc(spec: Spec[], layersOrder?: string[]): DocumentState {
  const byName = new Map<string, Layer>();
  for (const s of spec) {
    if (s.children) continue;
    byName.set(s.name, createRasterLayer({ name: s.name, width: 10, height: 10 }));
  }
  for (const s of spec) {
    if (!s.children) continue;
    const g = createGroupLayer({
      name: s.name,
      children: s.children.map((c) => byName.get(c)!.id),
    });
    byName.set(s.name, { ...g, collapsed: s.collapsed ?? false } as GroupLayer);
  }
  const ordered = spec.map((s) => byName.get(s.name)!);
  const root = ordered[ordered.length - 1]!;
  const layers = layersOrder ? layersOrder.map((n) => byName.get(n)!) : ordered;
  return {
    id: 'doc',
    name: 'Test',
    width: 10,
    height: 10,
    layers,
    layerOrder: ordered.map((l) => l.id),
    activeLayerId: root.id,
    selectedLayerIds: [],
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    colorMode: 'rgb',
    rootGroupId: root.id,
  };
}

function idOf(doc: DocumentState, name: string): string {
  return doc.layers.find((l) => l.name === name)!.id;
}

function nameOf(doc: DocumentState, id: string): string {
  return doc.layers.find((l) => l.id === id)!.name;
}

/** Panel rows top→bottom, indented by depth: e.g. ["Project", " G2", "  B"]. */
function panel(doc: DocumentState): string[] {
  return buildFlatDisplayList(doc.layers, doc.layerOrder)
    .map((e) => `${' '.repeat(e.depth)}${e.layer.name}`);
}

function parentName(doc: DocumentState, name: string): string | null {
  const p = findParentGroup(doc.layers, idOf(doc, name));
  return p ? p.name : null;
}

/**
 * Drag the row named `dragged` into display gap `gap` with an indicator
 * depth of `desiredDepth`, exactly as the Layers panel does on pointerup.
 * Returns the new document, or null for a no-op drop.
 */
function drag(doc: DocumentState, dragged: string, gap: number, desiredDepth: number): DocumentState | null {
  const display = buildFlatDisplayList(doc.layers, doc.layerOrder);
  const draggedId = idOf(doc, dragged);
  const slot = resolveGapDrop(doc.layers, display, draggedId, gap, desiredDepth);
  if (!slot) return null;
  const current = currentDropTarget(doc.layers, doc.layerOrder, draggedId);
  if (current && current.parentId === slot.target.parentId && current.belowId === slot.target.belowId) {
    return null;
  }
  const result = computeDropLayer(doc, 0, draggedId, slot.target);
  return result?.document ?? null;
}

function assertTreeMatchesOrder(doc: DocumentState): void {
  const rank = new Map(doc.layerOrder.map((id, i) => [id, i]));
  for (const layer of doc.layers) {
    if (!isGroupLayer(layer)) continue;
    const members = [layer.id, ...getDescendantIds(doc.layers, layer.id)];
    const idx = members.map((id) => rank.get(id)!).sort((a, b) => a - b);
    // Contiguous block, with the group itself on top of its subtree.
    expect(idx[idx.length - 1]! - idx[0]! + 1).toBe(members.length);
    expect(rank.get(layer.id)).toBe(idx[idx.length - 1]);
    // children[] is bottom→top like layerOrder.
    const childRanks = layer.children.map((c) => rank.get(c)!);
    expect([...childRanks].sort((a, b) => a - b)).toEqual(childRanks);
  }
  expect(doc.layers.map((l) => l.id)).toEqual(doc.layerOrder);
}

describe('layer panel drop in the gap below a group (#814)', () => {
  // Panel: Project, G2, B, X, Layer 1, Background
  const doc = buildDoc([
    { name: 'Background' },
    { name: 'Layer 1' },
    { name: 'X' },
    { name: 'B' },
    { name: 'G2', children: ['B'] },
    { name: 'Project', children: ['Background', 'Layer 1', 'X', 'G2'] },
  ]);

  it('drops at root directly above X when the indicator is at root depth', () => {
    // gap 3 = between B and X; Layer 1 is a root child (depth 1).
    const next = drag(doc, 'Layer 1', 3, 1)!;
    expect(panel(next)).toEqual([
      'Project', ' G2', '  B', ' Layer 1', ' X', ' Background',
    ]);
    expect(parentName(next, 'Layer 1')).toBe('Project');
    assertTreeMatchesOrder(next);
  });

  it('drops at the BOTTOM of the group (not the top) at group depth', () => {
    const next = drag(doc, 'Layer 1', 3, 2)!;
    expect(panel(next)).toEqual([
      'Project', ' G2', '  B', '  Layer 1', ' X', ' Background',
    ]);
    expect(parentName(next, 'Layer 1')).toBe('G2');
    assertTreeMatchesOrder(next);
  });

  it('clamps the indicator depth to what the gap can hold', () => {
    // Too deep → the deepest valid slot (bottom of G2); too shallow → root.
    expect(resolveGapDrop(doc.layers, buildFlatDisplayList(doc.layers, doc.layerOrder), idOf(doc, 'Layer 1'), 3, 9)!.depth).toBe(2);
    expect(resolveGapDrop(doc.layers, buildFlatDisplayList(doc.layers, doc.layerOrder), idOf(doc, 'Layer 1'), 3, -4)!.depth).toBe(1);
  });
});

describe('dragging a child to the gap under its group\'s last child (#814 variant)', () => {
  // Panel: Project, Poster, Cyan Plate, MARTIAN, Background
  const doc = buildDoc([
    { name: 'Background' },
    { name: 'MARTIAN' },
    { name: 'Cyan Plate' },
    { name: 'Poster', children: ['MARTIAN', 'Cyan Plate'] },
    { name: 'Project', children: ['Background', 'Poster'] },
  ]);

  it('moves the child to the bottom of its own group', () => {
    const next = drag(doc, 'Cyan Plate', 4, 2)!;
    expect(panel(next)).toEqual(['Project', ' Poster', '  MARTIAN', '  Cyan Plate', ' Background']);
    assertTreeMatchesOrder(next);
  });

  it('dropping the last child back into its own slot is a no-op', () => {
    expect(drag(doc, 'MARTIAN', 4, 2)).toBeNull();
    expect(drag(doc, 'MARTIAN', 3, 2)).toBeNull();
  });

  it('computeDropLayer reports a no-op so the store records no history', () => {
    const martian = idOf(doc, 'MARTIAN');
    const current = currentDropTarget(doc.layers, doc.layerOrder, martian)!;
    expect(computeDropLayer(doc, 0, martian, current)).toBeUndefined();
  });

  it('ejects the last child below its group when dragged out to root depth (#788)', () => {
    const next = drag(doc, 'MARTIAN', 4, 1)!;
    expect(panel(next)).toEqual(['Project', ' Poster', '  Cyan Plate', ' MARTIAN', ' Background']);
    assertTreeMatchesOrder(next);
  });
});

describe('dragging group rows (#824)', () => {
  it('moves a whole group between Layer 7 and Layer 1', () => {
    // Panel: Project, Group, Layer 5, Layer 4, Layer 8, Layer 7, Layer 1, Background
    const doc = buildDoc([
      { name: 'Background' },
      { name: 'Layer 1' },
      { name: 'Layer 7' },
      { name: 'Layer 8' },
      { name: 'Layer 4' },
      { name: 'Layer 5' },
      { name: 'Group', children: ['Layer 4', 'Layer 5'] },
      { name: 'Project', children: ['Background', 'Layer 1', 'Layer 7', 'Layer 8', 'Group'] },
    ]);
    // Top half of the Layer 1 row = gap 6.
    const next = drag(doc, 'Group', 6, 1)!;
    expect(panel(next)).toEqual([
      'Project', ' Layer 8', ' Layer 7', ' Group', '  Layer 5', '  Layer 4', ' Layer 1', ' Background',
    ]);
    assertTreeMatchesOrder(next);
  });

  describe('nested group re-parenting outward', () => {
    // Panel: Project, Trench, Type, Background
    const doc = buildDoc([
      { name: 'Background' },
      { name: 'Type', children: [] },
      { name: 'Trench', children: ['Type'] },
      { name: 'Project', children: ['Background', 'Trench'] },
    ]);

    it('drags an empty nested group to the gap above its parent → root', () => {
      const next = drag(doc, 'Type', 1, 2)!;
      expect(panel(next)).toEqual(['Project', ' Type', ' Trench', ' Background']);
      expect(parentName(next, 'Type')).toBe('Project');
      assertTreeMatchesOrder(next);
    });

    it('drags it out below its parent at root depth', () => {
      const next = drag(doc, 'Type', 3, 1)!;
      expect(panel(next)).toEqual(['Project', ' Trench', ' Type', ' Background']);
      expect(parentName(next, 'Type')).toBe('Project');
      assertTreeMatchesOrder(next);
    });

    it('carries a nested group\'s whole subtree with it', () => {
      // Panel: Project, Outer, Inner, Leaf, Other, Background
      const nested = buildDoc([
        { name: 'Background' },
        { name: 'Other' },
        { name: 'Leaf' },
        { name: 'Inner', children: ['Leaf'] },
        { name: 'Outer', children: ['Other', 'Inner'] },
        { name: 'Project', children: ['Background', 'Outer'] },
      ]);
      const next = drag(nested, 'Inner', 5, 1)!;
      expect(panel(next)).toEqual([
        'Project', ' Outer', '  Other', ' Inner', '  Leaf', ' Background',
      ]);
      assertTreeMatchesOrder(next);
    });

    it('refuses to drop a group inside itself', () => {
      const withChild = buildDoc([
        { name: 'Background' },
        { name: 'A' },
        { name: 'G', children: ['A'] },
        { name: 'Project', children: ['Background', 'G'] },
      ]);
      const g = idOf(withChild, 'G');
      expect(computeDropLayer(withChild, 0, g, { parentId: g, belowId: null })).toBeUndefined();
      expect(computeDropLayer(withChild, 0, g, { parentId: g, belowId: idOf(withChild, 'A') })).toBeUndefined();
    });
  });
});

describe('collapsed groups and layerOrder divergence (#797, #824)', () => {
  // G is collapsed, so A/B/C are hidden rows.
  // Panel: Project, Poly, G, Dot, HELLO, Layer 1, Background
  const spec: Spec[] = [
    { name: 'Background' },
    { name: 'Layer 1' },
    { name: 'HELLO' },
    { name: 'Dot' },
    { name: 'A' },
    { name: 'B' },
    { name: 'C' },
    { name: 'G', children: ['A', 'B', 'C'], collapsed: true },
    { name: 'Poly' },
    { name: 'Project', children: ['Background', 'Layer 1', 'HELLO', 'Dot', 'G', 'Poly'] },
  ];

  it('drags HELLO above Poly past a collapsed group', () => {
    const doc = buildDoc(spec);
    const next = drag(doc, 'HELLO', 1, 1)!;
    expect(panel(next)).toEqual(['Project', ' HELLO', ' Poly', ' G', ' Dot', ' Layer 1', ' Background']);
    assertTreeMatchesOrder(next);
  });

  it('drops below a collapsed group without entering it or moving a hidden child', () => {
    const doc = buildDoc(spec);
    const next = drag(doc, 'Poly', 3, 1)!;
    expect(panel(next)).toEqual(['Project', ' G', ' Poly', ' Dot', ' HELLO', ' Layer 1', ' Background']);
    expect(parentName(next, 'Poly')).toBe('Project');
    expect(getDescendantIds(next.layers, idOf(next, 'G')).map((id) => nameOf(next, id))).toEqual(['A', 'B', 'C']);
    assertTreeMatchesOrder(next);
  });

  it('resolves against layerOrder when document.layers is out of order', () => {
    const names = spec.map((s) => s.name);
    const shuffled = [...names].reverse();
    const doc = buildDoc(spec, shuffled);
    const next = drag(doc, 'Background', 1, 1)!;
    expect(panel(next)).toEqual(['Project', ' Background', ' Poly', ' G', ' Dot', ' HELLO', ' Layer 1']);
    assertTreeMatchesOrder(next);
  });
});
