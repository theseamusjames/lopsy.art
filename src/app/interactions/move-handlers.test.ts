/**
 * Tests for the deferred quick-mask + marquee move (issue #642).
 *
 * During the drag we intentionally skip the full-document mask translate
 * and the CPU→GPU quick-mask upload: only bounds + transform change so the
 * marching ants slide visually. Both the mask rebuild and the GPU upload
 * happen exactly once, on pointer-up.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  uploadQuickMaskPixels: vi.fn(),
  setSelectionMask: vi.fn(),
  readQuickMaskPixels: vi.fn(() => new Uint8Array(0)),
  floatSelection: vi.fn(() => new Int32Array(0)),
  compositeFloat: vi.fn(),
  hasFloat: vi.fn(() => false),
  restoreFloatBase: vi.fn(),
}));
const { uploadQuickMaskPixels } = mocks;

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  floatSelection: mocks.floatSelection,
  restoreFloatBase: mocks.restoreFloatBase,
  compositeFloat: mocks.compositeFloat,
  hasFloat: mocks.hasFloat,
  setSelectionMask: mocks.setSelectionMask,
  readQuickMaskPixels: mocks.readQuickMaskPixels,
  uploadQuickMaskPixels: mocks.uploadQuickMaskPixels,
}));

vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => ({ __engine: 'mock' }),
}));

const editorState = {
  document: { width: 8, height: 8, layers: [] as unknown[] },
  selection: {
    active: true,
    mask: null as Uint8ClampedArray | null,
    bounds: null as { x: number; y: number; width: number; height: number } | null,
    maskWidth: 8,
    maskHeight: 8,
  },
  setSelection: vi.fn(),
  setSelectionBounds: vi.fn(),
  notifyRender: vi.fn(),
};
vi.mock('../editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

const uiState = {
  maskMode: 'quickMask' as 'quickMask' | 'layerMask' | null,
  setTransform: vi.fn(),
  clearSnapLines: vi.fn(),
  setSnapLines: vi.fn(),
  showGrid: false,
  snapToGrid: false,
  snapToLayers: false,
  gridSize: 10,
};
vi.mock('../ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

vi.mock('../store/clear-js-pixel-data', () => ({
  clearJsPixelData: vi.fn(),
}));

vi.mock('./prefloat', () => ({
  consumePrefloat: () => null,
  cancelPrefloat: vi.fn(),
}));

vi.mock('../../panels/LayerPanel/layer-selection', () => ({
  selectLayerAlpha: vi.fn(),
}));

import { handleMoveMove, handleMoveUp } from './move-handlers';
import type { InteractionState, FloatingSelection, PersistentTransform } from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';

const DOC_W = 8;
const DOC_H = 8;

function makeState(overrides: Partial<InteractionState> = {}): InteractionState {
  return {
    drawing: true,
    lastPoint: null,
    layerId: 'layer-1',
    tool: 'move',
    startPoint: { x: 0, y: 0 },
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    ...overrides,
  };
}

function makeMask(fills: Array<[number, number]>): Uint8ClampedArray {
  const m = new Uint8ClampedArray(DOC_W * DOC_H);
  for (const [x, y] of fills) m[y * DOC_W + x] = 255;
  return m;
}

const floatingRef: { current: FloatingSelection | null } = { current: null };
const persistentRef: { current: PersistentTransform | null } = { current: null };

beforeEach(() => {
  uploadQuickMaskPixels.mockClear();
  editorState.setSelection.mockClear();
  editorState.setSelectionBounds.mockClear();
  editorState.notifyRender.mockClear();
  uiState.setTransform.mockClear();
  uiState.clearSnapLines.mockClear();
  uiState.maskMode = 'quickMask';
  editorState.document = { width: DOC_W, height: DOC_H, layers: [] };
  editorState.selection = {
    active: true,
    mask: makeMask([[2, 2]]),
    bounds: { x: 2, y: 2, width: 1, height: 1 },
    maskWidth: DOC_W,
    maskHeight: DOC_H,
  };
  floatingRef.current = null;
  persistentRef.current = null;
});

describe('handleMoveMove — quick-mask + marquee (issue #642)', () => {
  it('does not upload the quick-mask pixels during the drag', () => {
    const origMask = makeMask([[2, 2]]);
    const state = makeState({
      startPoint: { x: 0, y: 0 },
      moveOriginalMask: origMask,
      moveOriginalBounds: { x: 2, y: 2, width: 1, height: 1 },
      quickMaskOriginalPixels: new Uint8Array(DOC_W * DOC_H),
      quickMaskOriginalWidth: DOC_W,
      quickMaskOriginalHeight: DOC_H,
    });
    handleMoveMove(state, { x: 3, y: 2 }, floatingRef);
    expect(uploadQuickMaskPixels).not.toHaveBeenCalled();
  });

  it('does not rebuild the selection mask during the drag', () => {
    const state = makeState({
      startPoint: { x: 0, y: 0 },
      moveOriginalMask: makeMask([[2, 2]]),
      moveOriginalBounds: { x: 2, y: 2, width: 1, height: 1 },
    });
    handleMoveMove(state, { x: 3, y: 2 }, floatingRef);
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });

  it('slides the selection bounds + transform offset by the drag delta', () => {
    const state = makeState({
      startPoint: { x: 0, y: 0 },
      moveOriginalMask: makeMask([[2, 2]]),
      moveOriginalBounds: { x: 2, y: 2, width: 1, height: 1 },
    });
    handleMoveMove(state, { x: 3, y: 2 }, floatingRef);
    expect(editorState.setSelectionBounds).toHaveBeenCalledWith({
      x: 5, y: 4, width: 1, height: 1,
    });
    const calls = uiState.setTransform.mock.calls;
    const t = calls[calls.length - 1]![0]!;
    expect(t.translateX).toBe(3);
    expect(t.translateY).toBe(2);
  });
});

describe('handleMoveUp — quick-mask + marquee commit (issue #642)', () => {
  it('materialises the translated mask exactly once on release', () => {
    const state = makeState({
      startPoint: { x: 0, y: 0 },
      moveOriginalMask: makeMask([[2, 2]]),
      moveOriginalBounds: { x: 2, y: 2, width: 1, height: 1 },
    });
    handleMoveUp(state, { x: 3, y: 2 }, floatingRef, persistentRef);
    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    const [bounds, mask] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
    ];
    expect(bounds).toEqual({ x: 5, y: 4, width: 1, height: 1 });
    expect(mask[4 * DOC_W + 5]).toBe(255);
    expect(mask[2 * DOC_W + 2]).toBe(0);
  });

  it('uploads the translated quick-mask pixels exactly once on release', () => {
    const origPixels = new Uint8Array(DOC_W * DOC_H);
    origPixels[2 * DOC_W + 2] = 200;
    const origMask = makeMask([[2, 2]]);
    const state = makeState({
      startPoint: { x: 0, y: 0 },
      moveOriginalMask: origMask,
      moveOriginalBounds: { x: 2, y: 2, width: 1, height: 1 },
      quickMaskOriginalPixels: origPixels,
      quickMaskOriginalWidth: DOC_W,
      quickMaskOriginalHeight: DOC_H,
    });
    handleMoveUp(state, { x: 3, y: 2 }, floatingRef, persistentRef);
    expect(uploadQuickMaskPixels).toHaveBeenCalledTimes(1);
    const [, pixels, w, h] = uploadQuickMaskPixels.mock.calls[0]!;
    expect(w).toBe(DOC_W);
    expect(h).toBe(DOC_H);
    expect(pixels[4 * DOC_W + 5]).toBe(200);
  });

  it('skips both commit paths when the drag ends with zero delta', () => {
    const state = makeState({
      startPoint: { x: 10, y: 10 },
      moveOriginalMask: makeMask([[2, 2]]),
      moveOriginalBounds: { x: 2, y: 2, width: 1, height: 1 },
      quickMaskOriginalPixels: new Uint8Array(DOC_W * DOC_H),
      quickMaskOriginalWidth: DOC_W,
      quickMaskOriginalHeight: DOC_H,
    });
    handleMoveUp(state, { x: 10, y: 10 }, floatingRef, persistentRef);
    expect(editorState.setSelection).not.toHaveBeenCalled();
    expect(uploadQuickMaskPixels).not.toHaveBeenCalled();
  });
});
