// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeResizeImage } from './resize-image';
import { createRasterLayer, createTextLayer, DEFAULT_EFFECTS } from '../../../layers/layer-model';
import type { DocumentState } from '../../../types';
import type { RasterLayer, TextLayer } from '../../../types/layers';

function makeDoc(): { doc: DocumentState } {
  const layer = { ...createRasterLayer({ name: 'Background', width: 10, height: 10 }), x: 2, y: 4 };
  return {
    doc: {
      id: 'doc-1',
      name: 'Test',
      width: 10,
      height: 10,
      layers: [layer],
      layerOrder: [layer.id],
      activeLayerId: layer.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    },
  };
}

describe('computeResizeImage', () => {
  it('scales document and all layer dimensions', () => {
    const { doc } = makeDoc();
    const result = computeResizeImage(doc, 0, 20, 20);
    expect(result.document!.width).toBe(20);
    expect(result.document!.height).toBe(20);
    const layer = result.document!.layers[0]! as RasterLayer;
    expect(layer.width).toBe(20);
    expect(layer.height).toBe(20);
  });

  it('scales layer positions', () => {
    const { doc } = makeDoc();
    const result = computeResizeImage(doc, 0, 20, 20);
    const layer = result.document!.layers[0]!;
    // scaleX = 2, scaleY = 2
    expect(layer.x).toBe(4); // 2 * 2
    expect(layer.y).toBe(8); // 4 * 2
  });

  it('scales a sub-document-sized layer by its own dimensions, not the doc size', () => {
    // An added layer cropped to its content: a 30x20 region at (10, 6) inside
    // a 60x60 document. Resizing the doc to 1/3 must shrink the layer too.
    const layer = { ...createRasterLayer({ name: 'Fill', width: 30, height: 20 }), x: 10, y: 6 };
    const doc: DocumentState = {
      id: 'doc-1', name: 'Test', width: 60, height: 60,
      layers: [layer],
      layerOrder: [layer.id],
      activeLayerId: layer.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    };
    const result = computeResizeImage(doc, 0, 20, 20);
    const updated = result.document!.layers[0]! as RasterLayer;
    // scaleX = scaleY = 1/3
    expect(updated.width).toBe(10); // round(30 / 3)
    expect(updated.height).toBe(7); // round(20 / 3)
    expect(updated.x).toBe(3); // round(10 / 3)
    expect(updated.y).toBe(2); // round(6 / 3)
  });

  it('scales text layer position without converting to raster', () => {
    const textLayer = { ...createTextLayer({ name: 'Text', text: 'Hello' }), x: 4, y: 6 };
    const raster = createRasterLayer({ name: 'Background', width: 10, height: 10 });
    const doc: DocumentState = {
      id: 'doc-1', name: 'Test', width: 10, height: 10,
      layers: [raster, textLayer],
      layerOrder: [raster.id, textLayer.id],
      activeLayerId: raster.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    };
    const result = computeResizeImage(doc, 0, 20, 20);
    const updated = result.document!.layers.find((l) => l.id === textLayer.id)! as TextLayer;
    expect(updated.type).toBe('text');
    expect(updated.x).toBe(8); // 4 * 2
    expect(updated.y).toBe(12); // 6 * 2
  });

  it('scales a text layer fontSize, letterSpacing, and area-text width under uniform scale', () => {
    const textLayer = {
      ...createTextLayer({ name: 'Text', text: 'Hello', fontSize: 24 }),
      letterSpacing: 2,
      width: 50,
    };
    const doc: DocumentState = {
      id: 'doc-1', name: 'Test', width: 10, height: 10,
      layers: [textLayer],
      layerOrder: [textLayer.id],
      activeLayerId: textLayer.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    };
    const result = computeResizeImage(doc, 0, 20, 20);
    const updated = result.document!.layers[0]! as TextLayer;
    // scaleX = scaleY = 2
    expect(updated.fontSize).toBe(48);
    expect(updated.letterSpacing).toBe(4);
    expect(updated.width).toBe(100);
  });

  it('scales fontSize by the geometric mean and area-text width by scaleX under non-uniform scale', () => {
    const textLayer = {
      ...createTextLayer({ name: 'Text', text: 'Hello', fontSize: 10 }),
      width: 40,
    };
    const doc: DocumentState = {
      id: 'doc-1', name: 'Test', width: 10, height: 10,
      layers: [textLayer],
      layerOrder: [textLayer.id],
      activeLayerId: textLayer.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    };
    // scaleX = 40/10 = 4, scaleY = 10/10 = 1 -> isotropic = sqrt(4*1) = 2
    const result = computeResizeImage(doc, 0, 40, 10);
    const updated = result.document!.layers[0]! as TextLayer;
    expect(updated.fontSize).toBe(20);
    expect(updated.width).toBe(160); // 40 * scaleX (4)
  });

  it('scales layer effect dimensions for both text and raster layers', () => {
    const effects = {
      stroke: { ...DEFAULT_EFFECTS.stroke, width: 10 },
      dropShadow: { ...DEFAULT_EFFECTS.dropShadow, offsetX: 4, offsetY: 8, blur: 12, spread: 2 },
      outerGlow: { ...DEFAULT_EFFECTS.outerGlow, size: 20, spread: 4 },
      innerGlow: { ...DEFAULT_EFFECTS.innerGlow, size: 6, spread: 1 },
      colorOverlay: { ...DEFAULT_EFFECTS.colorOverlay },
    };
    const textLayer = { ...createTextLayer({ name: 'Text', text: 'Hello' }), effects };
    const raster = { ...createRasterLayer({ name: 'Background', width: 10, height: 10 }), effects };
    const doc: DocumentState = {
      id: 'doc-1', name: 'Test', width: 10, height: 10,
      layers: [raster, textLayer],
      layerOrder: [raster.id, textLayer.id],
      activeLayerId: raster.id,
      selectedLayerIds: [],
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      colorMode: 'rgb',
    };
    const result = computeResizeImage(doc, 0, 20, 20);
    // scaleX = scaleY = 2, isotropic = 2
    const updatedText = result.document!.layers.find((l) => l.id === textLayer.id)! as TextLayer;
    expect(updatedText.effects.stroke.width).toBe(20);
    expect(updatedText.effects.dropShadow.offsetX).toBe(8);
    expect(updatedText.effects.dropShadow.offsetY).toBe(16);
    expect(updatedText.effects.dropShadow.blur).toBe(24);
    expect(updatedText.effects.outerGlow.size).toBe(40);
    expect(updatedText.effects.innerGlow.size).toBe(12);

    const updatedRaster = result.document!.layers.find((l) => l.id === raster.id)! as RasterLayer;
    expect(updatedRaster.effects.stroke.width).toBe(20);
    expect(updatedRaster.effects.dropShadow.blur).toBe(24);
  });
});
