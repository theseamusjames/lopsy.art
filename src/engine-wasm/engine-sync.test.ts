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

describe('syncSelection (issue #224 — sequential cuts)', () => {
  it('uploads each new mask reference to the engine', () => {
    // Sequential cut() calls (issue #224) rely on syncSelection re-uploading
    // the GPU selection mask whenever the JS-side mask reference changes.
    // If this short-circuit ever skips the upload, clipboard_clear_selected
    // operates on a stale mask and the cut clears unrelated regions.
    const engine = makeFakeEngine();
    const setMask = vi.mocked(bridge.setSelectionMask);
    setMask.mockClear();

    const mask1 = new Uint8ClampedArray(800 * 600);
    for (let y = 325; y < 330; y++) {
      for (let x = 260; x < 540; x++) mask1[y * 800 + x] = 255;
    }
    sync.syncSelection(engine, {
      active: true,
      bounds: { x: 260, y: 325, width: 280, height: 5 },
      mask: mask1,
      maskWidth: 800,
      maskHeight: 600,
    });
    expect(setMask).toHaveBeenCalledTimes(1);

    // Same reference — no second upload.
    sync.syncSelection(engine, {
      active: true,
      bounds: { x: 260, y: 325, width: 280, height: 5 },
      mask: mask1,
      maskWidth: 800,
      maskHeight: 600,
    });
    expect(setMask).toHaveBeenCalledTimes(1);

    // New mask reference — must upload again.
    const mask2 = new Uint8ClampedArray(800 * 600);
    for (let y = 370; y < 380; y++) {
      for (let x = 260; x < 540; x++) mask2[y * 800 + x] = 255;
    }
    sync.syncSelection(engine, {
      active: true,
      bounds: { x: 260, y: 370, width: 280, height: 10 },
      mask: mask2,
      maskWidth: 800,
      maskHeight: 600,
    });
    expect(setMask).toHaveBeenCalledTimes(2);
    // The bytes uploaded for the second call must come from mask2, not mask1
    // — verify by checking a pixel that's set in mask2 but not mask1.
    const lastCall = setMask.mock.calls[setMask.mock.calls.length - 1]!;
    const bytes = lastCall[1] as Uint8Array;
    expect(bytes[375 * 800 + 400]).toBe(255); // inside stripe #2
    expect(bytes[327 * 800 + 400]).toBe(0);   // inside stripe #1, not stripe #2
  });

  it('clears the selection on the engine when JS goes inactive', () => {
    const engine = makeFakeEngine();
    const setMask = vi.mocked(bridge.setSelectionMask);
    const clearSel = vi.mocked(bridge.clearSelection);
    setMask.mockClear();
    clearSel.mockClear();

    const mask = new Uint8ClampedArray(10 * 10);
    mask[0] = 255;
    sync.syncSelection(engine, {
      active: true,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      mask,
      maskWidth: 10,
      maskHeight: 10,
    });
    expect(setMask).toHaveBeenCalledTimes(1);
    expect(clearSel).toHaveBeenCalledTimes(0);

    // Deactivate — clearSelection must fire so the engine drops its mask
    // texture; otherwise a subsequent cut() with hasSelection=false would
    // run against a stale mask.
    sync.syncSelection(engine, {
      active: false,
      bounds: null,
      mask: null,
      maskWidth: 0,
      maskHeight: 0,
    });
    expect(clearSel).toHaveBeenCalledTimes(1);

    // Idle deactivate — must NOT re-fire clearSelection.
    sync.syncSelection(engine, {
      active: false,
      bounds: null,
      mask: null,
      maskWidth: 0,
      maskHeight: 0,
    });
    expect(clearSel).toHaveBeenCalledTimes(1);
  });
});
