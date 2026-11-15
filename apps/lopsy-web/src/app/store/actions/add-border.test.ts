import { describe, it, expect } from 'vitest';
import { computeAddBorderLayer } from './add-border';
import { createRasterLayer, createGroupLayer } from '../../../layers/layer-model';
import type { DocumentState, GroupLayer } from '../../../types';

function makeDoc(): DocumentState {
  const bg = createRasterLayer({ name: 'Background', width: 100, height: 80 });
  const art = createRasterLayer({ name: 'Art', width: 100, height: 80 });
  const root = createGroupLayer({ name: 'Project', children: [bg.id, art.id] });
  return {
    id: 'doc-1',
    name: 'Test',
    width: 100,
    height: 80,
    layers: [bg, art, root],
    layerOrder: [bg.id, art.id, root.id],
    activeLayerId: bg.id,
    selectedLayerIds: [bg.id],
    rootGroupId: root.id,
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    colorMode: 'rgb',
  };
}

function rootChildren(doc: DocumentState): readonly string[] {
  const root = doc.layers.find((l) => l.id === doc.rootGroupId) as GroupLayer;
  return root.children;
}

describe('computeAddBorderLayer', () => {
  it('puts an expand border at the bottom of the project group', () => {
    const doc = makeDoc();
    const { document, layerId } = computeAddBorderLayer(doc, 'expand');
    expect(document.layerOrder[0]).toBe(layerId);
    expect(rootChildren(document)[0]).toBe(layerId);
  });

  it('puts an overlay border at the top of the project group', () => {
    const doc = makeDoc();
    const { document, layerId } = computeAddBorderLayer(doc, 'overlay');
    const order = document.layerOrder;
    expect(order[order.length - 1]).toBe(doc.rootGroupId);
    expect(order[order.length - 2]).toBe(layerId);
    const children = rootChildren(document);
    expect(children[children.length - 1]).toBe(layerId);
  });

  it('creates a document-sized raster layer named Border and selects it', () => {
    const { document, layerId } = computeAddBorderLayer(makeDoc(), 'overlay');
    const layer = document.layers.find((l) => l.id === layerId);
    expect(layer).toMatchObject({ type: 'raster', name: 'Border', x: 0, y: 0, width: 100, height: 80 });
    expect(document.activeLayerId).toBe(layerId);
    expect(document.selectedLayerIds).toEqual([layerId]);
  });
});
