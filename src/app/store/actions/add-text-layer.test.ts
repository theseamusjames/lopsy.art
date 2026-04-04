// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeAddTextLayer, computeUpdateTextLayerProperties } from './add-text-layer';
import { createRasterLayer, createTextLayer } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';

function makeDoc(...extraLayers: import('../../../types').Layer[]): DocumentState {
  const layer = createRasterLayer({ name: 'Background', width: 100, height: 100 });
  const allLayers = [layer, ...extraLayers];
  return {
    id: 'doc-1',
    name: 'Test',
    width: 100,
    height: 100,
    layers: allLayers,
    layerOrder: allLayers.map((l) => l.id),
    activeLayerId: layer.id,
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
  };
}

describe('computeAddTextLayer', () => {
  it('adds the text layer to layers array', () => {
    const doc = makeDoc();
    const textLayer = createTextLayer({ name: 'Text', text: 'Hello' });
    const result = computeAddTextLayer(doc, textLayer);
    expect(result.document!.layers).toHaveLength(2);
    expect(result.document!.layers[1]).toBe(textLayer);
  });

  it('adds to layerOrder', () => {
    const doc = makeDoc();
    const textLayer = createTextLayer({ name: 'Text', text: 'Hello' });
    const result = computeAddTextLayer(doc, textLayer);
    expect(result.document!.layerOrder).toContain(textLayer.id);
    expect(result.document!.layerOrder).toHaveLength(2);
  });

  it('sets text layer as active', () => {
    const doc = makeDoc();
    const textLayer = createTextLayer({ name: 'Text', text: 'Hello' });
    const result = computeAddTextLayer(doc, textLayer);
    expect(result.document!.activeLayerId).toBe(textLayer.id);
  });

  it('preserves text layer properties', () => {
    const doc = makeDoc();
    const textLayer = createTextLayer({
      name: 'Custom Text',
      text: 'Hello World',
      fontFamily: 'Georgia',
      fontSize: 48,
    });
    const result = computeAddTextLayer(doc, textLayer);
    const added = result.document!.layers[1]!;
    expect(added.type).toBe('text');
    if (added.type === 'text') {
      expect(added.text).toBe('Hello World');
      expect(added.fontFamily).toBe('Georgia');
      expect(added.fontSize).toBe(48);
    }
  });
});

describe('computeUpdateTextLayerProperties', () => {
  it('updates text content', () => {
    const textLayer = createTextLayer({ name: 'Text', text: 'Hello' });
    const doc = makeDoc(textLayer);

    const result = computeUpdateTextLayerProperties(doc, textLayer.id, { text: 'Updated' });
    const updated = result.document!.layers.find((l) => l.id === textLayer.id)!;
    expect(updated.type).toBe('text');
    if (updated.type === 'text') {
      expect(updated.text).toBe('Updated');
    }
  });

  it('updates font properties', () => {
    const textLayer = createTextLayer({ name: 'Text', text: 'Hello' });
    const doc = makeDoc(textLayer);

    const result = computeUpdateTextLayerProperties(doc, textLayer.id, {
      fontFamily: 'Arial',
      fontSize: 36,
      fontWeight: 700,
      fontStyle: 'italic',
    });
    const updated = result.document!.layers.find((l) => l.id === textLayer.id)!;
    if (updated.type === 'text') {
      expect(updated.fontFamily).toBe('Arial');
      expect(updated.fontSize).toBe(36);
      expect(updated.fontWeight).toBe(700);
      expect(updated.fontStyle).toBe('italic');
    }
  });

  it('does not modify non-text layers', () => {
    const doc = makeDoc();
    const rasterLayer = doc.layers[0]!;
    const result = computeUpdateTextLayerProperties(doc, rasterLayer.id, { text: 'Nope' } as never);
    expect(result.document!.layers[0]).toBe(rasterLayer);
  });

  it('preserves other text layer properties when partially updating', () => {
    const textLayer = createTextLayer({ name: 'Text', text: 'Hello', fontSize: 24 });
    const doc = makeDoc(textLayer);

    const result = computeUpdateTextLayerProperties(doc, textLayer.id, { text: 'New' });
    const updated = result.document!.layers.find((l) => l.id === textLayer.id)!;
    if (updated.type === 'text') {
      expect(updated.text).toBe('New');
      expect(updated.fontSize).toBe(24);
      expect(updated.fontFamily).toBe('Inter');
    }
  });

  it('can update position', () => {
    const textLayer = createTextLayer({ name: 'Text', text: 'Hello' });
    const doc = makeDoc(textLayer);

    const result = computeUpdateTextLayerProperties(doc, textLayer.id, { x: 50, y: 75 });
    const updated = result.document!.layers.find((l) => l.id === textLayer.id)!;
    expect(updated.x).toBe(50);
    expect(updated.y).toBe(75);
  });
});
