import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Engine } from './wasm-bridge';

// The bridge module pulls in the WASM init code at import time. Mock it before
// importing engine-sync so the test stays a pure unit test.
vi.mock('./wasm-bridge', () => ({
  setDocumentSize: vi.fn(),
  setBackgroundColor: vi.fn(),
  setViewport: vi.fn(),
  setGridVisible: vi.fn(),
  setGridSize: vi.fn(),
  setRulersVisible: vi.fn(),
  // Sync functions touched indirectly aren't called in these tests, but the
  // module imports them eagerly — provide noop stubs.
  addLayer: vi.fn(),
  removeLayer: vi.fn(),
  updateLayer: vi.fn(),
  setLayerOrder: vi.fn(),
  uploadLayerPixels: vi.fn(),
  uploadLayerSparsePixels: vi.fn(),
  uploadLayerMask: vi.fn(),
  removeLayerMask: vi.fn(),
  render: vi.fn(),
  markAllDirty: vi.fn(),
  setSelectionMask: vi.fn(),
  clearSelection: vi.fn(),
  setImageExposure: vi.fn(),
  setImageContrast: vi.fn(),
  setImageHighlights: vi.fn(),
  setImageShadows: vi.fn(),
  setImageWhites: vi.fn(),
  setImageBlacks: vi.fn(),
  setImageVignette: vi.fn(),
  setImageSaturation: vi.fn(),
  setImageVibrance: vi.fn(),
  setImageCurvesLut: vi.fn(),
  clearImageCurves: vi.fn(),
  setImageLevelsLut: vi.fn(),
  clearImageLevels: vi.fn(),
  clearImageAdjustments: vi.fn(),
  setGroupAdjustments: vi.fn(),
  setGroupCurvesLut: vi.fn(),
  setGroupLevelsLut: vi.fn(),
  clearGroupAdjustments: vi.fn(),
  setLassoPreview: vi.fn(),
  setPathOverlay: vi.fn(),
  setCropPreview: vi.fn(),
  clearCropPreview: vi.fn(),
  setGradientGuide: vi.fn(),
  clearGradientGuide: vi.fn(),
  setBrushCursor: vi.fn(),
  clearBrushCursor: vi.fn(),
  setTransformOverlay: vi.fn(),
  setMaskEditLayer: vi.fn(),
  clearMaskEditLayer: vi.fn(),
  uploadBrushTip: vi.fn(),
  clearBrushTip: vi.fn(),
  setBrushTipState: vi.fn(),
  setSeamlessPattern: vi.fn(),
}));

vi.mock('./engine-state', () => ({
  getEngine: vi.fn(() => null),
}));

const bridge = await import('./wasm-bridge');
const sync = await import('./engine-sync');
const { createGroupLayer, createRasterLayer } = await import('../layers/layer-model');

// A WeakMap key just needs to be an object — Engines are class instances in
// production, but plain objects suffice here.
const makeFakeEngine = () => ({}) as unknown as Engine;

describe('engine-sync tracked state', () => {
  it('only pushes to the engine when a value actually changes', () => {
    const engine = makeFakeEngine();
    const setDoc = vi.mocked(bridge.setDocumentSize);
    setDoc.mockClear();

    sync.syncDocumentSize(engine, 100, 100);
    sync.syncDocumentSize(engine, 100, 100);
    sync.syncDocumentSize(engine, 100, 100);

    expect(setDoc).toHaveBeenCalledTimes(1);

    sync.syncDocumentSize(engine, 200, 100);
    expect(setDoc).toHaveBeenCalledTimes(2);
  });

  it('keeps tracked state isolated per Engine instance', () => {
    const a = makeFakeEngine();
    const b = makeFakeEngine();
    const setDoc = vi.mocked(bridge.setDocumentSize);
    setDoc.mockClear();

    // Engine A reaches a steady state at 100x100.
    sync.syncDocumentSize(a, 100, 100);
    sync.syncDocumentSize(a, 100, 100);
    expect(setDoc).toHaveBeenCalledTimes(1);

    // Engine B has no prior state — it must receive its own push, not be
    // suppressed by A's tracking.
    sync.syncDocumentSize(b, 100, 100);
    expect(setDoc).toHaveBeenCalledTimes(2);
    expect(setDoc).toHaveBeenLastCalledWith(b, 100, 100);
  });

  it('resetTrackedState clears state for one engine without touching others', () => {
    const a = makeFakeEngine();
    const b = makeFakeEngine();
    const setGrid = vi.mocked(bridge.setGridVisible);
    setGrid.mockClear();

    sync.syncGrid(a, true, 16);
    sync.syncGrid(b, true, 16);
    expect(setGrid).toHaveBeenCalledTimes(2);

    // Reset only A. B's tracked state should still suppress a redundant push.
    sync.resetTrackedState(a);
    sync.syncGrid(a, true, 16);
    sync.syncGrid(b, true, 16);
    expect(setGrid).toHaveBeenCalledTimes(3); // only A re-pushed
  });
});

describe('syncGroupAdjustments — group mask registration', () => {
  beforeEach(() => {
    vi.mocked(bridge.setGroupAdjustments).mockClear();
    vi.mocked(bridge.clearGroupAdjustments).mockClear();
  });

  it('registers a group with an enabled mask even when it has no adjustments', () => {
    const engine = makeFakeEngine();
    const raster = createRasterLayer({ name: 'Layer 1', width: 100, height: 100 });
    const group = {
      ...createGroupLayer({ name: 'Group', children: [raster.id] }),
      blendMode: 'normal' as const,
      mask: {
        id: 'mask-1',
        enabled: true,
        data: new Uint8ClampedArray(100 * 100).fill(128),
        width: 100,
        height: 100,
      },
    };
    sync.syncGroupAdjustments(engine, [raster, group]);
    expect(vi.mocked(bridge.setGroupAdjustments)).toHaveBeenCalledOnce();
    const [, calledId, childrenJson] = vi.mocked(bridge.setGroupAdjustments).mock.calls[0]!;
    expect(calledId).toBe(group.id);
    expect(JSON.parse(childrenJson as string)).toContain(raster.id);
  });

  it('does not register a group with no mask and no adjustments', () => {
    const engine = makeFakeEngine();
    const raster = createRasterLayer({ name: 'Layer 1', width: 100, height: 100 });
    const group = createGroupLayer({ name: 'Group', children: [raster.id] });
    sync.syncGroupAdjustments(engine, [raster, group]);
    expect(vi.mocked(bridge.setGroupAdjustments)).not.toHaveBeenCalled();
  });

  it('does not register a group with a disabled mask and no adjustments', () => {
    const engine = makeFakeEngine();
    const raster = createRasterLayer({ name: 'Layer 1', width: 100, height: 100 });
    const group = {
      ...createGroupLayer({ name: 'Group', children: [raster.id] }),
      mask: {
        id: 'mask-1',
        enabled: false, // mask is disabled
        data: new Uint8ClampedArray(100 * 100).fill(0),
        width: 100,
        height: 100,
      },
    };
    sync.syncGroupAdjustments(engine, [raster, group]);
    expect(vi.mocked(bridge.setGroupAdjustments)).not.toHaveBeenCalled();
  });

  it('registers a group with both adjustments and a mask once', () => {
    const engine = makeFakeEngine();
    const raster = createRasterLayer({ name: 'Layer 1', width: 100, height: 100 });
    const group = {
      ...createGroupLayer({ name: 'Group', children: [raster.id] }),
      blendMode: 'normal' as const,
      adjustmentsEnabled: true,
      adjustments: [{ id: 'exp-1', type: 'exposure' as const, enabled: true, exposure: 1.0 }],
      mask: {
        id: 'mask-1',
        enabled: true,
        data: new Uint8ClampedArray(100 * 100).fill(255),
        width: 100,
        height: 100,
      },
    };
    sync.syncGroupAdjustments(engine, [raster, group]);
    // Should be registered exactly once — mask and adjustments don't double-register
    expect(vi.mocked(bridge.setGroupAdjustments)).toHaveBeenCalledOnce();
  });

  it('does not register a pass-through group even when it has adjustments', () => {
    const engine = makeFakeEngine();
    const raster = createRasterLayer({ name: 'Layer 1', width: 100, height: 100 });
    const group = {
      ...createGroupLayer({ name: 'Group', children: [raster.id] }),
      blendMode: 'pass-through' as const,
      adjustmentsEnabled: true,
      adjustments: [{ id: 'exp-1', type: 'exposure' as const, enabled: true, exposure: 1.5 }],
    };
    sync.syncGroupAdjustments(engine, [raster, group]);
    expect(vi.mocked(bridge.setGroupAdjustments)).not.toHaveBeenCalled();
  });

  it('does not register a pass-through group with no adjustments and no mask', () => {
    const engine = makeFakeEngine();
    const raster = createRasterLayer({ name: 'Layer 1', width: 100, height: 100 });
    const group = createGroupLayer({ name: 'Group', children: [raster.id] });
    sync.syncGroupAdjustments(engine, [raster, group]);
    expect(vi.mocked(bridge.setGroupAdjustments)).not.toHaveBeenCalled();
  });
});

describe('flattenGroupDescendants', () => {
  it('returns the direct children of a flat group', () => {
    const a = createRasterLayer({ name: 'A', width: 10, height: 10 });
    const b = createRasterLayer({ name: 'B', width: 10, height: 10 });
    const group = createGroupLayer({ name: 'Group', children: [a.id, b.id] });
    const out = sync.flattenGroupDescendants([a, b, group], group.id);
    expect(out).toEqual([a.id, b.id]);
  });

  it('includes descendants of a nested sub-group', () => {
    const a = createRasterLayer({ name: 'A', width: 10, height: 10 });
    const b = createRasterLayer({ name: 'B', width: 10, height: 10 });
    const sub = createGroupLayer({ name: 'Sub', children: [a.id, b.id] });
    const c = createRasterLayer({ name: 'C', width: 10, height: 10 });
    const root = createGroupLayer({ name: 'Root', children: [sub.id, c.id] });
    const out = sync.flattenGroupDescendants([a, b, sub, c, root], root.id);
    // Sub-group marker is included along with its descendants. The WASM
    // compositor skips Group-type entries when iterating layer_stack, so
    // including them is harmless and keeps the descendant walk simple.
    expect(out).toEqual([sub.id, a.id, b.id, c.id]);
  });

  it('walks deeply nested groups recursively', () => {
    const leaf = createRasterLayer({ name: 'Leaf', width: 10, height: 10 });
    const inner = createGroupLayer({ name: 'Inner', children: [leaf.id] });
    const mid = createGroupLayer({ name: 'Mid', children: [inner.id] });
    const root = createGroupLayer({ name: 'Root', children: [mid.id] });
    const out = sync.flattenGroupDescendants([leaf, inner, mid, root], root.id);
    expect(out).toEqual([mid.id, inner.id, leaf.id]);
  });

  it('returns empty array when group id is unknown', () => {
    const a = createRasterLayer({ name: 'A', width: 10, height: 10 });
    expect(sync.flattenGroupDescendants([a], 'no-such-group')).toEqual([]);
  });

  it('returns empty array for a leaf layer (non-group)', () => {
    const a = createRasterLayer({ name: 'A', width: 10, height: 10 });
    expect(sync.flattenGroupDescendants([a], a.id)).toEqual([]);
  });
});

describe('syncGroupAdjustments — nested descendants are routed to the group', () => {
  beforeEach(() => {
    vi.mocked(bridge.setGroupAdjustments).mockClear();
    vi.mocked(bridge.clearGroupAdjustments).mockClear();
  });

  it('passes every descendant id (not just direct children) when the root group has adjustments', () => {
    // This is the regression test for #395. Before the fix the root group's
    // setGroupAdjustments call only listed direct children, so the on-screen
    // compositor's child_to_group lookup missed sub-group descendants and
    // they rendered directly onto the composite. The group's normal-blend
    // finalize then covered them with the (partial) scratch contents, which
    // is what the user reported as "viewport near-black, export correct".
    const engine = makeFakeEngine();
    const bg = createRasterLayer({ name: 'Background', width: 100, height: 100 });
    const leaf1 = createRasterLayer({ name: 'Leaf 1', width: 100, height: 100 });
    const leaf2 = createRasterLayer({ name: 'Leaf 2', width: 100, height: 100 });
    const subGroup = createGroupLayer({ name: 'Sub', children: [leaf1.id, leaf2.id] });
    const root = {
      ...createGroupLayer({ name: 'Root', children: [bg.id, subGroup.id] }),
      blendMode: 'normal' as const,
      adjustmentsEnabled: true,
      adjustments: [{ id: 'c-1', type: 'contrast' as const, enabled: true, contrast: 0.15 }],
    };
    sync.syncGroupAdjustments(engine, [bg, leaf1, leaf2, subGroup, root]);
    expect(vi.mocked(bridge.setGroupAdjustments)).toHaveBeenCalledOnce();
    const [, , childrenJson] = vi.mocked(bridge.setGroupAdjustments).mock.calls[0]!;
    const ids = JSON.parse(childrenJson as string) as string[];
    // Direct children
    expect(ids).toContain(bg.id);
    expect(ids).toContain(subGroup.id);
    // Sub-group descendants — these are the IDs the pre-fix code dropped
    expect(ids).toContain(leaf1.id);
    expect(ids).toContain(leaf2.id);
  });
});
