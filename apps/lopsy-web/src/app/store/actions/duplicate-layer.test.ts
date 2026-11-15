// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect, vi } from 'vitest';
import { computeDuplicateLayer } from './duplicate-layer';
import { createRasterLayer, createGroupLayer } from '../../../layers/layer-model';
import type { DocumentState, GroupLayer, Layer, RasterLayer } from '../../../types';

// #746: computeDuplicateLayer must not touch the JS pixel map — it
// runs entirely on the GPU. Any read from a passed pixel map or from
// resolveAllPixelData would be a regression.
vi.mock('../../../engine-wasm/engine-state', () => ({
  getEngine: () => null,
  clearEngine: () => {},
}));

function makeDoc(opts?: {
  layerWidth?: number;
  layerHeight?: number;
  layerX?: number;
  layerY?: number;
  docWidth?: number;
  docHeight?: number;
}): DocumentState {
  const layerW = opts?.layerWidth ?? 10;
  const layerH = opts?.layerHeight ?? 10;
  const docW = opts?.docWidth ?? 1024;
  const docH = opts?.docHeight ?? 1024;
  const baseLayer = createRasterLayer({ name: 'Background', width: layerW, height: layerH });
  const layer: RasterLayer = { ...baseLayer, x: opts?.layerX ?? 0, y: opts?.layerY ?? 0 };
  return {
    id: 'doc-1',
    name: 'Test',
    width: docW,
    height: docH,
    layers: [layer],
    layerOrder: [layer.id],
    activeLayerId: layer.id,
    selectedLayerIds: [layer.id],
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    colorMode: 'rgb',
  };
}

describe('computeDuplicateLayer', () => {
  it('returns undefined when no active layer', () => {
    const doc = makeDoc();
    const result = computeDuplicateLayer({ ...doc, activeLayerId: null });
    expect(result).toBeUndefined();
  });

  it('creates a new layer in the document', () => {
    const doc = makeDoc();
    const result = computeDuplicateLayer(doc)!;
    const newLayerId = result.document!.activeLayerId!;
    expect(newLayerId).not.toBe(doc.activeLayerId);
    expect(result.document!.layers).toHaveLength(2);
  });

  // #746: the compute must not force a whole-document round trip via
  // layerPixelData. It's GPU-only and returns no pixel map.
  it('does not return a layerPixelData map (GPU-only)', () => {
    const doc = makeDoc();
    const result = computeDuplicateLayer(doc)!;
    expect(result.layerPixelData).toBeUndefined();
  });

  it('inserts after the original in layerOrder', () => {
    const doc = makeDoc();
    const r = result(doc);
    const origIdx = r.layerOrder.indexOf(doc.activeLayerId!);
    const newIdx = r.layerOrder.indexOf(r.activeLayerId!);
    expect(newIdx).toBe(origIdx + 1);
  });

  // #804: a lingering pre-duplicate selection made the next nudge or Move
  // drag treat the original as a multi-selected sibling and move it too.
  it('leaves only the copy selected', () => {
    const doc = makeDoc();
    const other = createRasterLayer({ name: 'Other', width: 10, height: 10 });
    const multi: DocumentState = {
      ...doc,
      layers: [...doc.layers, other],
      layerOrder: [...doc.layerOrder, other.id],
      selectedLayerIds: [doc.activeLayerId!, other.id],
    };
    const r = result(multi);
    expect(r.selectedLayerIds).toEqual([r.activeLayerId]);
  });

  it.each([
    { name: 'a layer well inside the canvas', layerX: 50, layerY: 50, layerWidth: 100, layerHeight: 100 },
    { name: 'a layer at the canvas origin', layerX: 0, layerY: 0, layerWidth: 100, layerHeight: 100 },
    { name: 'a layer against the far edge', layerX: 924, layerY: 924, layerWidth: 100, layerHeight: 100 },
    { name: 'a layer larger than the canvas', layerX: -100, layerY: -50, layerWidth: 4000, layerHeight: 3000 },
  ])('places the copy exactly over $name', (opts) => {
    const doc = makeDoc(opts);
    const dup = newLayer(doc);
    expect({ x: dup.x, y: dup.y }).toEqual({ x: opts.layerX, y: opts.layerY });
  });
});

function result(doc: DocumentState): DocumentState {
  return computeDuplicateLayer(doc)!.document!;
}

function newLayer(doc: DocumentState) {
  const r = result(doc);
  const dup = r.layers.find((l) => l.id === r.activeLayerId);
  if (!dup) throw new Error('duplicate not found');
  return dup;
}

function groupDoc(layers: Layer[], layerOrder: string[], activeId: string): DocumentState {
  return {
    id: 'doc-1',
    name: 'Test',
    width: 1024,
    height: 1024,
    layers,
    layerOrder,
    activeLayerId: activeId,
    selectedLayerIds: [activeId],
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    colorMode: 'rgb',
  };
}

function raster(name: string): RasterLayer {
  return createRasterLayer({ name, width: 10, height: 10 });
}

function groupById(doc: DocumentState, id: string): GroupLayer {
  const g = doc.layers.find((l) => l.id === id);
  if (!g || g.type !== 'group') throw new Error(`group ${id} not found`);
  return g;
}

// #805: the copy used to be spliced in one id at a time, each straight after
// its own source, which interleaved copies with originals in layerOrder.
describe('computeDuplicateLayer (group)', () => {
  it('inserts the copied subtree as one block directly above the source', () => {
    const a = raster('A');
    const b = raster('B');
    const g = createGroupLayer({ name: 'G', children: [a.id, b.id] });
    const top = raster('Top');
    const doc = groupDoc([a, b, g, top], [a.id, b.id, g.id, top.id], g.id);

    const r = result(doc);
    const copy = groupById(r, r.activeLayerId!);
    const [aCopy, bCopy] = copy.children;
    expect(r.layerOrder).toEqual([a.id, b.id, g.id, aCopy, bCopy, copy.id, top.id]);
    expect(groupById(r, g.id).children).toEqual([a.id, b.id]);
    expect(r.selectedLayerIds).toEqual([copy.id]);
  });

  it('places every layer of the copy exactly over its source', () => {
    const a: RasterLayer = { ...raster('A'), x: 40, y: 70 };
    const g = createGroupLayer({ name: 'G', children: [a.id] });
    const doc = groupDoc([a, g], [a.id, g.id], g.id);

    const r = result(doc);
    const copy = groupById(r, r.activeLayerId!);
    const aCopy = r.layers.find((l) => l.id === copy.children[0]);
    expect({ x: aCopy?.x, y: aCopy?.y }).toEqual({ x: 40, y: 70 });
    expect({ x: copy.x, y: copy.y }).toEqual({ x: g.x, y: g.y });
  });

  it('keeps a nested sub-group and its children inside the copy', () => {
    const x = raster('X');
    const sub = createGroupLayer({ name: 'S', children: [x.id] });
    const y = raster('Y');
    const g = createGroupLayer({ name: 'G', children: [sub.id, y.id] });
    const doc = groupDoc([x, sub, y, g], [x.id, sub.id, y.id, g.id], g.id);

    const r = result(doc);
    const copy = groupById(r, r.activeLayerId!);
    const [subCopyId, yCopy] = copy.children as [string, string];
    const subCopy = groupById(r, subCopyId);
    expect(subCopy.children).toHaveLength(1);
    const xCopy = subCopy.children[0]!;
    expect(r.layerOrder).toEqual([x.id, sub.id, y.id, g.id, xCopy, subCopyId, yCopy, copy.id]);
  });

  it('places the copy at its stack slot in the parent group', () => {
    const a = raster('A');
    const g = createGroupLayer({ name: 'G', children: [a.id] });
    const z = raster('Z');
    const parent = createGroupLayer({ name: 'P', children: [g.id, z.id] });
    const doc = groupDoc([a, g, z, parent], [a.id, g.id, z.id, parent.id], g.id);

    const r = result(doc);
    const copyId = r.activeLayerId!;
    expect(groupById(r, parent.id).children).toEqual([g.id, copyId, z.id]);
  });
});

describe('computeDuplicateLayer (inside a group)', () => {
  it('places a layer copy at its stack slot in the parent group', () => {
    const a = raster('A');
    const b = raster('B');
    const parent = createGroupLayer({ name: 'P', children: [a.id, b.id] });
    const doc = groupDoc([a, b, parent], [a.id, b.id, parent.id], a.id);

    const r = result(doc);
    const copyId = r.activeLayerId!;
    expect(r.layerOrder).toEqual([a.id, copyId, b.id, parent.id]);
    expect(groupById(r, parent.id).children).toEqual([a.id, copyId, b.id]);
  });
});
