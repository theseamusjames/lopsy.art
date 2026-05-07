// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { createRasterLayer } from '../../../layers/layer-model';
import type { Layer, LayerColorTag } from '../../../types/layers';
import type { DocumentState } from '../../../types';

// Mirror the inline logic from document-slice.ts so we can unit-test it
// without standing up the full Zustand store.
function setLayerColorTag(
  doc: DocumentState,
  id: string,
  tag: LayerColorTag | null,
): DocumentState {
  return {
    ...doc,
    layers: doc.layers.map((l) =>
      l.id === id ? ({ ...l, colorTag: tag } as Layer) : l,
    ),
  };
}

function makeDoc(): DocumentState {
  const layer = createRasterLayer({ name: 'Layer 1', width: 10, height: 10 });
  return {
    id: 'doc-1',
    name: 'Test',
    width: 100,
    height: 100,
    layers: [layer],
    layerOrder: [layer.id],
    activeLayerId: layer.id,
    selectedLayerIds: [layer.id],
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
  };
}

describe('setLayerColorTag', () => {
  it('defaults to no color tag on a new layer', () => {
    const doc = makeDoc();
    const layer = doc.layers[0]!;
    expect(layer.colorTag).toBeUndefined();
  });

  it('sets a color tag on a layer', () => {
    const doc = makeDoc();
    const layerId = doc.layers[0]!.id;

    const result = setLayerColorTag(doc, layerId, 'red');
    const layer = result.layers.find((l) => l.id === layerId)!;
    expect(layer.colorTag).toBe('red');
  });

  it('changes an existing color tag to a new color', () => {
    const doc = makeDoc();
    const layerId = doc.layers[0]!.id;

    const withRed = setLayerColorTag(doc, layerId, 'red');
    const withBlue = setLayerColorTag(withRed, layerId, 'blue');
    const layer = withBlue.layers.find((l) => l.id === layerId)!;
    expect(layer.colorTag).toBe('blue');
  });

  it('removes a color tag by setting null', () => {
    const doc = makeDoc();
    const layerId = doc.layers[0]!.id;

    const withTag = setLayerColorTag(doc, layerId, 'green');
    const withoutTag = setLayerColorTag(withTag, layerId, null);
    const layer = withoutTag.layers.find((l) => l.id === layerId)!;
    expect(layer.colorTag).toBeNull();
  });

  it('only affects the target layer', () => {
    const layer1 = createRasterLayer({ name: 'L1', width: 10, height: 10 });
    const layer2 = createRasterLayer({ name: 'L2', width: 10, height: 10 });
    const doc: DocumentState = {
      id: 'doc-1',
      name: 'Test',
      width: 100,
      height: 100,
      layers: [layer1, layer2],
      layerOrder: [layer1.id, layer2.id],
      activeLayerId: layer1.id,
      selectedLayerIds: [layer1.id],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    };

    const result = setLayerColorTag(doc, layer1.id, 'purple');
    const l1 = result.layers.find((l) => l.id === layer1.id)!;
    const l2 = result.layers.find((l) => l.id === layer2.id)!;
    expect(l1.colorTag).toBe('purple');
    expect(l2.colorTag).toBeUndefined();
  });

  it('supports all valid color tag values', () => {
    const tags: LayerColorTag[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
    const doc = makeDoc();
    const layerId = doc.layers[0]!.id;

    for (const tag of tags) {
      const result = setLayerColorTag(doc, layerId, tag);
      const layer = result.layers.find((l) => l.id === layerId)!;
      expect(layer.colorTag).toBe(tag);
    }
  });
});
