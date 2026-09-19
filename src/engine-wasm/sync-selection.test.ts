import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Engine } from './wasm-bridge';
import { EMPTY_SELECTION, type SelectionData } from '../app/store/types';

vi.mock('./wasm-bridge', () => ({
  setSelectionMask: vi.fn(),
  clearSelection: vi.fn(),
  // The rest of the exports touched by engine-sync's import graph:
  setDocumentSize: vi.fn(),
  setBackgroundColor: vi.fn(),
  setDocumentColorMode: vi.fn(),
  setViewport: vi.fn(),
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
  setGridVisible: vi.fn(),
  setGridSize: vi.fn(),
  setRulersVisible: vi.fn(),
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
  removeGroupAdjustment: vi.fn(),
  setGroupInvert: vi.fn(),
  setGroupHueSaturation: vi.fn(),
  setGroupColorBalance: vi.fn(),
  setGroupPhotoFilter: vi.fn(),
  setGroupBlackWhite: vi.fn(),
  setGroupChannelMixer: vi.fn(),
  setGroupGradientMapLut: vi.fn(),
  setSeamlessPattern: vi.fn(),
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
  uploadBrushTipRGBA: vi.fn(),
  clearBrushTip: vi.fn(),
  setBrushTipState: vi.fn(),
  cacheSubBrushTip: vi.fn(),
  cacheSubBrushTipRGBA: vi.fn(),
  activateSubBrushTip: vi.fn(),
  deactivateSubBrushTip: vi.fn(),
  clearSubBrushTipCache: vi.fn(),
  uploadBrushTexture: vi.fn(),
  clearBrushTexture: vi.fn(),
  setBrushTextureState: vi.fn(),
  setTextLayerContent: vi.fn(),
  renderTextLayer: vi.fn(() => new Int32Array([100, 50, 0, 0])),
  renderTextLayerToTexture: vi.fn(() => new Float64Array([100, 50, 0, 0])),
  removeTextLayerState: vi.fn(),
}));

vi.mock('./engine-state', () => ({
  getEngine: vi.fn(() => null),
}));

const bridge = await import('./wasm-bridge');
const { syncSelection } = await import('./engine-sync');
const { seedSelectionMaskRef, resetTrackedState } = await import('./sync-state');

const makeFakeEngine = () => ({}) as unknown as Engine;

function makeSelection(mask: Uint8ClampedArray, w: number, h: number): SelectionData {
  return {
    active: true,
    bounds: { x: 0, y: 0, width: w, height: h },
    mask,
    maskWidth: w,
    maskHeight: h,
  };
}

/**
 * Issue #763 — feathered selection commits echo the feathered mask.
 *
 * The feather flow uploads a raw mask directly to the GPU (bypassing
 * tracked state), runs the GPU blur, reads the feathered bytes back to
 * the store, then setSelection triggers a sync. Because tracked state
 * was not updated by the direct upload, the sync sees the new array
 * reference and echoes it right back to the GPU — 16 MB / 87 ms of
 * pure re-upload per commit at 4K. seedSelectionMaskRef records the
 * readback array as the tracked reference to close the loop.
 */
describe('syncSelection — feather echo suppression (#763)', () => {
  beforeEach(() => {
    vi.mocked(bridge.setSelectionMask).mockClear();
    vi.mocked(bridge.clearSelection).mockClear();
  });

  it('uploads once for a new active selection', () => {
    const engine = makeFakeEngine();
    const mask = new Uint8ClampedArray(64 * 64).fill(255);
    const sel = makeSelection(mask, 64, 64);

    syncSelection(engine, sel);
    expect(vi.mocked(bridge.setSelectionMask)).toHaveBeenCalledTimes(1);
  });

  it('skips the upload when seedSelectionMaskRef pre-registered the mask array', () => {
    const engine = makeFakeEngine();
    resetTrackedState(engine);
    const feathered = new Uint8ClampedArray(64 * 64).fill(180);
    const sel = makeSelection(feathered, 64, 64);

    // Simulate commitFeatheredSelection: bytes were pushed to the GPU by
    // the direct setSelectionMask + featherSelectionMask + readback path,
    // then setSelection stored `feathered` on the store. Seeding the ref
    // with that same array should suppress the next syncSelection upload.
    seedSelectionMaskRef(engine, feathered);

    syncSelection(engine, sel);
    expect(vi.mocked(bridge.setSelectionMask)).not.toHaveBeenCalled();
  });

  it('still uploads when a subsequent selection uses a different array reference', () => {
    const engine = makeFakeEngine();
    resetTrackedState(engine);
    const feathered = new Uint8ClampedArray(64 * 64).fill(180);

    seedSelectionMaskRef(engine, feathered);
    syncSelection(engine, makeSelection(feathered, 64, 64));
    expect(vi.mocked(bridge.setSelectionMask)).not.toHaveBeenCalled();

    // A brand-new selection (different array) should upload normally.
    const fresh = new Uint8ClampedArray(64 * 64).fill(100);
    syncSelection(engine, makeSelection(fresh, 64, 64));
    expect(vi.mocked(bridge.setSelectionMask)).toHaveBeenCalledTimes(1);
  });

  it('clears the selection when the store transitions from active to empty', () => {
    const engine = makeFakeEngine();
    resetTrackedState(engine);
    const feathered = new Uint8ClampedArray(64 * 64).fill(180);
    seedSelectionMaskRef(engine, feathered);
    syncSelection(engine, makeSelection(feathered, 64, 64));

    syncSelection(engine, EMPTY_SELECTION);
    expect(vi.mocked(bridge.clearSelection)).toHaveBeenCalledTimes(1);
  });
});
