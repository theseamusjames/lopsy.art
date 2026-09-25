// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeAddLayer } from './add-layer';
import { createRasterLayer, createGroupLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';

function makeDoc(): DocumentState {
  const layer = createRasterLayer({ name: 'Background', width: 100, height: 100 });
  return {
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
  };
}

describe('computeAddLayer', () => {
  it('adds a new layer to layers array', () => {
    const doc = makeDoc();
    const result = computeAddLayer(doc);
    expect(result.document!.layers).toHaveLength(2);
  });

  it('adds to layerOrder', () => {
    const doc = makeDoc();
    const result = computeAddLayer(doc);
    expect(result.document!.layerOrder).toHaveLength(2);
  });

  it('sets new layer as active', () => {
    const doc = makeDoc();
    const result = computeAddLayer(doc);
    const newLayer = result.document!.layers[1]!;
    expect(result.document!.activeLayerId).toBe(newLayer.id);
  });

  it('does not include layerPixelData in result', () => {
    const doc = makeDoc();
    const result = computeAddLayer(doc);
    expect(result.layerPixelData).toBeUndefined();
  });
});

describe('computeAddLayer children order (#824)', () => {
  it('inserts the new id into the parent children at its stacking slot, not the end', () => {
    const bg = createRasterLayer({ name: 'Background', width: 10, height: 10 });
    const l1 = createRasterLayer({ name: 'Layer 1', width: 10, height: 10 });
    const top = createRasterLayer({ name: 'Top', width: 10, height: 10 });
    const root = createGroupLayer({ name: 'Project', children: [bg.id, l1.id, top.id] });
    const doc: DocumentState = {
      ...makeDoc(),
      layers: [bg, l1, top, root],
      layerOrder: [bg.id, l1.id, top.id, root.id],
      activeLayerId: l1.id,
      rootGroupId: root.id,
    };
    const next = computeAddLayer(doc).document!;
    const newId = next.activeLayerId!;
    expect(next.layerOrder).toEqual([bg.id, l1.id, newId, top.id, root.id]);
    const nextRoot = next.layers.find((l) => l.id === root.id);
    expect(nextRoot?.type === 'group' ? nextRoot.children : []).toEqual([bg.id, l1.id, newId, top.id]);
  });
});
