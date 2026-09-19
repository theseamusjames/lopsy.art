import { describe, it, expect, vi, beforeEach } from 'vitest';

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
}));

const readLayerCompressed = vi.fn(() => null);
const uploadCompressed = vi.fn();
vi.mock('../../engine-wasm/gpu-pixel-access', () => ({
  readLayerCompressed,
  uploadCompressed,
}));

const flushLayerSync = vi.fn();
vi.mock('../../engine-wasm/engine-sync', () => ({
  flushLayerSync,
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
    layers: [{ id: 'layer-1', type: 'raster', x: 125, y: 73, width: 110, height: 51 }],
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
  defaultLiquifySettings: () => ({ brushSize: 40, pressure: 0.5 }),
}));

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
  it('applyPatternFill reconciles bounds after filterPatternFill', async () => {
    const { applyPatternFill } = await import('./pattern-actions');
    applyPatternFill('pattern-1', 100, 0, 0);
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
    applyPatternFillWithPreview('pattern-1', 100, 0, 0);
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
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });
});
