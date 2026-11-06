// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeAlignLayer } from './align-layer';
import { createRasterLayer, createGroupLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';
import type { SelectionData } from '../types';

const NO_SELECTION: SelectionData = { active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 };

function imageWithAlpha(w: number, h: number, opaque: (x: number, y: number) => boolean): ImageData {
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (opaque(x, y)) img.data[(y * w + x) * 4 + 3] = 255;
    }
  }
  return img;
}

function makeDoc(): { doc: DocumentState; pixelData: Map<string, ImageData>; selection: SelectionData } {
  const layer = createRasterLayer({ name: 'Layer 1', width: 20, height: 20 });
  const pixelData = new Map<string, ImageData>();
  const imgData = new ImageData(20, 20);
  // Put an opaque pixel at (5, 5) so getContentBounds returns a result
  const idx = (5 * 20 + 5) * 4;
  imgData.data[idx + 3] = 255;
  pixelData.set(layer.id, imgData);
  return {
    doc: {
      id: 'doc-1',
      name: 'Test',
      width: 100,
      height: 100,
      layers: [layer],
      layerOrder: [layer.id],
      activeLayerId: layer.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    },
    pixelData,
    selection: { active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 },
  };
}

describe('computeAlignLayer', () => {
  it('returns undefined when no active layer', () => {
    const { doc, pixelData, selection } = makeDoc();
    const result = computeAlignLayer({ ...doc, activeLayerId: null }, pixelData, selection, 0, 'left');
    expect(result).toBeUndefined();
  });

  it('aligns layer position to the left edge', () => {
    const { doc, pixelData, selection } = makeDoc();
    const result = computeAlignLayer(doc, pixelData, selection, 0, 'left')!;
    const layer = result.document!.layers[0]!;
    // Content is at pixel (5,5), so aligning left: x = -5
    expect(layer.x).toBe(-5);
  });

  it('aligns layer position to the right edge', () => {
    const { doc, pixelData, selection } = makeDoc();
    const result = computeAlignLayer(doc, pixelData, selection, 0, 'right')!;
    const layer = result.document!.layers[0]!;
    // Content bounds: x=5, width=1, canvas=100 -> x = 100 - 1 - 5 = 94
    expect(layer.x).toBe(94);
  });

  it('increments renderVersion', () => {
    const { doc, pixelData, selection } = makeDoc();
    const result = computeAlignLayer(doc, pixelData, selection, 3, 'left')!;
    expect(result.renderVersion).toBe(4);
  });

  it('aligns a group by shifting the group and all its children together', () => {
    const child = { ...createRasterLayer({ name: 'Child', width: 20, height: 20 }), x: 30, y: 0 };
    const group = createGroupLayer({ name: 'Group', children: [child.id] });
    const pixelData = new Map<string, ImageData>();
    // Opaque pixel at local (5,5) -> doc x = 30 + 5 = 35.
    const img = imageWithAlpha(20, 20, (x, y) => x === 5 && y === 5);
    pixelData.set(child.id, img);

    const doc: DocumentState = {
      id: 'doc-1', name: 'Test', width: 100, height: 100,
      layers: [group, child], layerOrder: [group.id, child.id],
      activeLayerId: group.id, selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    };

    const result = computeAlignLayer(doc, pixelData, NO_SELECTION, 0, 'left')!;
    expect(result).toBeDefined();
    const layers = result.document!.layers;
    const newGroup = layers.find((l) => l.id === group.id)!;
    const newChild = layers.find((l) => l.id === child.id)!;
    // Union content min-x is 35, so the whole subtree shifts by -35.
    expect(newChild.x).toBe(-5);
    expect(newGroup.x).toBe(-35);
  });
});

describe('computeAlignLayer with several selected layers (#1517)', () => {
  function box(name: string, x: number, y: number): { layer: ReturnType<typeof createRasterLayer>; img: ImageData } {
    const layer = { ...createRasterLayer({ name, width: 10, height: 10 }), x, y };
    const img = imageWithAlpha(10, 10, () => true);
    return { layer, img };
  }

  function twoBoxDoc(): { doc: DocumentState; pixelData: Map<string, ImageData>; aId: string; bId: string } {
    const a = box('A', 30, 10);
    const b = box('B', 50, 35);
    const pixelData = new Map([[a.layer.id, a.img], [b.layer.id, b.img]]);
    return {
      doc: {
        id: 'doc-1', name: 'Test', width: 100, height: 100,
        layers: [a.layer, b.layer], layerOrder: [a.layer.id, b.layer.id],
        activeLayerId: a.layer.id, selectedLayerIds: [a.layer.id, b.layer.id],
        backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
        colorMode: 'rgb',
      },
      pixelData,
      aId: a.layer.id,
      bId: b.layer.id,
    };
  }

  function positions(result: ReturnType<typeof computeAlignLayer>, ids: string[]): { x: number; y: number }[] {
    return ids.map((id) => {
      const l = result!.document!.layers.find((layer) => layer.id === id)!;
      return { x: l.x, y: l.y };
    });
  }

  it('aligns every selected layer to the left edge of their union, not the canvas', () => {
    const { doc, pixelData, aId, bId } = twoBoxDoc();
    const result = computeAlignLayer(doc, pixelData, NO_SELECTION, 0, 'left');
    expect(positions(result, [aId, bId])).toEqual([{ x: 30, y: 10 }, { x: 30, y: 35 }]);
  });

  it('aligns right, bottom and both centres inside the union box', () => {
    const { doc, pixelData, aId, bId } = twoBoxDoc();
    // Union: x 30–60, y 10–45.
    expect(positions(computeAlignLayer(doc, pixelData, NO_SELECTION, 0, 'right'), [aId, bId]))
      .toEqual([{ x: 50, y: 10 }, { x: 50, y: 35 }]);
    expect(positions(computeAlignLayer(doc, pixelData, NO_SELECTION, 0, 'bottom'), [aId, bId]))
      .toEqual([{ x: 30, y: 35 }, { x: 50, y: 35 }]);
    expect(positions(computeAlignLayer(doc, pixelData, NO_SELECTION, 0, 'center-h'), [aId, bId]))
      .toEqual([{ x: 40, y: 10 }, { x: 40, y: 35 }]);
    expect(positions(computeAlignLayer(doc, pixelData, NO_SELECTION, 0, 'center-v'), [aId, bId]))
      .toEqual([{ x: 30, y: 23 }, { x: 50, y: 23 }]);
  });

  it('leaves locked layers where they are', () => {
    const { doc, pixelData, aId } = twoBoxDoc();
    const locked: DocumentState = {
      ...doc,
      layers: doc.layers.map((l) => (l.id === aId ? { ...l, locked: true } : l)),
    };
    // Only B is aligned, and it already frames itself, so nothing moves.
    expect(computeAlignLayer(locked, pixelData, NO_SELECTION, 0, 'left')).toBeUndefined();
    expect(computeAlignLayer(locked, pixelData, NO_SELECTION, 0, 'right')).toBeUndefined();
  });

  it('moves a selected group with its children as one item', () => {
    const a = box('A', 30, 10);
    const child = box('Child', 60, 50);
    const group = createGroupLayer({ name: 'Group', children: [child.layer.id] });
    const pixelData = new Map([[a.layer.id, a.img], [child.layer.id, child.img]]);
    const doc: DocumentState = {
      id: 'doc-1', name: 'Test', width: 100, height: 100,
      layers: [a.layer, group, child.layer], layerOrder: [a.layer.id, group.id, child.layer.id],
      activeLayerId: a.layer.id, selectedLayerIds: [a.layer.id, group.id, child.layer.id],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    };
    const result = computeAlignLayer(doc, pixelData, NO_SELECTION, 0, 'left');
    const [aPos, groupPos, childPos] = positions(result, [a.layer.id, group.id, child.layer.id]);
    expect(aPos).toEqual({ x: 30, y: 10 });
    // The child moved once (with its group), not twice.
    expect(childPos).toEqual({ x: 30, y: 50 });
    expect(groupPos!.x - group.x).toBe(-30);
  });

  it('still aligns a marquee to the canvas when several layers are selected', () => {
    const { doc, pixelData, aId } = twoBoxDoc();
    const selection: SelectionData = {
      active: true, bounds: { x: 30, y: 10, width: 10, height: 10 },
      mask: new Uint8ClampedArray(100 * 100), maskWidth: 100, maskHeight: 100,
    };
    const result = computeAlignLayer(doc, pixelData, selection, 0, 'left');
    expect(positions(result, [aId])).toEqual([{ x: 0, y: 10 }]);
  });
});
