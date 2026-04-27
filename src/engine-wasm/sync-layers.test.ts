import { describe, it, expect, vi } from 'vitest';

// The bridge module pulls in the WASM init code at import time. Mock it
// before importing sync-layers so this stays a pure unit test.
vi.mock('./wasm-bridge', () => ({
  addLayer: vi.fn(),
  removeLayer: vi.fn(),
  updateLayer: vi.fn(),
  setLayerOrder: vi.fn(),
  uploadLayerPixels: vi.fn(),
  uploadLayerSparsePixels: vi.fn(),
  uploadLayerMask: vi.fn(),
  removeLayerMask: vi.fn(),
}));

const { layerToDescJson } = await import('./sync-layers');
const { DEFAULT_EFFECTS } = await import('../layers/layer-model');
type TextLayer = import('../types').TextLayer;
type RasterLayer = import('../types').RasterLayer;

const baseTextLayer: TextLayer = {
  id: 'text-1',
  name: 'Text 1',
  type: 'text',
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'normal',
  x: 100,
  y: 100,
  clipToBelow: false,
  effects: DEFAULT_EFFECTS,
  mask: null,
  text: 'TEST',
  fontFamily: 'Impact',
  fontSize: 80,
  fontWeight: 700,
  fontStyle: 'normal',
  color: { r: 255, g: 255, b: 255, a: 1 },
  lineHeight: 1.4,
  letterSpacing: 0,
  textAlign: 'left',
  width: null,
};

const baseRasterLayer: RasterLayer = {
  id: 'raster-1',
  name: 'Raster 1',
  type: 'raster',
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'normal',
  x: 0,
  y: 0,
  clipToBelow: false,
  effects: DEFAULT_EFFECTS,
  mask: null,
  width: 400,
  height: 300,
};

describe('layerToDescJson — issue #225 (effects on text layers)', () => {
  it('serializes outer glow on text layers identically to raster layers', () => {
    const effectsWithGlow = {
      ...DEFAULT_EFFECTS,
      outerGlow: { enabled: true, color: { r: 255, g: 0, b: 0, a: 1 }, size: 30, spread: 5, opacity: 1 },
    };
    const text: TextLayer = { ...baseTextLayer, effects: effectsWithGlow };
    const raster: RasterLayer = { ...baseRasterLayer, effects: effectsWithGlow };

    const textDesc = JSON.parse(layerToDescJson(text, true));
    const rasterDesc = JSON.parse(layerToDescJson(raster, true));

    // Both layer types must populate the outer_glow field — the bug report
    // (#225) says effects "do not render on text layers"; the descriptor
    // sent to the WASM engine MUST include the same effects payload that
    // works for raster layers.
    expect(textDesc.effects.outer_glow).toEqual(rasterDesc.effects.outer_glow);
    expect(textDesc.effects.outer_glow).toBeDefined();
    expect(textDesc.effects.outer_glow.enabled).toBe(true);
    expect(textDesc.effects.outer_glow.size).toBe(30);
    expect(textDesc.effects.outer_glow.color).toEqual([1, 0, 0, 1]);
  });

  it('serializes drop shadow on text layers', () => {
    const text: TextLayer = {
      ...baseTextLayer,
      effects: {
        ...DEFAULT_EFFECTS,
        dropShadow: { enabled: true, color: { r: 0, g: 0, b: 0, a: 0.75 }, offsetX: 4, offsetY: 4, blur: 8, spread: 0, opacity: 0.75 },
      },
    };
    const desc = JSON.parse(layerToDescJson(text, true));
    expect(desc.effects.drop_shadow).toBeDefined();
    expect(desc.effects.drop_shadow.enabled).toBe(true);
    expect(desc.effects.drop_shadow.blur).toBe(8);
  });

  it('serializes inner glow, stroke, and color overlay on text layers', () => {
    const text: TextLayer = {
      ...baseTextLayer,
      effects: {
        ...DEFAULT_EFFECTS,
        innerGlow: { enabled: true, color: { r: 255, g: 255, b: 100, a: 1 }, size: 10, spread: 0, opacity: 0.75 },
        stroke: { enabled: true, color: { r: 0, g: 0, b: 0, a: 1 }, width: 2, position: 'outside' },
        colorOverlay: { enabled: true, color: { r: 100, g: 200, b: 50, a: 1 } },
      },
    };
    const desc = JSON.parse(layerToDescJson(text, true));
    expect(desc.effects.inner_glow?.enabled).toBe(true);
    expect(desc.effects.stroke?.enabled).toBe(true);
    expect(desc.effects.stroke?.position).toBe('Outside');
    expect(desc.effects.color_overlay?.enabled).toBe(true);
  });

  it('reports the text layer type as "Text" so the engine deserializes it correctly', () => {
    const desc = JSON.parse(layerToDescJson(baseTextLayer, true));
    expect(desc.layer_type).toBe('Text');
  });

  it('omits effect entries when disabled (engine sees no effect)', () => {
    const desc = JSON.parse(layerToDescJson(baseTextLayer, true));
    expect(desc.effects.outer_glow).toBeUndefined();
    expect(desc.effects.drop_shadow).toBeUndefined();
  });
});
