/**
 * Regression tests for issues #641 / #642: no per-move full-document CPU
 * or GPU work in the eyedropper and quick-mask-move interaction paths.
 *
 * The quick-mask-move test exercises the move handler with the maskMode
 * set to 'quickMask' and asserts:
 *   - handleMoveMove does NOT call uploadQuickMaskPixels or setSelection
 *     during the drag — only setSelectionBounds is updated.
 *   - handleMoveUp materializes the translated selection mask and calls
 *     uploadQuickMaskPixels exactly once when the drag ends.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const uploadQuickMaskPixels = vi.fn();
const setSelectionMaskBridge = vi.fn();
const floatSelection = vi.fn(() => new Int32Array([0, 0, 8, 8]));
const restoreFloatBase = vi.fn();
const compositeFloat = vi.fn();
const hasFloat = vi.fn(() => false);
const readQuickMaskPixels = vi.fn(() => new Uint8Array(0));

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  floatSelection: (...args: unknown[]) => floatSelection(...(args as [])),
  restoreFloatBase: (...args: unknown[]) => restoreFloatBase(...(args as [])),
  compositeFloat: (...args: unknown[]) => compositeFloat(...(args as [])),
  hasFloat: (...args: unknown[]) => hasFloat(...(args as [])),
  setSelectionMask: (...args: unknown[]) => setSelectionMaskBridge(...(args as [])),
  readQuickMaskPixels: (...args: unknown[]) => readQuickMaskPixels(...(args as [])),
  uploadQuickMaskPixels: (...args: unknown[]) => uploadQuickMaskPixels(...(args as [])),
}));

let engine: { __engine: string } | null = { __engine: 'mock' };
vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => engine,
}));

// UI store state
const uiState: {
  maskMode: 'quickMask' | 'layerMask' | null;
  showGrid: boolean;
  snapToGrid: boolean;
  snapToLayers: boolean;
  gridSize: number;
  activeTool: string;
  clearSnapLines: ReturnType<typeof vi.fn>;
  setSnapLines: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
} = {
  maskMode: 'quickMask',
  showGrid: false,
  snapToGrid: false,
  snapToLayers: false,
  gridSize: 32,
  activeTool: 'move',
  clearSnapLines: vi.fn(),
  setSnapLines: vi.fn(),
  setTransform: vi.fn(),
};
vi.mock('../ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

// Editor store state
interface FakeSelection {
  active: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
  mask: Uint8ClampedArray | null;
  maskWidth: number;
  maskHeight: number;
}
const editorState: {
  document: { width: number; height: number; layers: Array<{ id: string; x: number; y: number; visible: boolean }> };
  selection: FakeSelection;
  setSelection: ReturnType<typeof vi.fn>;
  setSelectionBounds: ReturnType<typeof vi.fn>;
  notifyRender: ReturnType<typeof vi.fn>;
  pushHistory: ReturnType<typeof vi.fn>;
  pushPrebuiltSnapshot: ReturnType<typeof vi.fn>;
  expandLayerForEditing: ReturnType<typeof vi.fn>;
  cropLayerToContent: ReturnType<typeof vi.fn>;
  duplicateLayer: ReturnType<typeof vi.fn>;
  updateLayerPosition: ReturnType<typeof vi.fn>;
} = {
  document: {
    width: 8,
    height: 8,
    layers: [{ id: 'L', x: 0, y: 0, visible: true }],
  },
  selection: {
    active: true,
    bounds: { x: 2, y: 2, width: 2, height: 2 },
    mask: (() => {
      const m = new Uint8ClampedArray(64);
      m[2 * 8 + 2] = 255;
      m[2 * 8 + 3] = 255;
      m[3 * 8 + 2] = 255;
      m[3 * 8 + 3] = 255;
      return m;
    })(),
    maskWidth: 8,
    maskHeight: 8,
  },
  setSelection: vi.fn(),
  setSelectionBounds: vi.fn(),
  notifyRender: vi.fn(),
  pushHistory: vi.fn(),
  pushPrebuiltSnapshot: vi.fn(),
  expandLayerForEditing: vi.fn(),
  cropLayerToContent: vi.fn(),
  duplicateLayer: vi.fn(),
  updateLayerPosition: vi.fn(),
};
vi.mock('../editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

vi.mock('../store/clear-js-pixel-data', () => ({
  clearJsPixelData: vi.fn(),
}));

vi.mock('../../panels/LayerPanel/layer-selection', () => ({
  selectLayerAlpha: vi.fn(),
}));

vi.mock('./prefloat', () => ({
  consumePrefloat: () => null,
  cancelPrefloat: () => {},
}));

vi.mock('../../tools/move/move', () => ({
  snapPositionToGrid: (x: number, y: number) => ({ x, y }),
  snapPositionToLayers: (x: number, y: number) => ({ x, y, snapLinesX: [], snapLinesY: [] }),
}));

vi.mock('../../tools/transform/transform', () => ({
  createTransformState: (bounds: { x: number; y: number; width: number; height: number }) => ({
    ...bounds,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    translateX: 0,
    translateY: 0,
  }),
}));

import { handleMoveMove, handleMoveUp } from './move-handlers';
import type { InteractionState, FloatingSelection, PersistentTransform } from './interaction-types';
import { INITIAL_INTERACTION_STATE } from './interaction-types';

function makeState(overrides: Partial<InteractionState> = {}): InteractionState {
  const mask = new Uint8ClampedArray(64);
  mask[2 * 8 + 2] = 255;
  mask[2 * 8 + 3] = 255;
  mask[3 * 8 + 2] = 255;
  mask[3 * 8 + 3] = 255;
  return {
    ...INITIAL_INTERACTION_STATE,
    drawing: true,
    lastPoint: { x: 0, y: 0 },
    layerId: 'L',
    tool: 'move',
    startPoint: { x: 0, y: 0 },
    layerStartX: 0,
    layerStartY: 0,
    moveOriginalMask: mask,
    moveOriginalBounds: { x: 2, y: 2, width: 2, height: 2 },
    quickMaskOriginalPixels: (() => {
      const p = new Uint8Array(64);
      p[2 * 8 + 2] = 200;
      p[2 * 8 + 3] = 200;
      p[3 * 8 + 2] = 200;
      p[3 * 8 + 3] = 200;
      return p;
    })(),
    quickMaskOriginalWidth: 8,
    quickMaskOriginalHeight: 8,
    ...overrides,
  };
}

describe('issue #642: quick-mask marquee move defers full-doc work to pointer-up', () => {
  beforeEach(() => {
    uploadQuickMaskPixels.mockClear();
    setSelectionMaskBridge.mockClear();
    editorState.setSelection.mockClear();
    editorState.setSelectionBounds.mockClear();
    editorState.notifyRender.mockClear();
    engine = { __engine: 'mock' };
    uiState.maskMode = 'quickMask';
  });

  it('handleMoveMove does not upload full-doc quick-mask pixels or replace the selection mask', () => {
    const floatRef = { current: null } as { current: FloatingSelection | null };
    const state = makeState();
    // Simulate a burst of 20 pointer-moves in a single drag.
    for (let i = 1; i <= 20; i++) {
      handleMoveMove(state, { x: i, y: i }, floatRef);
    }
    // Not once.
    expect(uploadQuickMaskPixels).not.toHaveBeenCalled();
    // Never replaces the mask reference during the drag.
    expect(editorState.setSelection).not.toHaveBeenCalled();
    // But the bounds do move so the marquee outline follows the cursor.
    expect(editorState.setSelectionBounds).toHaveBeenCalledTimes(20);
    const lastBounds = editorState.setSelectionBounds.mock.calls[19]![0];
    expect(lastBounds).toEqual({ x: 22, y: 22, width: 2, height: 2 });
  });

  it('handleMoveUp materializes the translated selection mask and uploads quick-mask pixels exactly once', () => {
    const floatRef = { current: null } as { current: FloatingSelection | null };
    const transformRef = { current: null } as { current: PersistentTransform | null };
    const state = makeState();
    // Simulate the drag
    handleMoveMove(state, { x: 1, y: 1 }, floatRef);
    handleMoveMove(state, { x: 2, y: 1 }, floatRef);
    handleMoveMove(state, { x: 3, y: 1 }, floatRef);
    expect(uploadQuickMaskPixels).not.toHaveBeenCalled();

    // Now release
    handleMoveUp(state, { x: 3, y: 1 }, floatRef, transformRef);
    expect(uploadQuickMaskPixels).toHaveBeenCalledTimes(1);
    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    const [bounds, mask, w, h] = editorState.setSelection.mock.calls[0]!;
    expect(bounds).toEqual({ x: 5, y: 3, width: 2, height: 2 });
    expect(w).toBe(8);
    expect(h).toBe(8);
    // The translated mask should have moved the selected pixels by (3, 1).
    expect((mask as Uint8ClampedArray)[3 * 8 + 5]).toBe(255);
    expect((mask as Uint8ClampedArray)[3 * 8 + 6]).toBe(255);
    // Origin pixels should be cleared.
    expect((mask as Uint8ClampedArray)[2 * 8 + 2]).toBe(0);
  });

  it('handleMoveUp is a no-op when maskMode changed away from quickMask before release', () => {
    const floatRef = { current: null } as { current: FloatingSelection | null };
    const transformRef = { current: null } as { current: PersistentTransform | null };
    const state = makeState();
    handleMoveMove(state, { x: 5, y: 5 }, floatRef);
    uiState.maskMode = null;
    handleMoveUp(state, { x: 5, y: 5 }, floatRef, transformRef);
    expect(uploadQuickMaskPixels).not.toHaveBeenCalled();
  });
});
