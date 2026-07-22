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
  setImageInvert: vi.fn(),
  setImageHueSaturation: vi.fn(),
  setImageColorBalance: vi.fn(),
  setImagePhotoFilter: vi.fn(),
  setImageBlackWhite: vi.fn(),
  clearImageBlackWhite: vi.fn(),
  setImageChannelMixer: vi.fn(),
  clearImageChannelMixer: vi.fn(),
  setImageGradientMapLut: vi.fn(),
  clearImageGradientMap: vi.fn(),
  setChannelMask: vi.fn(),
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
  setTextLayerContent: vi.fn(),
  renderTextLayer: vi.fn(() => new Int32Array([100, 50, 0, 0])),
  getRenderedTextPixels: vi.fn(() => new Uint8Array(100 * 50 * 4)),
}));

vi.mock('./engine-state', () => ({
  getEngine: vi.fn(() => null),
}));

const bridge = await import('./wasm-bridge');
const sync = await import('./engine-sync');
const { createGroupLayer, createRasterLayer } = await import('../layers/layer-model');
const { DEFAULT_ADJUSTMENTS } = await import('../filters/image-adjustments');

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

describe('syncChannelVisibility — per-frame diffing (#595 follow-up)', () => {
  // setChannelMask unconditionally sets needs_recomposite on the engine, so
  // calling it on every frame defeats the render() frame gate. The sync must
  // only push when the visibility actually changes.
  it('pushes once for repeated identical visibility, again on change', () => {
    const engine = makeFakeEngine();
    const setMask = vi.mocked(bridge.setChannelMask);
    setMask.mockClear();

    const allOn = { r: true, g: true, b: true, a: true };
    sync.syncChannelVisibility(engine, allOn);
    sync.syncChannelVisibility(engine, allOn);
    sync.syncChannelVisibility(engine, { ...allOn });
    expect(setMask).toHaveBeenCalledTimes(1);
    expect(setMask).toHaveBeenLastCalledWith(engine, 1.0, 1.0, 1.0, 1.0);

    sync.syncChannelVisibility(engine, { r: true, g: false, b: true, a: true });
    expect(setMask).toHaveBeenCalledTimes(2);
    expect(setMask).toHaveBeenLastCalledWith(engine, 1.0, 0.0, 1.0, 1.0);
  });

  it('re-pushes after resetTrackedState (undo/redo full re-sync)', () => {
    const engine = makeFakeEngine();
    const setMask = vi.mocked(bridge.setChannelMask);
    setMask.mockClear();

    const allOn = { r: true, g: true, b: true, a: true };
    sync.syncChannelVisibility(engine, allOn);
    sync.resetTrackedState(engine);
    sync.syncChannelVisibility(engine, allOn);
    expect(setMask).toHaveBeenCalledTimes(2);
  });
});

describe('syncSeamlessPattern — per-frame diffing + wrap flag (#349)', () => {
  beforeEach(() => {
    vi.mocked(bridge.setSeamlessPattern).mockClear();
  });

  it('pushes once for repeated identical state, again when show/dim/wrap changes', () => {
    const engine = makeFakeEngine();
    sync.syncSeamlessPattern(engine, false, true, false);
    // Initial call from cleared tracked state → first push.
    sync.syncSeamlessPattern(engine, false, true, false);
    expect(vi.mocked(bridge.setSeamlessPattern)).toHaveBeenCalledTimes(0);
    // (tracked state initialises to the same values, so the first call above
    // was a no-op. Turning on `show` should push.)
    sync.syncSeamlessPattern(engine, true, true, false);
    expect(vi.mocked(bridge.setSeamlessPattern)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.setSeamlessPattern)).toHaveBeenLastCalledWith(engine, true, true, false);

    // Flipping wrap independently pushes again — this is the new bit from #349.
    sync.syncSeamlessPattern(engine, true, true, true);
    expect(vi.mocked(bridge.setSeamlessPattern)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(bridge.setSeamlessPattern)).toHaveBeenLastCalledWith(engine, true, true, true);

    // Same values three times → no extra pushes.
    sync.syncSeamlessPattern(engine, true, true, true);
    sync.syncSeamlessPattern(engine, true, true, true);
    expect(vi.mocked(bridge.setSeamlessPattern)).toHaveBeenCalledTimes(2);
  });

  it('re-pushes after resetTrackedState so undo/redo full re-sync includes wrap', () => {
    const engine = makeFakeEngine();
    sync.syncSeamlessPattern(engine, true, false, true);
    expect(vi.mocked(bridge.setSeamlessPattern)).toHaveBeenCalledTimes(1);
    sync.resetTrackedState(engine);
    sync.syncSeamlessPattern(engine, true, false, true);
    expect(vi.mocked(bridge.setSeamlessPattern)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(bridge.setSeamlessPattern)).toHaveBeenLastCalledWith(engine, true, false, true);
  });
});

describe('syncMaskEditMode — per-frame diffing (#595 follow-up)', () => {
  beforeEach(() => {
    vi.mocked(bridge.setMaskEditLayer).mockClear();
    vi.mocked(bridge.clearMaskEditLayer).mockClear();
  });

  it('sets the mask-edit layer once for repeated identical state', () => {
    const engine = makeFakeEngine();
    sync.syncMaskEditMode(engine, true, 'layer-1');
    sync.syncMaskEditMode(engine, true, 'layer-1');
    sync.syncMaskEditMode(engine, true, 'layer-1');
    expect(vi.mocked(bridge.setMaskEditLayer)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.clearMaskEditLayer)).not.toHaveBeenCalled();
  });

  it('clears once when mask edit mode turns off, then stays quiet', () => {
    const engine = makeFakeEngine();
    sync.syncMaskEditMode(engine, true, 'layer-1');
    sync.syncMaskEditMode(engine, false, 'layer-1');
    sync.syncMaskEditMode(engine, false, 'layer-1');
    sync.syncMaskEditMode(engine, false, null);
    expect(vi.mocked(bridge.setMaskEditLayer)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.clearMaskEditLayer)).toHaveBeenCalledTimes(1);
  });

  it('clears on the first frame (engine state unknown) and re-pushes when the active layer changes', () => {
    const engine = makeFakeEngine();
    sync.syncMaskEditMode(engine, false, null);
    expect(vi.mocked(bridge.clearMaskEditLayer)).toHaveBeenCalledTimes(1);

    sync.syncMaskEditMode(engine, true, 'layer-1');
    sync.syncMaskEditMode(engine, true, 'layer-2');
    expect(vi.mocked(bridge.setMaskEditLayer)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(bridge.setMaskEditLayer)).toHaveBeenLastCalledWith(engine, 'layer-2');
  });

  it('re-pushes after resetTrackedState even when state is unchanged', () => {
    const engine = makeFakeEngine();
    sync.syncMaskEditMode(engine, true, 'layer-1');
    sync.resetTrackedState(engine);
    sync.syncMaskEditMode(engine, true, 'layer-1');
    expect(vi.mocked(bridge.setMaskEditLayer)).toHaveBeenCalledTimes(2);
  });
});

describe('syncAdjustments — per-frame diffing (#595 follow-up)', () => {
  beforeEach(() => {
    vi.mocked(bridge.clearImageAdjustments).mockClear();
    vi.mocked(bridge.setImageExposure).mockClear();
    vi.mocked(bridge.setImageContrast).mockClear();
  });

  it('clears once while disabled instead of every frame', () => {
    const engine = makeFakeEngine();
    const adjustments = { ...DEFAULT_ADJUSTMENTS };
    sync.syncAdjustments(engine, adjustments, false);
    sync.syncAdjustments(engine, adjustments, false);
    sync.syncAdjustments(engine, adjustments, false);
    expect(vi.mocked(bridge.clearImageAdjustments)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.setImageExposure)).not.toHaveBeenCalled();
  });

  it('pushes setters once per adjustments reference, not per frame', () => {
    const engine = makeFakeEngine();
    const adjustments = { ...DEFAULT_ADJUSTMENTS, exposure: 0.5 };
    sync.syncAdjustments(engine, adjustments, true);
    sync.syncAdjustments(engine, adjustments, true);
    sync.syncAdjustments(engine, adjustments, true);
    expect(vi.mocked(bridge.setImageExposure)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.setImageExposure)).toHaveBeenLastCalledWith(engine, 0.5);

    // The UI store replaces the object on edit — new reference, new push.
    sync.syncAdjustments(engine, { ...adjustments, exposure: 1.0 }, true);
    expect(vi.mocked(bridge.setImageExposure)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(bridge.setImageExposure)).toHaveBeenLastCalledWith(engine, 1.0);
  });

  it('re-applies after a disable/enable round-trip with the same reference', () => {
    const engine = makeFakeEngine();
    const adjustments = { ...DEFAULT_ADJUSTMENTS, contrast: 0.25 };
    sync.syncAdjustments(engine, adjustments, true);
    sync.syncAdjustments(engine, adjustments, false);
    sync.syncAdjustments(engine, adjustments, true);
    expect(vi.mocked(bridge.clearImageAdjustments)).toHaveBeenCalledTimes(1);
    // clearImageAdjustments wiped the engine values; re-enable must re-push
    // even though the JS object reference never changed.
    expect(vi.mocked(bridge.setImageContrast)).toHaveBeenCalledTimes(2);
  });

  it('re-pushes after resetTrackedState (undo/redo full re-sync)', () => {
    const engine = makeFakeEngine();
    const adjustments = { ...DEFAULT_ADJUSTMENTS, exposure: 0.5 };
    sync.syncAdjustments(engine, adjustments, true);
    sync.resetTrackedState(engine);
    sync.syncAdjustments(engine, adjustments, true);
    expect(vi.mocked(bridge.setImageExposure)).toHaveBeenCalledTimes(2);
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

  it('registers a pass-through group when it has adjustments (regression: PR #492)', () => {
    // If syncGroupAdjustments skips pass-through groups, curves / levels /
    // exposure on a user-selected pass-through group silently no-op — which
    // is exactly what shipped briefly in #492. Lock the correct contract in
    // place: the group MUST register so the engine knows which child ids to
    // apply the adjustments to during compositing.
    const engine = makeFakeEngine();
    const raster = createRasterLayer({ name: 'Layer 1', width: 100, height: 100 });
    const group = {
      ...createGroupLayer({ name: 'Group', children: [raster.id] }),
      blendMode: 'pass-through' as const,
      adjustmentsEnabled: true,
      adjustments: [{ id: 'exp-1', type: 'exposure' as const, enabled: true, exposure: 1.5 }],
    };
    sync.syncGroupAdjustments(engine, [raster, group]);
    expect(vi.mocked(bridge.setGroupAdjustments)).toHaveBeenCalledOnce();
  });

  it('does not register a pass-through group with no adjustments and no mask', () => {
    const engine = makeFakeEngine();
    const raster = createRasterLayer({ name: 'Layer 1', width: 100, height: 100 });
    const group = {
      ...createGroupLayer({ name: 'Group', children: [raster.id] }),
      blendMode: 'pass-through' as const,
    };
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

describe('syncTextLayers — cache the rendered text props (#685)', () => {
  // Without this cache, syncTextLayers rasterizes text via swash, reads the
  // resulting RGBA back from WASM, and re-uploads it to the GPU on every
  // dirty frame — including frames dirtied only by mouse movement over the
  // canvas. See docs/issue #685.
  beforeEach(() => {
    vi.mocked(bridge.setTextLayerContent).mockClear();
    vi.mocked(bridge.renderTextLayer).mockClear();
    vi.mocked(bridge.getRenderedTextPixels).mockClear();
    vi.mocked(bridge.uploadLayerPixels).mockClear();
  });

  const white = { r: 255, g: 255, b: 255, a: 1 };
  const editing = (text: string, x = 10, y = 20) => ({
    layerId: 'layer-1',
    bounds: { x, y, width: 200, height: null },
    text,
    cursorPos: text.length,
    isNew: false,
    originalVisible: true,
  });

  const call = (
    engine: Engine,
    state: ReturnType<typeof editing> | null,
    onPos: (id: string, x: number, y: number) => void = () => {},
  ) => {
    sync.syncTextLayers(
      engine,
      state,
      24,
      'Inter',
      400,
      'normal',
      'left',
      white,
      false,
      false,
      onPos,
    );
  };

  it('skips rasterize/readback/upload when props are unchanged', () => {
    const engine = makeFakeEngine();
    call(engine, editing('hello'));
    call(engine, editing('hello'));
    call(engine, editing('hello'));

    expect(vi.mocked(bridge.setTextLayerContent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.renderTextLayer)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.getRenderedTextPixels)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.uploadLayerPixels)).toHaveBeenCalledTimes(1);
  });

  it('re-renders when the text content changes', () => {
    const engine = makeFakeEngine();
    call(engine, editing('a'));
    call(engine, editing('ab'));
    call(engine, editing('abc'));

    expect(vi.mocked(bridge.renderTextLayer)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(bridge.uploadLayerPixels)).toHaveBeenCalledTimes(3);
  });

  it('re-renders when bounds x/y change (drag the text box)', () => {
    const engine = makeFakeEngine();
    call(engine, editing('hi', 10, 10));
    call(engine, editing('hi', 20, 10));
    call(engine, editing('hi', 20, 30));

    expect(vi.mocked(bridge.renderTextLayer)).toHaveBeenCalledTimes(3);
  });

  it('empty text uploads the 1x1 clear once and skips subsequent identical calls', () => {
    const engine = makeFakeEngine();
    call(engine, editing(''));
    call(engine, editing(''));
    call(engine, editing(''));

    expect(vi.mocked(bridge.uploadLayerPixels)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.renderTextLayer)).not.toHaveBeenCalled();
  });

  it('empty → non-empty transitions to a fresh rasterize', () => {
    const engine = makeFakeEngine();
    call(engine, editing(''));
    call(engine, editing('now with text'));
    expect(vi.mocked(bridge.renderTextLayer)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.uploadLayerPixels)).toHaveBeenCalledTimes(2);
  });

  it('clears the cache when text editing ends so re-entry re-renders', () => {
    const engine = makeFakeEngine();
    call(engine, editing('hello'));
    expect(vi.mocked(bridge.renderTextLayer)).toHaveBeenCalledTimes(1);

    // User exits edit mode.
    call(engine, null);
    call(engine, null);

    // Re-enters with the identical props — the texture may have been mutated
    // by paint/filter operations while not editing, so we must re-render.
    call(engine, editing('hello'));
    expect(vi.mocked(bridge.renderTextLayer)).toHaveBeenCalledTimes(2);
  });

  it('re-renders after resetTrackedState (undo/redo full re-sync)', () => {
    const engine = makeFakeEngine();
    call(engine, editing('hello'));
    sync.resetTrackedState(engine);
    call(engine, editing('hello'));

    expect(vi.mocked(bridge.renderTextLayer)).toHaveBeenCalledTimes(2);
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
