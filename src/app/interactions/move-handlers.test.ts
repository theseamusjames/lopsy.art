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
  cropLayerToContent: vi.fn(() => new Float64Array([0, 0, 0, 0])),
  // Spy so the handleMoveDown regression test can assert it is NEVER called
  // (issue #701). The GPU-side crop replaces the JS-side readback path.
  readLayerPixels: vi.fn(() => new Uint8Array()),
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
  document: {
    width: DOC_W,
    height: DOC_H,
    layers: [] as unknown[],
    activeLayerId: null as string | null,
    selectedLayerIds: [] as string[],
  },
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
  pushHistory: vi.fn(),
  pushPrebuiltSnapshot: vi.fn(),
  duplicateLayer: vi.fn(),
  updateLayerPosition: vi.fn(),
  expandLayerForEditing: vi.fn(),
  cropLayerToContent: vi.fn(),
};

vi.mock('../editor-store', () => ({
  useEditorStore: {
    getState: () => editorState,
    setState: (updater: unknown) => {
      const next = typeof updater === 'function'
        ? (updater as (s: typeof editorState) => Partial<typeof editorState>)(editorState)
        : updater as Partial<typeof editorState>;
      Object.assign(editorState, next);
    },
  },
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
  handleMoveDown,
  handleMoveMove,
  handleMoveUp,
  flushQuickMaskDrag,
} from './move-handlers';
import type { InteractionState, FloatingSelection, PersistentTransform, InteractionContext, LastPaintPoint } from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS, withMoveGesture } from './interaction-types';
import * as bridge from '../../engine-wasm/wasm-bridge';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { DEFAULT_EFFECTS } from '../../layers/layer-model';
import type { Layer, RasterLayer, Point } from '../../types';

function makeMoveState(overrides: Partial<InteractionState> = {}): InteractionState {
  const mask = new Uint8ClampedArray(DOC_W * DOC_H);
  for (let y = 5; y < 10; y++) {
    for (let x = 5; x < 10; x++) mask[y * DOC_W + x] = 255;
  }
  const base: InteractionState = {
    drawing: true,
    lastPoint: { x: 0, y: 0 },
    layerId: 'layer-1',
    tool: 'move',
    startPoint: { x: 0, y: 0 },
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    ...overrides,
  };
  return withMoveGesture(base, {
    originalMask: mask,
    originalBounds: { x: 5, y: 5, width: 5, height: 5 },
  });
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

describe('handleMoveDown — whole-layer move grab (issue #701)', () => {
  // The whole-layer move grab used to call `editorState.expandLayerForEditing`
  // and `editorState.cropLayerToContent` on pointer-down. Those two together
  // did a full GPU→CPU readback (`readLayerPixels`) plus a JS-side ImageData
  // allocation (67 MB at 4096×4096) plus a CPU alpha scan — all on the frame
  // the user starts dragging. The fix routes the crop through the WASM
  // `cropLayerToContent`, which crops the GPU texture in place and returns
  // the new bounds. No JS readback, no ImageData allocation, no CPU scan.

  const makeContext = (
    activeLayer: Layer,
    { altKey = false }: { altKey?: boolean } = {},
  ): InteractionContext => {
    const canvasPos: Point = { x: 10, y: 10 };
    return {
      canvasPos,
      layerPos: canvasPos,
      shiftKey: false,
      altKey,
      metaKey: false,
      activeLayer,
      activeLayerId: activeLayer.id,
      clientX: 10,
      clientY: 10,
      stateRef: { current: { drawing: false, tool: 'move' } as InteractionState },
      floatingSelectionRef: { current: null },
      persistentTransformRef: { current: null },
      stampSourceRef: { current: null },
      stampOffsetRef: { current: null },
      lastPaintPointRef: { current: null as LastPaintPoint | null },
    };
  };

  const baseRaster: RasterLayer = {
    id: 'raster-1',
    name: 'Raster',
    type: 'raster',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    width: DOC_W,
    height: DOC_H,
    clipToBelow: false,
    effects: DEFAULT_EFFECTS,
    mask: null,
  };

  beforeEach(() => {
    editorState.document.layers = [baseRaster];
    editorState.selection = {
      active: false,
      mask: null,
      bounds: null,
      maskWidth: 0,
      maskHeight: 0,
    };
    editorState.pushHistory.mockClear();
    editorState.expandLayerForEditing.mockClear();
    editorState.cropLayerToContent.mockClear();
    uiState.maskMode = 'off';
    vi.mocked(bridge.cropLayerToContent).mockReset();
    vi.mocked(bridge.readLayerPixels).mockClear();
    vi.mocked(clearJsPixelData).mockClear();
  });

  it('routes the pre-move crop through the WASM cropLayerToContent (not the JS expand + CPU scan)', () => {
    vi.mocked(bridge.cropLayerToContent).mockReturnValue(new Float64Array([2, 3, 20, 15]));
    handleMoveDown(makeContext(baseRaster));

    expect(vi.mocked(bridge.cropLayerToContent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.cropLayerToContent).mock.calls[0]![1]).toBe(baseRaster.id);

    // The JS-side CPU-scan path must not run — that's the whole point.
    expect(editorState.expandLayerForEditing).not.toHaveBeenCalled();
    expect(editorState.cropLayerToContent).not.toHaveBeenCalled();
  });

  it('never triggers a JS-side readLayerPixels for the whole-layer grab', () => {
    vi.mocked(bridge.cropLayerToContent).mockReturnValue(new Float64Array([0, 0, DOC_W, DOC_H]));
    handleMoveDown(makeContext(baseRaster));

    // The 67 MB readback the issue is about lived behind
    // readLayerAsImageData → readLayerPixels. Neither belongs on this path.
    expect(vi.mocked(bridge.readLayerPixels)).not.toHaveBeenCalled();
  });

  it('updates layer bounds from the GPU crop result and clears stale JS pixel data', () => {
    vi.mocked(bridge.cropLayerToContent).mockReturnValue(new Float64Array([4, 5, 12, 8]));
    handleMoveDown(makeContext(baseRaster));

    const updated = editorState.document.layers[0] as RasterLayer;
    expect(updated.x).toBe(4);
    expect(updated.y).toBe(5);
    expect(updated.width).toBe(12);
    expect(updated.height).toBe(8);
    expect(vi.mocked(clearJsPixelData)).toHaveBeenCalledWith(baseRaster.id);
  });

  it('leaves layer bounds untouched when the GPU crop reports the same bounds', () => {
    vi.mocked(bridge.cropLayerToContent).mockReturnValue(new Float64Array([0, 0, DOC_W, DOC_H]));
    handleMoveDown(makeContext(baseRaster));

    const updated = editorState.document.layers[0] as RasterLayer;
    expect(updated.x).toBe(0);
    expect(updated.y).toBe(0);
    expect(updated.width).toBe(DOC_W);
    expect(updated.height).toBe(DOC_H);
    // Bounds unchanged ⇒ no need to drop cached JS pixel data.
    expect(vi.mocked(clearJsPixelData)).not.toHaveBeenCalled();
  });

  it('does not crop non-raster layers (text/shape/group have no crop-to-content concept)', () => {
    const shape: Layer = { ...baseRaster, id: 'shape-1', type: 'shape' } as unknown as Layer;
    editorState.document.layers = [shape];
    vi.mocked(bridge.cropLayerToContent).mockReturnValue(new Float64Array([0, 0, 10, 10]));
    handleMoveDown(makeContext(shape));

    expect(vi.mocked(bridge.cropLayerToContent)).not.toHaveBeenCalled();
  });
});

describe('handleMoveDown / handleMoveMove — multi-layer move (issue #707)', () => {
  const baseRaster: RasterLayer = {
    id: 'raster-1',
    name: 'Raster',
    type: 'raster',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    width: DOC_W,
    height: DOC_H,
    clipToBelow: false,
    effects: DEFAULT_EFFECTS,
    mask: null,
  };

  const sibling: RasterLayer = { ...baseRaster, id: 'raster-2', x: 50, y: 40 };
  const lockedSibling: RasterLayer = { ...baseRaster, id: 'raster-3', x: 90, y: 90, locked: true };

  const makeContext = (activeLayer: Layer): InteractionContext => {
    const canvasPos: Point = { x: 10, y: 10 };
    return {
      canvasPos,
      layerPos: canvasPos,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      activeLayer,
      activeLayerId: activeLayer.id,
      clientX: 10,
      clientY: 10,
      stateRef: { current: { drawing: false, tool: 'move' } as InteractionState },
      floatingSelectionRef: { current: null },
      persistentTransformRef: { current: null },
      stampSourceRef: { current: null },
      stampOffsetRef: { current: null },
      lastPaintPointRef: { current: null as LastPaintPoint | null },
    };
  };

  beforeEach(() => {
    editorState.document.layers = [baseRaster, sibling, lockedSibling];
    editorState.document.activeLayerId = baseRaster.id;
    editorState.document.selectedLayerIds = [baseRaster.id, sibling.id, lockedSibling.id];
    editorState.selection = { active: false, mask: null, bounds: null, maskWidth: 0, maskHeight: 0 };
    editorState.pushHistory.mockClear();
    editorState.updateLayerPosition.mockClear();
    uiState.maskMode = 'off';
    uiState.showGrid = false;
    uiState.snapToGrid = false;
    uiState.snapToLayers = false;
    vi.mocked(bridge.cropLayerToContent).mockReset();
    vi.mocked(bridge.cropLayerToContent).mockImplementation((_engine: unknown, id: string) => {
      const layer = editorState.document.layers.find((l) => (l as Layer).id === id) as Layer | undefined;
      if (!layer) return new Float64Array([0, 0, 0, 0]);
      const w = layer.type === 'raster' ? (layer.width ?? 0) : 0;
      const h = layer.type === 'raster' ? ((layer as { height?: number }).height ?? 0) : 0;
      return new Float64Array([layer.x, layer.y, w, h]);
    });
  });

  it('captures sibling starting positions for every other selected, unlocked layer', () => {
    const state = handleMoveDown(makeContext(baseRaster));
    expect(state.gesture.kind).toBe('move');
    if (state.gesture.kind !== 'move') return;
    // Locked sibling is excluded — moving a locked layer would be surprising.
    expect(state.gesture.siblings).toEqual([{ id: 'raster-2', startX: 50, startY: 40 }]);
  });

  it('applies the same delta to the active layer and every sibling on move', () => {
    const state = handleMoveDown(makeContext(baseRaster));
    // Simulate a drag of (+8, +6) from the start point (10, 10).
    handleMoveMove(state, { x: 18, y: 16 }, makeFloatRef());

    expect(editorState.updateLayerPosition).toHaveBeenCalledWith('raster-1', 8, 6);
    expect(editorState.updateLayerPosition).toHaveBeenCalledWith('raster-2', 58, 46);
    // Locked layer never moves.
    expect(editorState.updateLayerPosition).not.toHaveBeenCalledWith('raster-3', expect.anything(), expect.anything());
  });

  it('single-layer selection does not populate siblings', () => {
    editorState.document.selectedLayerIds = [baseRaster.id];
    const state = handleMoveDown(makeContext(baseRaster));
    if (state.gesture.kind !== 'move') throw new Error('expected move gesture');
    expect(state.gesture.siblings).toEqual([]);
  });
});
