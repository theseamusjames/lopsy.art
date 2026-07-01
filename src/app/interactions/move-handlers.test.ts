import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { MutableRefObject } from 'react';
import type { Rect } from '../../types';

// Mock all WASM/engine bridges. Typed as Mock<AnyFn> so the mocks both
// accept whatever the production code sends and keep the .mock and
// .mockClear helpers.
type AnyFn = (...args: unknown[]) => unknown;
const uploadQuickMaskPixelsMock = vi.fn() as Mock<AnyFn>;
const setSelectionMaskMock = vi.fn() as Mock<AnyFn>;
const readQuickMaskPixelsMock = vi.fn() as Mock<AnyFn>;
const floatSelectionMock = vi.fn() as Mock<AnyFn>;
const restoreFloatBaseMock = vi.fn() as Mock<AnyFn>;
const compositeFloatMock = vi.fn() as Mock<AnyFn>;
const hasFloatMock = vi.fn(() => false);

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  uploadQuickMaskPixels: (...a: unknown[]) => uploadQuickMaskPixelsMock(...a),
  setSelectionMask: (...a: unknown[]) => setSelectionMaskMock(...a),
  readQuickMaskPixels: (...a: unknown[]) => readQuickMaskPixelsMock(...a),
  floatSelection: (...a: unknown[]) => floatSelectionMock(...a),
  restoreFloatBase: (...a: unknown[]) => restoreFloatBaseMock(...a),
  compositeFloat: (...a: unknown[]) => compositeFloatMock(...a),
  hasFloat: () => hasFloatMock(),
}));

vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => ({ __engine: 'mock' }),
}));

// UI store mock — maskMode is toggled per test via a mutable ref.
const uiState = {
  maskMode: 'quickMask' as 'quickMask' | 'edit' | null,
  showGrid: false,
  snapToGrid: false,
  snapToLayers: false,
  gridSize: 8,
  clearSnapLines: vi.fn(),
  setSnapLines: vi.fn(),
  setTransform: vi.fn(),
  setActiveTransformHandle: vi.fn(),
};
vi.mock('../ui-store', () => ({
  useUIStore: {
    getState: () => uiState,
  },
}));

// Editor store mock.
const setSelectionMock = vi.fn() as Mock<AnyFn>;
const notifyRenderMock = vi.fn();
const editorState = {
  document: {
    width: 4096,
    height: 4096,
    layers: [{ id: 'layer-1', x: 0, y: 0, type: 'raster', width: 4096, height: 4096, visible: true }],
    activeLayerId: 'layer-1',
  },
  selection: {
    active: true,
    mask: null as Uint8ClampedArray | null,
    bounds: null as Rect | null,
    maskWidth: 4096,
    maskHeight: 4096,
  },
  setSelection: (...a: unknown[]) => setSelectionMock(...a),
  notifyRender: () => notifyRenderMock(),
  updateLayerPosition: vi.fn(),
  pushHistory: vi.fn(),
  pushPrebuiltSnapshot: vi.fn(),
  expandLayerForEditing: vi.fn(),
  cropLayerToContent: vi.fn(),
  duplicateLayer: vi.fn(),
  setSelectionBounds: vi.fn(),
};
vi.mock('../editor-store', () => ({
  useEditorStore: {
    getState: () => editorState,
    setState: vi.fn(),
  },
}));

vi.mock('../store/clear-js-pixel-data', () => ({
  clearJsPixelData: vi.fn(),
}));

vi.mock('../../panels/LayerPanel/layer-selection', () => ({
  selectLayerAlpha: vi.fn(),
}));

vi.mock('./prefloat', () => ({
  consumePrefloat: () => null,
  cancelPrefloat: vi.fn(),
}));

const setMarqueePreviewMock = vi.fn() as Mock<AnyFn>;
const getMarqueePreviewMock = vi.fn(() => null);
vi.mock('../../tools/marquee/marquee-preview', () => ({
  setMarqueePreview: (...a: unknown[]) => setMarqueePreviewMock(...a),
  getMarqueePreview: () => getMarqueePreviewMock(),
}));

vi.mock('../../tools/move/move', () => ({
  snapPositionToGrid: (x: number, y: number) => ({ x, y }),
  snapPositionToLayers: (x: number, y: number) => ({ x, y, snapLinesX: [], snapLinesY: [] }),
}));

vi.mock('../../tools/transform/transform', () => ({
  createTransformState: (bounds: Rect) => ({ originalBounds: bounds, translateX: 0, translateY: 0 }),
}));

import { handleMoveMove, handleMoveUp } from './move-handlers';
import type { InteractionState, FloatingSelection, PersistentTransform } from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';

function makeState(overrides: Partial<InteractionState> = {}): InteractionState {
  const docW = editorState.document.width;
  const docH = editorState.document.height;
  const mask = new Uint8ClampedArray(docW * docH);
  // Small square selection in the center.
  const startX = 100;
  const startY = 100;
  const w = 50;
  const h = 50;
  for (let y = startY; y < startY + h; y++) {
    for (let x = startX; x < startX + w; x++) {
      mask[y * docW + x] = 255;
    }
  }
  return {
    drawing: true,
    lastPoint: { x: 125, y: 125 },
    layerId: 'layer-1',
    tool: 'move',
    startPoint: { x: 125, y: 125 },
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    moveOriginalMask: mask,
    moveOriginalBounds: { x: startX, y: startY, width: w, height: h },
    quickMaskOriginalPixels: new Uint8Array(docW * docH),
    quickMaskOriginalWidth: docW,
    quickMaskOriginalHeight: docH,
    ...overrides,
  };
}

function makeFloatingSelectionRef(v: FloatingSelection | null = null): MutableRefObject<FloatingSelection | null> {
  return { current: v };
}

describe('handleMoveMove — quick-mask + marquee (#642)', () => {
  beforeEach(() => {
    uploadQuickMaskPixelsMock.mockClear();
    setSelectionMock.mockClear();
    setMarqueePreviewMock.mockClear();
    notifyRenderMock.mockClear();
    uiState.setTransform.mockClear();
    uiState.maskMode = 'quickMask';
  });

  it('does NOT upload the quick-mask pixels or full selection mask during a move event', () => {
    const state = makeState();
    handleMoveMove(state, { x: 175, y: 125 }, makeFloatingSelectionRef(null));

    // The bug: docW*docH-byte GPU uploads on every move event. Fix asserts none.
    expect(uploadQuickMaskPixelsMock).not.toHaveBeenCalled();
    expect(setSelectionMock).not.toHaveBeenCalled();
  });

  it('emits an analytic marquee-move preview instead so the outline stays live', () => {
    const state = makeState();
    handleMoveMove(state, { x: 175, y: 140 }, makeFloatingSelectionRef(null));

    expect(setMarqueePreviewMock).toHaveBeenCalledTimes(1);
    expect(setMarqueePreviewMock).toHaveBeenCalledWith({ kind: 'move', dx: 50, dy: 15 });
    expect(notifyRenderMock).toHaveBeenCalled();
  });

  it('rapid move events add no GPU uploads (30 moves ⇒ 0 uploads)', () => {
    const state = makeState();
    for (let i = 0; i < 30; i++) {
      handleMoveMove(state, { x: 125 + i, y: 125 + i }, makeFloatingSelectionRef(null));
    }
    expect(uploadQuickMaskPixelsMock).not.toHaveBeenCalled();
    expect(setSelectionMock).not.toHaveBeenCalled();
    expect(setMarqueePreviewMock).toHaveBeenCalledTimes(30);
  });
});

describe('handleMoveUp — quick-mask + marquee (#642)', () => {
  beforeEach(() => {
    uploadQuickMaskPixelsMock.mockClear();
    setSelectionMock.mockClear();
    setMarqueePreviewMock.mockClear();
    notifyRenderMock.mockClear();
    uiState.setTransform.mockClear();
    uiState.maskMode = 'quickMask';
  });

  it('materializes the translated quick-mask pixels + selection mask exactly once on release', () => {
    const state = makeState();
    handleMoveUp(
      state,
      { x: 155, y: 145 },
      makeFloatingSelectionRef(null),
      { current: null } as MutableRefObject<PersistentTransform | null>,
    );

    // The whole point of the fix: exactly one upload + one setSelection at commit.
    expect(uploadQuickMaskPixelsMock).toHaveBeenCalledTimes(1);
    expect(setSelectionMock).toHaveBeenCalledTimes(1);
    const setSelectionArgs = setSelectionMock.mock.calls[0]!;
    const commitBounds = setSelectionArgs[0] as Rect;
    // Original bounds were {100, 100, 50, 50}, drag was (30, 20).
    expect(commitBounds).toEqual({ x: 130, y: 120, width: 50, height: 50 });
    expect(setMarqueePreviewMock).toHaveBeenCalledWith(null);
  });

  it('is a no-op when the pointer did not move (no allocation, no upload)', () => {
    const state = makeState();
    handleMoveUp(
      state,
      { x: 125, y: 125 },
      makeFloatingSelectionRef(null),
      { current: null } as MutableRefObject<PersistentTransform | null>,
    );

    expect(uploadQuickMaskPixelsMock).not.toHaveBeenCalled();
    expect(setSelectionMock).not.toHaveBeenCalled();
    expect(setMarqueePreviewMock).toHaveBeenCalledWith(null);
  });
});
