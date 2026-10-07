import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// #771 — every filter / pattern / color-lut / mesh-warp / tilt-shift /
// liquify entry point on the menu bar now calls syncLayerAfterFullSize
// so the JS-side layer bounds stay in step with the WASM engine's
// ensure_layer_full_size expansion. Without it the next descriptor push
// (visibility toggle, opacity change, rename) writes the pre-filter
// x/y/w/h back over the engine's expanded descriptor, silently
// relocating cropped-content layers by their own (x, y).

const syncLayerAfterFullSize = vi.fn((_engine: unknown, _id: string) => null);
vi.mock('../sync-layer-after-full-size', () => ({
  syncLayerAfterFullSize: (engine: unknown, id: string) => syncLayerAfterFullSize(engine, id),
}));

const filterInvert = vi.fn();
const filterDesaturate = vi.fn();
const filterFindEdges = vi.fn();
const filterColorLut = vi.fn();
const filterPatternFill = vi.fn();
const filterTiltShiftBlur = vi.fn();
const saveFilterPreview = vi.fn();
const restoreFilterPreview = vi.fn();
const clearFilterPreview = vi.fn();
const readLayerPixels = vi.fn(() => new Uint8Array(0));
const getLayerTextureDimensions = vi.fn(() => new Uint32Array([64, 64]));
const liquifyInitDisplacement = vi.fn();
const liquifyRender = vi.fn();
const liquifyRelease = vi.fn();
const beginMaskFilterTarget = vi.fn(() => true);
const endMaskFilterTarget = vi.fn();

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  filterInvert,
  filterDesaturate,
  filterFindEdges,
  filterColorLut,
  filterPatternFill,
  filterTiltShiftBlur,
  saveFilterPreview,
  restoreFilterPreview,
  clearFilterPreview,
  readLayerPixels,
  getLayerTextureDimensions,
  liquifyInitDisplacement,
  liquifyRender,
  liquifyRelease,
  beginMaskFilterTarget,
  endMaskFilterTarget,
}));

const readLayerCompressed = vi.fn(() => null);
const uploadCompressed = vi.fn();
vi.mock('../../engine-wasm/gpu-pixel-access', () => ({
  readLayerCompressed,
  uploadCompressed,
}));

const flushLayerSync = vi.fn();
const uploadLayerMaskIfChanged = vi.fn();
vi.mock('../../engine-wasm/engine-sync', () => ({
  flushLayerSync,
  uploadLayerMaskIfChanged,
}));

const scheduleMaskDataRefresh = vi.fn();
const markMaskDataStale = vi.fn();
vi.mock('../mask-data-sync', () => ({
  scheduleMaskDataRefresh,
  markMaskDataStale,
}));

const engine: { __engine: string } = { __engine: 'mock' };
vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => engine,
}));

const clearJsPixelData = vi.fn();
vi.mock('../store/clear-js-pixel-data', () => ({
  clearJsPixelData: (...args: unknown[]) => clearJsPixelData(...args),
}));

const applyMeshWarpGpu = vi.fn();
vi.mock('../../filters/mesh-warp', () => ({
  applyMeshWarpGpu: (...args: unknown[]) => applyMeshWarpGpu(...args),
}));

// Real filter registry entries would import wasm-bridge & shader code; a
// minimal mocked filter with an applyGpu spy is all these tests need.
const filterApplyGpu = vi.fn();
vi.mock('../../filters/filter-registry', () => ({
  filterRegistry: {
    'gaussian-blur': { id: 'gaussian-blur', title: 'Gaussian Blur', params: [], applyGpu: (engine: unknown, id: string, values: Record<string, number>) => filterApplyGpu(engine, id, values) },
  },
}));

const editorState = {
  document: {
    width: 400,
    height: 300,
    activeLayerId: 'layer-1',
    layers: [{
      id: 'layer-1', type: 'raster', x: 125, y: 73, width: 110, height: 51,
      mask: null as { data: null; width: number; height: number } | null,
    }],
  },
  dirtyLayerIds: new Set<string>(),
  pushHistory: vi.fn(),
  notifyRender: vi.fn(),
};
vi.mock('../editor-store', () => ({
  useEditorStore: {
    getState: () => editorState,
    setState: vi.fn(),
  },
}));

const liquifySession = {
  layerId: 'layer-1',
  layerWidth: 400,
  layerHeight: 300,
  settings: {},
};
const tiltShiftSession = {
  focusPosition: 0.5,
  focusWidth: 0.4,
  blurRadius: 12,
  angle: 0,
  dragging: null,
  dragAnchor: 0,
  previewActive: true,
};
const uiState = {
  maskMode: 'off' as 'off' | 'layerMask' | 'quickMask',
  liquify: liquifySession as ReturnType<() => typeof liquifySession> | null,
  tiltShift: tiltShiftSession as typeof tiltShiftSession | null,
  setLiquify: vi.fn(),
  setTiltShift: vi.fn(),
};
vi.mock('../ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

const patternStore = {
  patterns: [{ id: 'pattern-1', name: 'Pattern 1', width: 8, height: 8, data: new Uint8Array(8 * 8 * 4), thumbnail: '' }],
  addPattern: vi.fn(),
};
vi.mock('../pattern-store', () => ({
  usePatternStore: { getState: () => patternStore },
  generateThumbnail: vi.fn(() => ''),
}));

vi.mock('../../tools/liquify/liquify', () => ({
  MAX_DISP: 100,
  DISP_CENTER: 32768,
  defaultLiquifySettings: () => ({ brushSize: 40, pressure: 0.5 }),
}));

// The first dynamic import of filter-actions pulls in a large module graph
// and can exceed the default 5 s test timeout under a loaded full-suite run.
// A timed-out test keeps running and leaks mock calls into the next one, so
// warm the module once here with a generous timeout.
beforeAll(async () => {
  await import('./filter-actions');
}, 60_000);

beforeEach(() => {
  syncLayerAfterFullSize.mockClear();
  filterInvert.mockClear();
  filterDesaturate.mockClear();
  filterFindEdges.mockClear();
  filterColorLut.mockClear();
  filterPatternFill.mockClear();
  filterTiltShiftBlur.mockClear();
  filterApplyGpu.mockClear();
  saveFilterPreview.mockClear();
  restoreFilterPreview.mockClear();
  clearFilterPreview.mockClear();
  readLayerCompressed.mockReturnValue(null);
  clearJsPixelData.mockClear();
  applyMeshWarpGpu.mockClear();
  liquifyRender.mockClear();
  editorState.pushHistory.mockClear();
  editorState.notifyRender.mockClear();
  uiState.liquify = liquifySession;
  uiState.tiltShift = tiltShiftSession;
  uiState.maskMode = 'off';
  editorState.document.layers[0]!.mask = null;
  beginMaskFilterTarget.mockClear();
  endMaskFilterTarget.mockClear();
  uploadLayerMaskIfChanged.mockClear();
  scheduleMaskDataRefresh.mockClear();
  markMaskDataStale.mockClear();
});

describe('#771 — filter-actions.ts reconciles JS bounds after each engine write', () => {
  it('applyGenericFilter calls syncLayerAfterFullSize after applyGpu', async () => {
    const { applyGenericFilter } = await import('./filter-actions');
    applyGenericFilter('gaussian-blur', { radius: 5 });
    expect(filterApplyGpu).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize.mock.calls[0]![1]).toBe('layer-1');
  });

  it('beginFilterPreview reconciles bounds after saveFilterPreview', async () => {
    const { beginFilterPreview } = await import('./filter-actions');
    beginFilterPreview();
    expect(saveFilterPreview).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });

  it('applyGenericFilterWithPreview reconciles bounds after the commit path', async () => {
    const { applyGenericFilterWithPreview } = await import('./filter-actions');
    applyGenericFilterWithPreview('gaussian-blur', { radius: 5 });
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });

  it('applyInvert reconciles bounds after filterInvert', async () => {
    const { applyInvert } = await import('./filter-actions');
    applyInvert();
    expect(filterInvert).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });

  it('applyDesaturate reconciles bounds after filterDesaturate', async () => {
    const { applyDesaturate } = await import('./filter-actions');
    applyDesaturate();
    expect(filterDesaturate).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });

  it('applyFindEdges reconciles bounds after filterFindEdges', async () => {
    const { applyFindEdges } = await import('./filter-actions');
    applyFindEdges();
    expect(filterFindEdges).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });
});

describe('#771 — pattern-actions.ts reconciles JS bounds after each engine write', () => {
  const NO_OFFSETS = { scale: 100, rowStagger: 0, columnStagger: 0, offsetX: 0, offsetY: 0 };

  it('applyPatternFill reconciles bounds after filterPatternFill', async () => {
    const { applyPatternFill } = await import('./pattern-actions');
    applyPatternFill('pattern-1', NO_OFFSETS);
    expect(filterPatternFill).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });

  it('beginPatternPreview reconciles bounds after saveFilterPreview', async () => {
    const { beginPatternPreview } = await import('./pattern-actions');
    beginPatternPreview();
    expect(saveFilterPreview).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });

  it('applyPatternFillWithPreview reconciles bounds after commit', async () => {
    const { applyPatternFillWithPreview } = await import('./pattern-actions');
    applyPatternFillWithPreview('pattern-1', NO_OFFSETS);
    expect(filterPatternFill).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });
});

describe('#771 — color-lut-actions.ts reconciles JS bounds after each engine write', () => {
  it('beginColorLutPreview reconciles bounds after saveFilterPreview', async () => {
    const { beginColorLutPreview } = await import('./color-lut-actions');
    beginColorLutPreview();
    expect(saveFilterPreview).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });

  it('applyColorLut reconciles bounds on the reapply-from-blob commit path', async () => {
    const { applyColorLut } = await import('./color-lut-actions');
    applyColorLut({ id: 'lut-1', name: 'Test LUT', data: new Uint8Array(16), size: 2 }, 1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });

  it('applyColorLutDirect reconciles bounds after filterColorLut', async () => {
    const { applyColorLutDirect } = await import('./color-lut-actions');
    applyColorLutDirect({ id: 'lut-1', name: 'Test LUT', data: new Uint8Array(16), size: 2 }, 1);
    expect(filterColorLut).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });
});

describe('#771 — mesh-warp-actions.ts reconciles JS bounds after each engine write', () => {
  it('applyMeshWarp reconciles bounds after applyMeshWarpGpu', async () => {
    const { applyMeshWarp } = await import('./mesh-warp-actions');
    applyMeshWarp({ cols: 2, rows: 2, points: [] } as never, { x: 0, y: 0, width: 400, height: 300 });
    expect(applyMeshWarpGpu).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });

  it('beginMeshWarpPreview reconciles bounds after saveFilterPreview', async () => {
    const { beginMeshWarpPreview } = await import('./mesh-warp-actions');
    beginMeshWarpPreview();
    expect(saveFilterPreview).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });

  it('applyMeshWarpWithPreview reconciles bounds after commit', async () => {
    const { applyMeshWarpWithPreview } = await import('./mesh-warp-actions');
    applyMeshWarpWithPreview({ cols: 2, rows: 2, points: [] } as never, { x: 0, y: 0, width: 400, height: 300 });
    expect(applyMeshWarpGpu).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });
});

describe('#771 — tilt-shift-actions.ts reconciles JS bounds after each engine write', () => {
  it('beginTiltShiftSession reconciles bounds after saveFilterPreview', async () => {
    const { beginTiltShiftSession } = await import('./tilt-shift-actions');
    beginTiltShiftSession();
    expect(saveFilterPreview).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });

  it('applyTiltShift reconciles bounds after filterTiltShiftBlur', async () => {
    const { applyTiltShift } = await import('./tilt-shift-actions');
    applyTiltShift();
    expect(filterTiltShiftBlur).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });
});

describe('#771 — liquify-actions.ts reconciles JS bounds after each engine write', () => {
  it('openLiquify reconciles bounds after saveFilterPreview', async () => {
    uiState.liquify = null;
    const { openLiquify } = await import('./liquify-actions');
    openLiquify();
    expect(saveFilterPreview).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });

  it('applyLiquify reconciles bounds after liquifyRender', async () => {
    const { applyLiquify } = await import('./liquify-actions');
    applyLiquify();
    expect(liquifyRender).toHaveBeenCalledTimes(1);
    // #816 — applyLiquify now also reconciles after the pre-history
    // restoreFilterPreview, so we get two calls: one after the restore
    // and one after the final liquify render.
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(2);
  });

  // #816 — applyLiquify must restore the pre-warp preview BEFORE
  // pushHistory, otherwise the snapshot captures the live-warped
  // texture and undo becomes a no-op.
  it('applyLiquify restores the preview before pushHistory (#816)', async () => {
    const { applyLiquify } = await import('./liquify-actions');
    const callOrder: string[] = [];
    restoreFilterPreview.mockImplementation(() => { callOrder.push('restore'); });
    editorState.pushHistory.mockImplementation(() => { callOrder.push('pushHistory'); });
    liquifyRender.mockImplementation(() => { callOrder.push('liquifyRender'); });
    applyLiquify();
    expect(callOrder[0]).toBe('restore');
    expect(callOrder[1]).toBe('pushHistory');
    expect(callOrder[2]).toBe('liquifyRender');
  });
});

describe('#1150 — in mask edit mode Filter commands write the layer mask', () => {
  function enterMaskEditMode(): void {
    editorState.document.layers[0]!.mask = { data: null, width: 2, height: 2 };
    uiState.maskMode = 'layerMask';
  }

  it('Invert runs between begin/endMaskFilterTarget and refreshes the mask bytes', async () => {
    enterMaskEditMode();
    const { applyInvert } = await import('./filter-actions');
    applyInvert();
    expect(editorState.pushHistory).toHaveBeenCalledWith('Invert');
    expect(uploadLayerMaskIfChanged).toHaveBeenCalledTimes(1);
    expect(beginMaskFilterTarget).toHaveBeenCalledWith(engine, 'layer-1');
    expect(filterInvert).toHaveBeenCalledWith(engine, 'layer-1');
    expect(endMaskFilterTarget).toHaveBeenCalledWith(engine, 'layer-1');
    const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0]!;
    expect(order(beginMaskFilterTarget)).toBeLessThan(order(filterInvert));
    expect(order(filterInvert)).toBeLessThan(order(endMaskFilterTarget));
    expect(scheduleMaskDataRefresh).toHaveBeenCalledWith('layer-1');
    expect(clearJsPixelData).not.toHaveBeenCalled();
    expect(syncLayerAfterFullSize).not.toHaveBeenCalled();
  });

  it('a dialog filter preview marks the mask stale and the commit refreshes it', async () => {
    enterMaskEditMode();
    const { beginFilterPreview, previewGenericFilter, applyGenericFilterWithPreview } = await import('./filter-actions');
    beginFilterPreview();
    previewGenericFilter('gaussian-blur', { radius: 5 });
    expect(markMaskDataStale).toHaveBeenCalledWith('layer-1');
    expect(scheduleMaskDataRefresh).not.toHaveBeenCalled();
    applyGenericFilterWithPreview('gaussian-blur', { radius: 5 });
    expect(scheduleMaskDataRefresh).toHaveBeenCalledWith('layer-1');
    // Every engine call ran on the mask: begin/end are balanced.
    expect(beginMaskFilterTarget.mock.calls.length).toBe(endMaskFilterTarget.mock.calls.length);
    expect(beginMaskFilterTarget.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(clearJsPixelData).not.toHaveBeenCalled();
  });

  it('without a mask on the active layer, filters write the layer as before', async () => {
    uiState.maskMode = 'layerMask';
    const { applyInvert } = await import('./filter-actions');
    applyInvert();
    expect(beginMaskFilterTarget).not.toHaveBeenCalled();
    expect(filterInvert).toHaveBeenCalledWith(engine, 'layer-1');
    expect(clearJsPixelData).toHaveBeenCalledWith('layer-1');
  });

  it('Liquify and Tilt-Shift do not start on a mask', async () => {
    enterMaskEditMode();
    const { openLiquify } = await import('./liquify-actions');
    const { beginTiltShiftSession } = await import('./tilt-shift-actions');
    openLiquify();
    beginTiltShiftSession();
    expect(saveFilterPreview).not.toHaveBeenCalled();
    expect(filterTiltShiftBlur).not.toHaveBeenCalled();
  });
});
