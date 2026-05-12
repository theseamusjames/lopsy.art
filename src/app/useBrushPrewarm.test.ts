import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Engine } from '../engine-wasm/wasm-bridge';
import type { RasterLayer, GroupLayer, ToolId } from '../types';

vi.mock('../engine-wasm/wasm-bridge', () => ({
  prewarmStroke: vi.fn(),
  getLayerTextureDimensions: vi.fn(() => null),
}));

vi.mock('../engine/pixel-data-manager', () => ({
  pixelDataManager: {
    remove: vi.fn(),
    setDense: vi.fn(),
    setSparse: vi.fn(),
    get: vi.fn(() => null),
    has: vi.fn(() => false),
    clear: vi.fn(),
    dense: new Map(),
    sparse: new Map(),
  },
}));

const { shouldPrewarmStroke, runBrushPrewarm } = await import('./useBrushPrewarm');
const bridge = await import('../engine-wasm/wasm-bridge');
const { useEditorStore } = await import('./editor-store');
const { DEFAULT_EFFECTS } = await import('../layers/layer-model');

const fakeEngine = () => ({}) as unknown as Engine;

const baseRaster: RasterLayer = {
  id: 'raster-1',
  name: 'Layer 1',
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

const baseGroup: GroupLayer = {
  id: 'group-1',
  name: 'Group',
  type: 'group',
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'normal',
  x: 0,
  y: 0,
  clipToBelow: false,
  effects: DEFAULT_EFFECTS,
  mask: null,
  collapsed: false,
  children: [],
  adjustments: [],
  adjustmentsEnabled: true,
};

const PAINT: ToolId[] = ['brush', 'pencil', 'eraser'];

describe('shouldPrewarmStroke', () => {
  it('returns true for each paint tool on a normal raster layer', () => {
    for (const tool of PAINT) {
      expect(shouldPrewarmStroke(tool, baseRaster)).toBe(true);
    }
  });

  it('returns false for non-paint tools', () => {
    for (const tool of ['move', 'fill', 'gradient', 'stamp', 'eyedropper'] as ToolId[]) {
      expect(shouldPrewarmStroke(tool, baseRaster)).toBe(false);
    }
  });

  it('returns false when there is no layer', () => {
    expect(shouldPrewarmStroke('brush', null)).toBe(false);
    expect(shouldPrewarmStroke('brush', undefined)).toBe(false);
  });

  it('returns false when the layer is locked', () => {
    expect(shouldPrewarmStroke('brush', { ...baseRaster, locked: true })).toBe(false);
  });

  it('returns false for group layers — strokes paint into rasters', () => {
    expect(shouldPrewarmStroke('brush', baseGroup)).toBe(false);
  });
});

describe('runBrushPrewarm', () => {
  beforeEach(() => {
    vi.mocked(bridge.prewarmStroke).mockReset();
    vi.mocked(bridge.prewarmStroke).mockImplementation(() => undefined);
    // Reset store to a known state with our test layer.
    useEditorStore.setState({
      document: {
        id: 'doc-1',
        name: 'untitled',
        width: 800,
        height: 600,
        backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
        layers: [baseRaster],
        layerOrder: [baseRaster.id],
        activeLayerId: baseRaster.id,
        selectedLayerIds: [baseRaster.id],
      },
      dirtyLayerIds: new Set(),
    });
  });

  it('calls prewarmStroke with the engine and layer id', () => {
    runBrushPrewarm(fakeEngine(), baseRaster.id);
    expect(bridge.prewarmStroke).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.prewarmStroke).mock.calls[0]?.[1]).toBe(baseRaster.id);
  });

  it('swallows errors from prewarmStroke so the UI does not crash', () => {
    vi.mocked(bridge.prewarmStroke).mockImplementation(() => {
      throw new Error('GL context lost');
    });
    expect(() => runBrushPrewarm(fakeEngine(), baseRaster.id)).not.toThrow();
  });

  it('expands a smaller-than-doc raster to the full doc area', () => {
    runBrushPrewarm(fakeEngine(), baseRaster.id);
    const layer = useEditorStore.getState().document.layers[0] as RasterLayer;
    // Layer at (0,0) with size 400x300 inside an 800x600 doc grows to 800x600
    // — matches what ensure_layer_full_size does engine-side.
    expect(layer.x).toBe(0);
    expect(layer.y).toBe(0);
    expect(layer.width).toBe(800);
    expect(layer.height).toBe(600);
  });

  it('leaves a layer already covering the doc unchanged', () => {
    useEditorStore.setState({
      document: {
        ...useEditorStore.getState().document,
        layers: [{ ...baseRaster, x: 0, y: 0, width: 800, height: 600 }],
      },
    });
    runBrushPrewarm(fakeEngine(), baseRaster.id);
    const layer = useEditorStore.getState().document.layers[0] as RasterLayer;
    expect(layer.x).toBe(0);
    expect(layer.y).toBe(0);
    expect(layer.width).toBe(800);
    expect(layer.height).toBe(600);
  });

  it('expands JS-side layer dimensions when the engine would expand the texture', () => {
    // Place layer at a negative x to force expansion: union of doc area
    // (0..800) and existing layer (-50..350) is -50..800, width 850.
    useEditorStore.setState({
      document: {
        ...useEditorStore.getState().document,
        layers: [{ ...baseRaster, x: -50, y: -20, width: 400, height: 300 }],
      },
    });
    runBrushPrewarm(fakeEngine(), baseRaster.id);
    const layer = useEditorStore.getState().document.layers[0] as RasterLayer;
    expect(layer.x).toBe(-50);
    expect(layer.y).toBe(-20);
    expect(layer.width).toBe(850);
    expect(layer.height).toBe(620);
  });
});
