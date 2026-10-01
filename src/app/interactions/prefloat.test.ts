import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const bridge = vi.hoisted(() => {
  const state = { isFloating: false };
  return {
    state,
    floatSelection: vi.fn(() => { state.isFloating = true; }),
    compositeFloat: vi.fn(),
    setSelectionMask: vi.fn(),
    hasFloat: vi.fn(() => state.isFloating),
    dropFloat: vi.fn(() => { state.isFloating = false; }),
    snapshotLayerGpu: vi.fn(() => 1),
    releaseGpuSnapshot: vi.fn(),
  };
});

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  floatSelection: bridge.floatSelection,
  compositeFloat: bridge.compositeFloat,
  setSelectionMask: bridge.setSelectionMask,
  hasFloat: bridge.hasFloat,
  dropFloat: bridge.dropFloat,
  snapshotLayerGpu: bridge.snapshotLayerGpu,
  releaseGpuSnapshot: bridge.releaseGpuSnapshot,
}));

vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => ({ __engine: 'mock' }),
}));

vi.mock('../store/clear-js-pixel-data', () => ({ clearJsPixelData: vi.fn() }));
vi.mock('../reconcile-layer-bounds', () => ({ reconcileLayerBoundsWithEngine: vi.fn() }));
vi.mock('../store/mask-history', () => ({
  snapshotAllMasksFresh: () => new Map(),
  EMPTY_MASK_HANDLE: 0xffffffff,
}));

const editorState = vi.hoisted(() => ({
  document: { layerOrder: ['layer-1'], layers: [] as unknown[] },
  selection: {
    active: true,
    mask: null as Uint8ClampedArray | null,
    maskWidth: 4,
    maskHeight: 4,
  },
  paths: [],
  selectedPathId: null,
  notifyRender: vi.fn(),
}));

vi.mock('../editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

import {
  schedulePrefloat,
  isUnmovedPrefloat,
  commitPrefloatIfSelectionChanged,
  cancelPrefloat,
} from './prefloat';

const BOUNDS = { x: 0, y: 0, width: 2, height: 2 };

function loadPrefloat(): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(16).fill(255);
  editorState.selection.mask = mask;
  schedulePrefloat('layer-1', mask, BOUNDS);
  vi.runAllTimers();
  return mask;
}

describe('prefloat lifecycle when the selection changes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    bridge.state.isFloating = false;
    vi.clearAllMocks();
  });

  afterEach(() => {
    cancelPrefloat();
    vi.useRealTimers();
  });

  it('keeps the float live while the selection is still the loaded mask', () => {
    const mask = loadPrefloat();
    expect(bridge.floatSelection).toHaveBeenCalledTimes(1);

    commitPrefloatIfSelectionChanged(mask);

    expect(bridge.dropFloat).not.toHaveBeenCalled();
    expect(isUnmovedPrefloat(mask)).toBe(true);
  });

  it('puts the pixels back once a modified selection replaces the mask (#1076)', () => {
    const mask = loadPrefloat();
    const shrunk = new Uint8ClampedArray(16);
    shrunk[5] = 255;

    commitPrefloatIfSelectionChanged(shrunk);

    expect(bridge.dropFloat).toHaveBeenCalledTimes(1);
    expect(bridge.hasFloat()).toBe(false);
    expect(isUnmovedPrefloat(mask)).toBe(false);
    expect(isUnmovedPrefloat(shrunk)).toBe(false);
    // The prefloat's undo snapshot is released, not leaked.
    expect(bridge.releaseGpuSnapshot).toHaveBeenCalledWith(expect.anything(), 1);
  });

  it('does nothing when no prefloat is registered', () => {
    commitPrefloatIfSelectionChanged(new Uint8ClampedArray(16));
    expect(bridge.dropFloat).not.toHaveBeenCalled();
  });

  it('never drops a float someone else owns after the prefloat was cancelled', () => {
    loadPrefloat();
    cancelPrefloat();

    commitPrefloatIfSelectionChanged(new Uint8ClampedArray(16));

    expect(bridge.hasFloat()).toBe(true);
    expect(bridge.dropFloat).not.toHaveBeenCalled();
  });

  it('skips a scheduled prefloat whose mask was replaced before it ran', () => {
    const mask = new Uint8ClampedArray(16).fill(255);
    editorState.selection.mask = mask;
    schedulePrefloat('layer-1', mask, BOUNDS);
    editorState.selection.mask = new Uint8ClampedArray(16);
    vi.runAllTimers();

    expect(bridge.floatSelection).not.toHaveBeenCalled();
    expect(isUnmovedPrefloat(mask)).toBe(false);
  });
});
