import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The move-handlers module creates its rAF coalescers at import time and
// captures `requestAnimationFrame` inside their closures — so the test
// stubs have to be installed BEFORE importing the module under test.
// vi.hoisted lifts this setup above the ES-module-hoisted imports.
const rafHandles = vi.hoisted(() => {
  const state: { cbs: FrameRequestCallback[]; nextId: number } = {
    cbs: [],
    nextId: 1,
  };
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    state.cbs.push(cb);
    return state.nextId++;
  };
  globalThis.cancelAnimationFrame = (): void => {
    state.cbs = [];
  };
  return state;
});

function tickFrame(): void {
  const pending = rafHandles.cbs;
  rafHandles.cbs = [];
  for (const cb of pending) cb(0);
}

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  floatSelection: vi.fn(() => new Int32Array()),
  restoreFloatBase: vi.fn(),
  compositeFloat: vi.fn(),
  hasFloat: vi.fn(() => false),
  setSelectionMask: vi.fn(),
  readQuickMaskPixels: vi.fn(() => new Uint8Array(8)),
  uploadQuickMaskPixels: vi.fn(),
}));

const engine: { __engine: string } | null = { __engine: 'mock' };
vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => engine,
}));

vi.mock('../../panels/LayerPanel/layer-selection', () => ({
  selectLayerAlpha: vi.fn(),
}));

vi.mock('../store/clear-js-pixel-data', () => ({
  clearJsPixelData: vi.fn(),
}));

vi.mock('./prefloat', () => ({
  consumePrefloat: vi.fn(() => null),
  cancelPrefloat: vi.fn(),
}));

const DOC_W = 32;
const DOC_H = 32;

const editorState = {
  document: { width: DOC_W, height: DOC_H, layers: [] as unknown[] },
  selection: {
    active: false,
    mask: null as Uint8ClampedArray | null,
    bounds: null as { x: number; y: number; width: number; height: number } | null,
    maskWidth: 0,
    maskHeight: 0,
  },
  setSelection: vi.fn(),
  setSelectionBounds: vi.fn(),
  notifyRender: vi.fn(),
};

vi.mock('../editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

const uiState = {
  maskMode: 'quickMask' as 'off' | 'layerMask' | 'quickMask',
  showGrid: false,
  snapToGrid: false,
  snapToLayers: false,
  gridSize: 10,
  setTransform: vi.fn(),
  setSnapLines: vi.fn(),
  clearSnapLines: vi.fn(),
};

vi.mock('../ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

import {
  handleMoveMove,
  handleMoveUp,
  flushQuickMaskDrag,
} from './move-handlers';
import type { InteractionState, FloatingSelection, PersistentTransform } from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';

function makeMoveState(overrides: Partial<InteractionState> = {}): InteractionState {
  const mask = new Uint8ClampedArray(DOC_W * DOC_H);
  for (let y = 5; y < 10; y++) {
    for (let x = 5; x < 10; x++) mask[y * DOC_W + x] = 255;
  }
  return {
    drawing: true,
    lastPoint: { x: 0, y: 0 },
    layerId: 'layer-1',
    tool: 'move',
    startPoint: { x: 0, y: 0 },
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    moveOriginalMask: mask,
    moveOriginalBounds: { x: 5, y: 5, width: 5, height: 5 },
    ...overrides,
  };
}

function makeFloatRef(): { current: FloatingSelection | null } {
  return { current: null };
}

function makePersistentRef(): { current: PersistentTransform | null } {
  return { current: null };
}

describe('handleMoveMove (quick-mask + marquee move)', () => {
  beforeEach(() => {
    rafHandles.cbs = [];
    rafHandles.nextId = 1;

    editorState.setSelection.mockClear();
    editorState.setSelectionBounds.mockClear();
    editorState.notifyRender.mockClear();
    uiState.setTransform.mockClear();
    uiState.maskMode = 'quickMask';

    // Ensure no cross-test drag target leakage.
    flushQuickMaskDrag();
    editorState.setSelection.mockClear();
    uiState.setTransform.mockClear();
    rafHandles.cbs = [];
  });

  afterEach(() => {
    // Drain any pending frame between tests.
    rafHandles.cbs = [];
  });

  // Issue #656 regression: the selection-mask rebuild + setSelection +
  // setTransform in the quick-mask marquee move branch used to run on
  // every pointer event. A 250Hz pen tablet fires ~4 events per rendered
  // frame — only the last position is visible, so the intermediate mask
  // allocations (docW*docH bytes each) and the syncSelection re-uploads
  // they triggered were pure waste. Coalescing to rAF caps the mask
  // rebuild + setSelection at once per rendered frame.
  it('coalesces bursts of quick-mask marquee moves into one setSelection per frame (issue #656)', () => {
    const floatRef = makeFloatRef();
    const state = makeMoveState();

    for (let i = 0; i < 10; i++) {
      handleMoveMove(state, { x: i, y: i }, floatRef);
    }

    // Before the frame fires, nothing has been pushed to the store —
    // the whole point of coalescing.
    expect(editorState.setSelection).not.toHaveBeenCalled();
    expect(uiState.setTransform).not.toHaveBeenCalled();

    tickFrame();

    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    expect(uiState.setTransform).toHaveBeenCalledTimes(1);
    // The single call uses the latest drag delta (dx=9, dy=9), so the new
    // bounds are shifted by (9,9) from the original (5,5, 5x5).
    const [bounds] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
      number,
      number,
    ];
    expect(bounds).toEqual({ x: 14, y: 14, width: 5, height: 5 });
  });

  it('flushQuickMaskDrag flushes any pending mask update synchronously', () => {
    const floatRef = makeFloatRef();
    const state = makeMoveState();

    handleMoveMove(state, { x: 3, y: 4 }, floatRef);
    expect(editorState.setSelection).not.toHaveBeenCalled();

    flushQuickMaskDrag();

    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    const [bounds] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
      number,
      number,
    ];
    expect(bounds).toEqual({ x: 8, y: 9, width: 5, height: 5 });
  });

  it('handleMoveUp flushes any pending mask update so the drop position is materialized', () => {
    const floatRef = makeFloatRef();
    const persistentRef = makePersistentRef();
    const state = makeMoveState();

    handleMoveMove(state, { x: 2, y: 3 }, floatRef);
    handleMoveMove(state, { x: 5, y: 7 }, floatRef);
    expect(editorState.setSelection).not.toHaveBeenCalled();

    handleMoveUp(state, { x: 5, y: 7 }, floatRef, persistentRef);

    // The pending mask update was flushed with the latest offset. The
    // non-quick-mask final-materialization path in handleMoveUp is
    // gated on floatingSelectionRef.current, which is null in the
    // quick-mask branch — so exactly one setSelection call from the
    // coalescer flush.
    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    const [bounds] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
      number,
      number,
    ];
    expect(bounds).toEqual({ x: 10, y: 12, width: 5, height: 5 });
  });

  it('reschedules for the next frame after firing (a new burst runs again)', () => {
    const floatRef = makeFloatRef();
    const state = makeMoveState();

    handleMoveMove(state, { x: 1, y: 1 }, floatRef);
    tickFrame();
    handleMoveMove(state, { x: 2, y: 2 }, floatRef);
    tickFrame();

    expect(editorState.setSelection).toHaveBeenCalledTimes(2);
  });

  it('skips the coalesced update if dx/dy match the last applied delta (dedupes identical positions)', () => {
    const floatRef = makeFloatRef();
    const state = makeMoveState();

    handleMoveMove(state, { x: 3, y: 3 }, floatRef);
    tickFrame();
    expect(editorState.setSelection).toHaveBeenCalledTimes(1);

    // A pointer event that lands on the same pixel as the last flush
    // still schedules a frame, but the apply function sees the same
    // delta and returns before invoking setSelection.
    handleMoveMove(state, { x: 3, y: 3 }, floatRef);
    tickFrame();
    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
  });
});
