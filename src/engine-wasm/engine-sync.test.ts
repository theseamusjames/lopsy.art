import { describe, it, expect, vi } from 'vitest';
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
}));

vi.mock('./engine-state', () => ({
  getEngine: vi.fn(() => null),
}));

const bridge = await import('./wasm-bridge');
const sync = await import('./engine-sync');

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
