import { describe, it, expect } from 'vitest';
import { computeConvertColorMode, layersWithPixels } from './convert-color-mode';
import type { DocumentState, Layer, TextLayer, GroupLayer } from '../../../types';
import { createRasterLayer, createGroupLayer, createTextLayer } from '../../../layers/layer-model';

function makeDoc(layers: Layer[] = []): DocumentState {
  return {
    id: 'doc-1',
    name: 'test',
    width: 10,
    height: 10,
    layers,
    layerOrder: layers.map((l) => l.id),
    activeLayerId: layers[0]?.id ?? null,
    selectedLayerIds: [],
    backgroundColor: { r: 255, g: 0, b: 0, a: 1 },
    colorMode: 'rgb',
    rootGroupId: null,
  };
}

describe('computeConvertColorMode', () => {
  it('returns a new document with the requested mode', () => {
    const result = computeConvertColorMode(makeDoc(), 'grayscale');
    expect(result?.document?.colorMode).toBe('grayscale');
  });

  it('returns undefined when the mode is unchanged', () => {
    expect(computeConvertColorMode(makeDoc(), 'rgb')).toBeUndefined();
  });

  it('snaps the document background color into the mode', () => {
    const result = computeConvertColorMode(makeDoc(), 'grayscale');
    const bg = result?.document?.backgroundColor;
    expect(bg?.r).toBe(bg?.g);
    expect(bg?.g).toBe(bg?.b);
    expect(bg?.a).toBe(1);
  });

  it('converts text layer color so the engine re-renders in the new mode', () => {
    const text = createTextLayer({ name: 'T', text: 'hi', color: { r: 255, g: 0, b: 0, a: 1 } });
    const result = computeConvertColorMode(makeDoc([text]), 'grayscale');
    const converted = result?.document?.layers[0] as TextLayer;
    expect(converted.color).toEqual({ r: 54, g: 54, b: 54, a: 1 });
  });

  it('converts layer effect colors', () => {
    const raster = createRasterLayer({ name: 'L', width: 10, height: 10 });
    const withGlow: Layer = {
      ...raster,
      effects: {
        ...raster.effects,
        outerGlow: { ...raster.effects.outerGlow, enabled: true, color: { r: 0, g: 0, b: 255, a: 1 } },
      },
    };
    const result = computeConvertColorMode(makeDoc([withGlow]), 'grayscale');
    const glow = result?.document?.layers[0]?.effects.outerGlow.color;
    expect(glow).toEqual({ r: 18, g: 18, b: 18, a: 1 });
  });

  it('strips chroma-producing adjustment nodes that would undo the bake', () => {
    const group = createGroupLayer({
      name: 'G',
      children: [],
      adjustments: [
        { id: 'a', enabled: true, type: 'exposure', exposure: 0.5 },
        { id: 'b', enabled: true, type: 'color-balance', shadowsCMY: [0, 0, 0], midtonesCMY: [0, 0, 0], highlightsCMY: [0, 0, 0] },
      ],
    });
    const result = computeConvertColorMode(makeDoc([group]), 'grayscale');
    const converted = result?.document?.layers[0] as GroupLayer;
    expect(converted.adjustments.map((n) => n.type)).toEqual(['exposure']);
  });

  it('keeps luminance-only adjustments untouched', () => {
    const group = createGroupLayer({
      name: 'G',
      children: [],
      adjustments: [{ id: 'a', enabled: true, type: 'contrast', contrast: 10 }],
    });
    const result = computeConvertColorMode(makeDoc([group]), 'grayscale');
    expect((result?.document?.layers[0] as GroupLayer).adjustments).toHaveLength(1);
  });
});

describe('layersWithPixels', () => {
  it('lists every pixel-backed layer but not groups', () => {
    const raster = createRasterLayer({ name: 'L', width: 10, height: 10 });
    const group = createGroupLayer({ name: 'G', children: [raster.id], adjustments: [] });
    expect(layersWithPixels(makeDoc([raster, group]))).toEqual([raster.id]);
  });

  it('includes text layers, which own a rendered texture too', () => {
    const raster = createRasterLayer({ name: 'L', width: 10, height: 10 });
    const text = createTextLayer({ name: 'T', text: 'hi' });
    expect(layersWithPixels(makeDoc([raster, text]))).toEqual([raster.id, text.id]);
  });
});
