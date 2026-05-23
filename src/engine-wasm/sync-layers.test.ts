import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Engine } from './wasm-bridge';

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

const { layerToDescJson, buildPassThroughOpacityMap, syncLayers, isPassThroughGroup } = await import('./sync-layers');
const { DEFAULT_EFFECTS, createGroupLayer } = await import('../layers/layer-model');
const { buildLayerIndex } = await import('../layers/layer-index');
const bridge = await import('./wasm-bridge');
type TextLayer = import('../types').TextLayer;
type RasterLayer = import('../types').RasterLayer;
type GroupLayer = import('../types').GroupLayer;

const makeFakeEngine = () => ({}) as unknown as Engine;

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
  underline: false,
  strikethrough: false,
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

describe('layerToDescJson — issue #239 (floating-point layer positions)', () => {
  it('rounds fractional x/y so the WASM engine can deserialize as i32', () => {
    const layer: RasterLayer = { ...baseRasterLayer, x: 99.794921875, y: 110.341796875 };
    const desc = JSON.parse(layerToDescJson(layer, true));
    expect(Number.isInteger(desc.x)).toBe(true);
    expect(Number.isInteger(desc.y)).toBe(true);
    expect(desc.x).toBe(100);
    expect(desc.y).toBe(110);
  });

  it('rounds negative fractional positions correctly', () => {
    const layer: RasterLayer = { ...baseRasterLayer, x: -0.4, y: -1.6 };
    const desc = JSON.parse(layerToDescJson(layer, true));
    expect(Number.isInteger(desc.x)).toBe(true);
    expect(Number.isInteger(desc.y)).toBe(true);
    expect(desc.x).toBe(0);
    expect(desc.y).toBe(-2);
  });

  it('passes integer positions through unchanged', () => {
    const layer: RasterLayer = { ...baseRasterLayer, x: 42, y: 7 };
    const desc = JSON.parse(layerToDescJson(layer, true));
    expect(desc.x).toBe(42);
    expect(desc.y).toBe(7);
  });
});

describe('layerToDescJson — group layer mask serialization', () => {
  it('includes mask field in descriptor when group has a mask', () => {
    const group: GroupLayer = {
      ...createGroupLayer({ name: 'Group' }),
      mask: {
        id: 'mask-1',
        enabled: true,
        data: new Uint8ClampedArray(400 * 300).fill(255),
        width: 400,
        height: 300,
      },
    };
    const desc = JSON.parse(layerToDescJson(group, true));
    expect(desc.mask).not.toBeNull();
    expect(desc.mask.enabled).toBe(true);
    expect(desc.mask.width).toBe(400);
    expect(desc.mask.height).toBe(300);
  });

  it('includes null mask field when group has no mask', () => {
    const group = createGroupLayer({ name: 'Group' });
    const desc = JSON.parse(layerToDescJson(group, true));
    expect(desc.mask).toBeNull();
  });

  it('serializes group layer type as "Group"', () => {
    const group = createGroupLayer({ name: 'Group' });
    const desc = JSON.parse(layerToDescJson(group, true));
    expect(desc.layer_type).toBe('Group');
  });
});

describe('syncLayers — group mask upload', () => {
  beforeEach(() => {
    vi.mocked(bridge.addLayer).mockClear();
    vi.mocked(bridge.uploadLayerMask).mockClear();
    vi.mocked(bridge.removeLayerMask).mockClear();
  });

  it('calls uploadLayerMask for a group layer that has a mask', () => {
    const engine = makeFakeEngine();
    const maskData = new Uint8ClampedArray(400 * 300).fill(255);
    const group: GroupLayer = {
      ...createGroupLayer({ name: 'Group' }),
      mask: {
        id: 'mask-1',
        enabled: true,
        data: maskData,
        width: 400,
        height: 300,
      },
    };
    syncLayers(engine, [group], [group.id], new Set());
    expect(vi.mocked(bridge.uploadLayerMask)).toHaveBeenCalledOnce();
    const [calledEngine, calledId, , calledW, calledH] = vi.mocked(bridge.uploadLayerMask).mock.calls[0]!;
    expect(calledEngine).toBe(engine);
    expect(calledId).toBe(group.id);
    expect(calledW).toBe(400);
    expect(calledH).toBe(300);
  });

  it('calls uploadLayerMask for both a raster layer and a group layer when both have masks', () => {
    const engine = makeFakeEngine();
    const raster: RasterLayer = {
      ...baseRasterLayer,
      id: 'r1',
      mask: {
        id: 'mask-r',
        enabled: true,
        data: new Uint8ClampedArray(400 * 300).fill(200),
        width: 400,
        height: 300,
      },
    };
    const group: GroupLayer = {
      ...createGroupLayer({ name: 'Group', children: [raster.id] }),
      mask: {
        id: 'mask-g',
        enabled: true,
        data: new Uint8ClampedArray(400 * 300).fill(128),
        width: 400,
        height: 300,
      },
    };
    syncLayers(engine, [raster, group], [group.id, raster.id], new Set());
    expect(vi.mocked(bridge.uploadLayerMask)).toHaveBeenCalledTimes(2);
    const uploadedIds = vi.mocked(bridge.uploadLayerMask).mock.calls.map((c: unknown[]) => c[1]);
    expect(uploadedIds).toContain(raster.id);
    expect(uploadedIds).toContain(group.id);
  });

  it('does not call uploadLayerMask for a group without a mask', () => {
    const engine = makeFakeEngine();
    const group = createGroupLayer({ name: 'Group' });
    syncLayers(engine, [group], [group.id], new Set());
    expect(vi.mocked(bridge.uploadLayerMask)).not.toHaveBeenCalled();
  });
});

describe('syncLayers — tracked-state cleanup on layer removal', () => {
  beforeEach(() => {
    vi.mocked(bridge.addLayer).mockClear();
    vi.mocked(bridge.removeLayer).mockClear();
    vi.mocked(bridge.uploadLayerMask).mockClear();
  });

  it('drains every per-layer Map / Set when a layer is removed', async () => {
    const { getTracked, resetTrackedState } = await import('./sync-state');
    const engine = makeFakeEngine();
    resetTrackedState(engine);

    const maskData = new Uint8ClampedArray(64 * 64).fill(128);
    const raster: RasterLayer = {
      ...baseRasterLayer,
      id: 'r1',
      mask: { id: 'm1', enabled: true, data: maskData, width: 64, height: 64 },
    };

    // First sync: layer is present.
    syncLayers(engine, [raster], [raster.id], new Set([raster.id]));
    const tracked = getTracked(engine);
    // Pre-condition: every per-layer Map / Set carries an entry for r1.
    expect(tracked.layerIds.has('r1')).toBe(true);
    expect(tracked.layerVersions.has('r1')).toBe(true);
    expect(tracked.layerRefs.has('r1')).toBe(true);
    expect(tracked.layerEffectiveVisible.has('r1')).toBe(true);
    expect(tracked.layerPassThroughOpacity.has('r1')).toBe(true);
    expect(tracked.masksOnEngine.has('r1')).toBe(true);
    expect(tracked.maskDataRefs.has('r1')).toBe(true);

    // Seed pathTextKeys directly so the invariant covers it even though
    // we don't have a path-text layer in this fixture.
    if (!tracked.pathTextKeys) tracked.pathTextKeys = new Map();
    tracked.pathTextKeys.set('r1', 'fake-key');

    // Second sync: layer is gone.
    syncLayers(engine, [], [], new Set());

    // Post-condition: every per-layer Map / Set is empty for r1.
    expect(tracked.layerIds.has('r1')).toBe(false);
    expect(tracked.layerVersions.has('r1')).toBe(false);
    expect(tracked.layerRefs.has('r1')).toBe(false);
    expect(tracked.layerEffectiveVisible.has('r1')).toBe(false);
    expect(tracked.layerPassThroughOpacity.has('r1')).toBe(false);
    expect(tracked.masksOnEngine.has('r1')).toBe(false);
    expect(tracked.maskDataRefs.has('r1')).toBe(false);
    expect(tracked.pixelDataVersions.has('r1')).toBe(false);
    expect(tracked.sparseVersions.has('r1')).toBe(false);
    expect(tracked.pathTextKeys?.has('r1')).toBe(false);
  });
});

const baseGroup: GroupLayer = {
  id: 'group-1',
  name: 'Group 1',
  type: 'group',
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'pass-through',
  x: 0,
  y: 0,
  clipToBelow: false,
  effects: DEFAULT_EFFECTS,
  mask: null,
  children: ['raster-1'],
  collapsed: false,
  adjustments: [],
  adjustmentsEnabled: true,
};

describe('layerToDescJson — pass-through blend mode', () => {
  it('serializes pass-through group with empty children (no group-scratch routing)', () => {
    const desc = JSON.parse(layerToDescJson(baseGroup, true, 1.0, true));
    expect(desc.children).toEqual([]);
  });

  it('serializes normal group with its actual children', () => {
    const normalGroup: GroupLayer = { ...baseGroup, blendMode: 'normal' };
    const desc = JSON.parse(layerToDescJson(normalGroup, true, 1.0, false));
    expect(desc.children).toEqual(['raster-1']);
  });

  it('multiplies opacity by pass-through multiplier in the descriptor', () => {
    const child: RasterLayer = { ...baseRasterLayer, opacity: 0.8 };
    const desc = JSON.parse(layerToDescJson(child, true, 0.5));
    expect(desc.opacity).toBeCloseTo(0.4);
  });

  it('leaves opacity unchanged when multiplier is 1.0', () => {
    const child: RasterLayer = { ...baseRasterLayer, opacity: 0.7 };
    const desc = JSON.parse(layerToDescJson(child, true, 1.0));
    expect(desc.opacity).toBeCloseTo(0.7);
  });
});

describe('isPassThroughGroup — issue #523', () => {
  it('reports true for a vanilla pass-through group', () => {
    expect(isPassThroughGroup(baseGroup)).toBe(true);
  });

  it('reports false for non-group layers', () => {
    expect(isPassThroughGroup(baseRasterLayer)).toBe(false);
  });

  it('reports false for groups with blendMode !== pass-through', () => {
    expect(isPassThroughGroup({ ...baseGroup, blendMode: 'normal' })).toBe(false);
    expect(isPassThroughGroup({ ...baseGroup, blendMode: 'multiply' })).toBe(false);
  });

  it('reports false when adjustments are enabled and present', () => {
    const adjGroup: GroupLayer = {
      ...baseGroup,
      adjustments: [{ id: 'a', type: 'exposure', exposure: 0.5 }] as unknown as GroupLayer['adjustments'],
      adjustmentsEnabled: true,
    };
    expect(isPassThroughGroup(adjGroup)).toBe(false);
  });

  it('reports true when adjustments array is empty even if adjustmentsEnabled', () => {
    expect(isPassThroughGroup({ ...baseGroup, adjustmentsEnabled: true, adjustments: [] })).toBe(true);
  });

  it('reports false when a mask is enabled', () => {
    const maskedGroup: GroupLayer = {
      ...baseGroup,
      mask: { id: 'mask-pt', data: new Uint8ClampedArray(4), width: 2, height: 2, enabled: true },
    };
    expect(isPassThroughGroup(maskedGroup)).toBe(false);
  });

  it('reports false when any layer effect is enabled (drop shadow)', () => {
    const withShadow: GroupLayer = {
      ...baseGroup,
      effects: { ...DEFAULT_EFFECTS, dropShadow: { ...DEFAULT_EFFECTS.dropShadow, enabled: true } },
    };
    expect(isPassThroughGroup(withShadow)).toBe(false);
  });

  it('reports false when stroke or outer glow effect is enabled', () => {
    const withStroke: GroupLayer = {
      ...baseGroup,
      effects: { ...DEFAULT_EFFECTS, stroke: { ...DEFAULT_EFFECTS.stroke, enabled: true } },
    };
    const withGlow: GroupLayer = {
      ...baseGroup,
      effects: { ...DEFAULT_EFFECTS, outerGlow: { ...DEFAULT_EFFECTS.outerGlow, enabled: true } },
    };
    expect(isPassThroughGroup(withStroke)).toBe(false);
    expect(isPassThroughGroup(withGlow)).toBe(false);
  });
});

describe('buildPassThroughOpacityMap', () => {
  it('returns 1.0 for layers with no pass-through ancestors', () => {
    const layers = [baseRasterLayer, { ...baseGroup, blendMode: 'normal' as const }];
    const index = buildLayerIndex(layers);
    const map = buildPassThroughOpacityMap(layers, index);
    expect(map.get('raster-1')).toBe(1.0);
    expect(map.get('group-1')).toBe(1.0);
  });

  it('returns group opacity as multiplier for direct children of pass-through group', () => {
    const group: GroupLayer = { ...baseGroup, opacity: 0.6, blendMode: 'pass-through' };
    const child: RasterLayer = { ...baseRasterLayer };
    const layers = [child, group];
    const index = buildLayerIndex(layers);
    const map = buildPassThroughOpacityMap(layers, index);
    expect(map.get('raster-1')).toBeCloseTo(0.6);
  });

  it('multiplies opacity across nested pass-through groups', () => {
    const outerGroup: GroupLayer = {
      ...baseGroup,
      id: 'outer',
      opacity: 0.8,
      blendMode: 'pass-through',
      children: ['inner'],
    };
    const innerGroup: GroupLayer = {
      ...baseGroup,
      id: 'inner',
      opacity: 0.5,
      blendMode: 'pass-through',
      children: ['raster-1'],
    };
    const child: RasterLayer = { ...baseRasterLayer };
    const layers = [child, innerGroup, outerGroup];
    const index = buildLayerIndex(layers);
    const map = buildPassThroughOpacityMap(layers, index);
    expect(map.get('raster-1')).toBeCloseTo(0.4);
    expect(map.get('inner')).toBeCloseTo(0.8);
  });

  it('stops multiplying at a non-pass-through group boundary', () => {
    const outerGroup: GroupLayer = {
      ...baseGroup,
      id: 'outer',
      opacity: 0.5,
      blendMode: 'normal',
      children: ['inner'],
    };
    const innerGroup: GroupLayer = {
      ...baseGroup,
      id: 'inner',
      opacity: 0.8,
      blendMode: 'pass-through',
      children: ['raster-1'],
    };
    const child: RasterLayer = { ...baseRasterLayer };
    const layers = [child, innerGroup, outerGroup];
    const index = buildLayerIndex(layers);
    const map = buildPassThroughOpacityMap(layers, index);
    expect(map.get('raster-1')).toBeCloseTo(0.8);
    expect(map.get('inner')).toBe(1.0);
  });

  it('returns 1.0 for the pass-through group itself (no self-multiplication)', () => {
    const group: GroupLayer = { ...baseGroup, opacity: 0.6, blendMode: 'pass-through' };
    const child: RasterLayer = { ...baseRasterLayer };
    const layers = [child, group];
    const index = buildLayerIndex(layers);
    const map = buildPassThroughOpacityMap(layers, index);
    expect(map.get('group-1')).toBe(1.0);
  });

  it('stops multiplying when pass-through group has active adjustments', () => {
    const group: GroupLayer = {
      ...baseGroup,
      opacity: 0.6,
      blendMode: 'pass-through',
      adjustmentsEnabled: true,
      adjustments: [{ id: 'exp-1', type: 'exposure' as const, enabled: true, exposure: 1.0 }],
    };
    const child: RasterLayer = { ...baseRasterLayer };
    const layers = [child, group];
    const index = buildLayerIndex(layers);
    const map = buildPassThroughOpacityMap(layers, index);
    expect(map.get('raster-1')).toBe(1.0);
  });
});
