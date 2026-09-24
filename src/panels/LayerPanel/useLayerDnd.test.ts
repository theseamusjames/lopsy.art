import { describe, it, expect } from 'vitest';
import { resolveDisplayDropIndices } from './useLayerDnd';
import type { Layer } from '../../types';

function makeRaster(id: string, name: string): Layer {
  return {
    id,
    name,
    type: 'raster',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    effects: {},
    isBackground: false,
  } as unknown as Layer;
}

function makeGroup(id: string, name: string, children: string[], collapsed: boolean): Layer {
  return {
    id,
    name,
    type: 'group',
    x: 0,
    y: 0,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    children,
    collapsed,
    effects: {},
    adjustments: [],
  } as unknown as Layer;
}

// #797 — drag-reorder must map the display-list index (top→bottom,
// respects collapsed groups) to the full layerOrder index so the
// action moves the layer the user actually grabbed. The buggy
// `layers.length - 1 - from` formula silently reached into a hidden
// child of a collapsed group above the dragged row.
describe('resolveDisplayDropIndices (#797)', () => {
  // layerOrder is bottom→top: [Background, Layer 1, HELLO, Dot, A, B, C, G, Poly, root]
  // With G collapsed, displayList (top→bottom) skips A/B/C:
  //   [root, Poly, G, Dot, HELLO, Layer 1, Background]
  const bg = makeRaster('bg', 'Background');
  const l1 = makeRaster('l1', 'Layer 1');
  const hello = makeRaster('hello', 'HELLO');
  const dot = makeRaster('dot', 'Dot');
  const a = makeRaster('a', 'A');
  const b = makeRaster('b', 'B');
  const c = makeRaster('c', 'C');
  const g = makeGroup('g', 'G', ['a', 'b', 'c'], /*collapsed*/ true);
  const poly = makeRaster('poly', 'Poly');
  const root = makeGroup('root', 'Project', ['bg', 'l1', 'hello', 'dot', 'g', 'poly'], false);

  // layers in bottom→top order (matches layerOrder)
  const layers: Layer[] = [bg, l1, hello, dot, a, b, c, g, poly, root];

  const displayList = [
    { layer: root, depth: 0 },
    { layer: poly, depth: 1 },
    { layer: g, depth: 1 },
    { layer: dot, depth: 1 },
    { layer: hello, depth: 1 },
    { layer: l1, depth: 1 },
    { layer: bg, depth: 1 },
  ];

  it('drags HELLO above Poly with a collapsed group between them', () => {
    // from = 4 (HELLO display index), gap = 1 (drop above Poly).
    const r = resolveDisplayDropIndices(layers, displayList, 4, 1);
    // fromIdx = layerOrder.indexOf(HELLO) = 2. Poly is at layerOrder 8.
    // Since 8 > 2, toIdx = 8. HELLO should end up just below Poly.
    expect(r).toEqual({ fromIdx: 2, toIdx: 8 });
  });

  it('drags Poly down between G and Dot without pulling a hidden child', () => {
    // from = 1 (Poly), gap = 3 (drop above Dot).
    const r = resolveDisplayDropIndices(layers, displayList, 1, 3);
    // fromIdx = 8 (Poly). Dot is at layerOrder 3.
    // Since 3 < 8, toIdx = 3 + 1 = 4.
    expect(r).toEqual({ fromIdx: 8, toIdx: 4 });
  });

  it('drops at the very bottom of the visible list', () => {
    // from = 4 (HELLO), gap = 7 (below Background — displayList.length).
    const r = resolveDisplayDropIndices(layers, displayList, 4, 7);
    expect(r).toEqual({ fromIdx: 2, toIdx: 0 });
  });

  it('drops at the very top of the visible list', () => {
    // from = 4 (HELLO), gap = 0 (above the root row).
    const r = resolveDisplayDropIndices(layers, displayList, 4, 0);
    // Neighbour above the gap is root at layerOrder idx 9.
    // 9 > 2, so toIdx = 9.
    expect(r).toEqual({ fromIdx: 2, toIdx: 9 });
  });

  it('returns null when the drop is a no-op (dropped in its own row)', () => {
    // from = 4, gap = 4 → drop above itself, no move.
    expect(resolveDisplayDropIndices(layers, displayList, 4, 4)).toBeNull();
    // gap = from + 1 → drop just below itself, also no move.
    expect(resolveDisplayDropIndices(layers, displayList, 4, 5)).toBeNull();
  });

  it('does NOT reach into a hidden child of a collapsed group (the #797 bug)', () => {
    // The pre-fix formula `layers.length - 1 - from` on from=4 (HELLO)
    // returned 10 - 1 - 4 = 5, which is `b` (a hidden child of G).
    // Confirm the resolver picks HELLO (id=hello) instead.
    const r = resolveDisplayDropIndices(layers, displayList, 4, 1)!;
    expect(layers[r.fromIdx]!.id).toBe('hello');
    // Sanity: layers[5] (the pre-fix result) is `b`.
    expect(layers[5]!.id).toBe('b');
  });
});
