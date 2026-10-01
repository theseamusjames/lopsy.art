import { describe, it, expect, vi, beforeEach } from 'vitest';

const hasFloat = vi.fn((..._args: unknown[]) => false);
const dropFloat = vi.fn();

// selection-handlers (imported by the strategy) pulls in every selection
// strategy, so the mock must cover the whole graph. Mask helpers throw so
// the pure TS fallbacks run and real mask contents can be asserted.
vi.mock('../../engine-wasm/wasm-bridge', () => {
  const wasmThrow = (): never => {
    throw new Error('wasm unavailable in test');
  };
  return {
    createRectSelection: wasmThrow,
    createEllipseSelection: wasmThrow,
    selectionBounds: wasmThrow,
    createPolygonMask: wasmThrow,
    combineSelections: wasmThrow,
    setSelectionMask: vi.fn(),
    featherSelectionMask: vi.fn(),
    readSelectionMask: vi.fn(),
    hasFloat: (...args: unknown[]) => hasFloat(...args),
    dropFloat: (...args: unknown[]) => dropFloat(...args),
    floodFill: vi.fn(),
    floodFillGraduated: vi.fn(),
    readLayerPixelsForFill: vi.fn(),
    magneticLassoBegin: vi.fn(),
    magneticLassoSnap: vi.fn(),
    magneticLassoSnapPoint: vi.fn(),
    magneticLassoEnd: vi.fn(),
  };
});

vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => ({ __engine: 'mock' }),
}));

const DOC_W = 100;
const DOC_H = 100;

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
  clearSelection: vi.fn(),
  notifyRender: vi.fn(),
  pushHistoryMetadata: vi.fn(),
};
vi.mock('../../app/editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

const uiState = {
  setTransform: vi.fn(),
  openModal: vi.fn(),
  showGrid: false,
  snapToGrid: false,
  gridSize: 10,
};
vi.mock('../../app/ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

const ts = {
  settings: { marquee: { feather: 0 } },
  aspectRatioLocked: false,
  aspectRatioW: 1,
  aspectRatioH: 1,
};
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => ts },
}));

import { marqueeStrategy, confirmMarqueeRegion } from './marquee-strategy';
import { getMarqueePreview, setMarqueePreview } from './marquee-preview';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS, withMoveGesture } from '../../app/interactions/interaction-types';
import type { SelectionUpContext } from '../../app/interactions/selection-strategy';

function makeCtx(overrides: Partial<InteractionContext> = {}): InteractionContext {
  const layer = { id: 'layer-1', x: 0, y: 0, visible: true } as unknown as InteractionContext['activeLayer'];
  return {
    canvasPos: { x: 10, y: 10 },
    layerPos: { x: 10, y: 10 },
    shiftKey: false,
    altKey: false,
    metaKey: false,
    activeLayerId: 'layer-1',
    activeLayer: layer,
    clientX: 0,
    clientY: 0,
    stateRef: { current: {} } as unknown as InteractionContext['stateRef'],
    floatingSelectionRef: { current: { offsetX: 0 } as never },
    persistentTransformRef: { current: { maskWidth: 1 } as never },
    stampSourceRef: { current: null },
    stampOffsetRef: { current: null },
    lastPaintPointRef: { current: null },
    ...overrides,
  };
}

function makeState(overrides: Partial<InteractionState> = {}): InteractionState {
  return {
    drawing: true,
    lastPoint: null,
    layerId: 'layer-1',
    tool: 'marquee-rect',
    startPoint: { x: 10, y: 10 },
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    ...overrides,
  };
}

function makeUpCtx(clientX: number, clientY: number): SelectionUpContext {
  return {
    screenToCanvas: (sx, sy) => ({ x: sx, y: sy }),
    containerRef: {
      current: {
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
      } as unknown as HTMLDivElement,
    },
    event: { clientX, clientY },
  };
}

beforeEach(() => {
  hasFloat.mockReset();
  hasFloat.mockReturnValue(false);
  dropFloat.mockClear();
  editorState.setSelection.mockClear();
  editorState.clearSelection.mockClear();
  editorState.pushHistoryMetadata.mockClear();
  uiState.setTransform.mockClear();
  uiState.openModal.mockClear();
  editorState.document = { width: DOC_W, height: DOC_H, layers: [] };
  editorState.selection = { active: false, mask: null, bounds: null, maskWidth: 0, maskHeight: 0 };
  uiState.showGrid = false;
  uiState.snapToGrid = false;
  ts.aspectRatioLocked = false;
  ts.settings.marquee.feather = 0;
  setMarqueePreview(null);
});

/** Narrow the live preview to its rect/ellipse shape for assertions. */
function rectPreview(): { x: number; y: number; width: number; height: number } {
  const p = getMarqueePreview();
  if (!p || p.kind === 'move') throw new Error('expected a rect/ellipse preview');
  return p.rect;
}

describe('marquee onDown', () => {
  it('starts a fresh selection drag outside any existing selection', () => {
    const ctx = makeCtx();
    const state = marqueeStrategy.onDown(ctx, 'marquee-rect');
    expect(state).toMatchObject({
      drawing: true,
      tool: 'marquee-rect',
      startPoint: { x: 10, y: 10 },
    });
    // A fresh selection drag is not a move gesture — the move-specific
    // payload only appears when the click lands inside an existing sel.
    expect(state?.gesture.kind).not.toBe('move');
    expect(uiState.setTransform).toHaveBeenCalledWith(null);
    expect(ctx.floatingSelectionRef.current).toBeNull();
    expect(ctx.persistentTransformRef.current).toBeNull();
  });

  it('starts a move gesture when clicking inside an existing selection', () => {
    const mask = new Uint8ClampedArray(DOC_W * DOC_H);
    mask[10 * DOC_W + 10] = 255;
    editorState.selection = {
      active: true,
      mask,
      bounds: { x: 10, y: 10, width: 1, height: 1 },
      maskWidth: DOC_W,
      maskHeight: DOC_H,
    };
    const state = marqueeStrategy.onDown(makeCtx(), 'marquee-rect');
    if (state?.gesture.kind !== 'move') throw new Error('expected a move gesture');
    expect(state.gesture.originalMask).toBeInstanceOf(Uint8ClampedArray);
    expect(state.gesture.originalMask).not.toBe(mask); // defensive copy
    expect(state.gesture.originalBounds).toEqual({ x: 10, y: 10, width: 1, height: 1 });
    expect(uiState.setTransform).not.toHaveBeenCalled();
  });

  it('drops any GPU float when starting a move inside a selection', () => {
    const mask = new Uint8ClampedArray(DOC_W * DOC_H).fill(255);
    editorState.selection = {
      active: true,
      mask,
      bounds: { x: 0, y: 0, width: DOC_W, height: DOC_H },
      maskWidth: DOC_W,
      maskHeight: DOC_H,
    };
    hasFloat.mockReturnValue(true);
    marqueeStrategy.onDown(makeCtx(), 'marquee-rect');
    expect(dropFloat).toHaveBeenCalledTimes(1);
  });

  it('does not drop the float when none exists', () => {
    const mask = new Uint8ClampedArray(DOC_W * DOC_H).fill(255);
    editorState.selection = {
      active: true,
      mask,
      bounds: { x: 0, y: 0, width: DOC_W, height: DOC_H },
      maskWidth: DOC_W,
      maskHeight: DOC_H,
    };
    marqueeStrategy.onDown(makeCtx(), 'marquee-rect');
    expect(dropFloat).not.toHaveBeenCalled();
  });

  it('clicking outside the mask area starts a fresh drag even with an active selection', () => {
    const mask = new Uint8ClampedArray(DOC_W * DOC_H);
    mask[50 * DOC_W + 50] = 255;
    editorState.selection = {
      active: true,
      mask,
      bounds: { x: 50, y: 50, width: 1, height: 1 },
      maskWidth: DOC_W,
      maskHeight: DOC_H,
    };
    const state = marqueeStrategy.onDown(makeCtx({ canvasPos: { x: 10, y: 10 } }), 'marquee-rect');
    // Fresh drag (not a move) even with an active selection because the
    // click landed outside its mask.
    expect(state?.gesture.kind).not.toBe('move');
    expect(uiState.setTransform).toHaveBeenCalledWith(null);
  });
});

describe('marquee onMove — creating a selection', () => {
  it('previews a rect from start to cursor without touching the bridge', () => {
    marqueeStrategy.onMove!(makeState(), { x: 30, y: 25 }, false);
    // No mask is built and nothing is committed mid-drag.
    expect(editorState.setSelection).not.toHaveBeenCalled();
    expect(getMarqueePreview()).toEqual({
      kind: 'rect',
      rect: { x: 10, y: 10, width: 20, height: 15 },
      isCombining: false,
    });
  });

  it('normalizes a drag up-left of the start point', () => {
    marqueeStrategy.onMove!(makeState({ startPoint: { x: 50, y: 50 } }), { x: 30, y: 40 }, false);
    expect(rectPreview()).toEqual({ x: 30, y: 40, width: 20, height: 10 });
  });

  it('clears the preview for a zero-size drag', () => {
    marqueeStrategy.onMove!(makeState(), { x: 10, y: 10 }, false);
    expect(getMarqueePreview()).toBeNull();
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });

  it('meta key constrains the selection to a square', () => {
    marqueeStrategy.onMove!(makeState(), { x: 50, y: 20 }, true);
    const rect = rectPreview();
    expect(rect.width).toBe(rect.height);
    expect(rect).toEqual({ x: 10, y: 10, width: 10, height: 10 });
  });

  it('honors a locked aspect ratio from tool settings', () => {
    ts.aspectRatioLocked = true;
    ts.aspectRatioW = 2;
    ts.aspectRatioH = 1;
    marqueeStrategy.onMove!(makeState(), { x: 50, y: 40 }, false);
    const rect = rectPreview();
    expect(rect.width / rect.height).toBeCloseTo(2);
  });

  it('previews an ellipse for the ellipse tool', () => {
    marqueeStrategy.onMove!(makeState({ tool: 'marquee-ellipse' }), { x: 30, y: 30 }, false);
    expect(getMarqueePreview()).toEqual({
      kind: 'ellipse',
      rect: { x: 10, y: 10, width: 20, height: 20 },
      isCombining: false,
    });
  });

  it('snaps start and end to the grid when grid snapping is on', () => {
    uiState.showGrid = true;
    uiState.snapToGrid = true;
    uiState.gridSize = 10;
    marqueeStrategy.onMove!(makeState({ startPoint: { x: 12, y: 12 } }), { x: 33, y: 28 }, false);
    expect(rectPreview()).toEqual({ x: 10, y: 10, width: 20, height: 20 });
  });

});

describe('marquee onMove — moving an existing selection', () => {
  it('previews the move delta without rebuilding or committing a mask', () => {
    const state = withMoveGesture(
      makeState({ startPoint: { x: 0, y: 0 } }),
      {
        originalMask: new Uint8ClampedArray(100),
        originalBounds: { x: 2, y: 2, width: 2, height: 2 },
      },
    );
    marqueeStrategy.onMove!(state, { x: 3, y: 2 }, false);
    expect(editorState.setSelection).not.toHaveBeenCalled();
    expect(getMarqueePreview()).toEqual({ kind: 'move', dx: 3, dy: 2 });
  });
});

describe('marquee onUp', () => {
  it('treats a sub-2px gesture as a click and clears an active selection', () => {
    editorState.selection = {
      active: true,
      mask: null,
      bounds: { x: 50, y: 50, width: 1, height: 1 },
      maskWidth: DOC_W,
      maskHeight: DOC_H,
    };
    marqueeStrategy.onUp!(makeState({ startPoint: { x: 10, y: 10 } }), { x: 11, y: 11 }, makeUpCtx(11, 11));
    expect(editorState.clearSelection).toHaveBeenCalledTimes(1);
    expect(uiState.setTransform).toHaveBeenCalledWith(null);
    expect(uiState.openModal).not.toHaveBeenCalled();
  });

  it('opens the region modal on a click with nothing selected', () => {
    marqueeStrategy.onUp!(makeState({ startPoint: { x: 10, y: 12 } }), { x: 11, y: 12 }, makeUpCtx(11, 12));
    expect(uiState.openModal).toHaveBeenCalledWith({
      kind: 'marqueeRegion',
      click: { shape: 'rect', point: { x: 10, y: 12 } },
    });
    expect(editorState.clearSelection).not.toHaveBeenCalled();
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });

  it('opens the region modal in ellipse mode for the elliptical marquee', () => {
    marqueeStrategy.onUp!(
      makeState({ tool: 'marquee-ellipse', startPoint: { x: 10, y: 10 } }),
      { x: 10, y: 10 },
      makeUpCtx(10, 10),
    );
    expect(uiState.openModal).toHaveBeenCalledWith({
      kind: 'marqueeRegion',
      click: { shape: 'ellipse', point: { x: 10, y: 10 } },
    });
  });

  it('builds and commits the previewed rect after a real drag', () => {
    setMarqueePreview({ kind: 'rect', rect: { x: 10, y: 10, width: 20, height: 20 } });
    marqueeStrategy.onUp!(makeState({ startPoint: { x: 10, y: 10 } }), { x: 40, y: 40 }, makeUpCtx(40, 40));
    expect(editorState.clearSelection).not.toHaveBeenCalled();
    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    const [rect, mask, w, h] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
      number,
      number,
    ];
    expect(rect).toEqual({ x: 10, y: 10, width: 20, height: 20 });
    expect(w).toBe(DOC_W);
    expect(h).toBe(DOC_H);
    expect(mask[12 * DOC_W + 12]).toBe(255); // inside
    expect(mask[5 * DOC_W + 5]).toBe(0); // outside
    expect(getMarqueePreview()).toBeNull(); // preview cleared on commit
  });

  it('commits a moved selection by translating the original mask on release', () => {
    editorState.document = { width: 10, height: 10, layers: [] };
    const src = new Uint8ClampedArray(10 * 10);
    // 2x2 block at (2,2)
    src[2 * 10 + 2] = 255;
    src[2 * 10 + 3] = 255;
    src[3 * 10 + 2] = 255;
    src[3 * 10 + 3] = 255;
    setMarqueePreview({ kind: 'move', dx: 3, dy: 2 });
    const state = withMoveGesture(
      makeState({ startPoint: { x: 0, y: 0 } }),
      { originalMask: src, originalBounds: { x: 2, y: 2, width: 2, height: 2 } },
    );
    marqueeStrategy.onUp!(state, { x: 3, y: 2 }, makeUpCtx(3, 2));
    const [bounds, mask] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
    ];
    expect(bounds).toEqual({ x: 5, y: 4, width: 2, height: 2 });
    expect(mask[4 * 10 + 5]).toBe(255); // (2,2) moved to (5,4)
    expect(mask[2 * 10 + 2]).toBe(0); // old location cleared
  });

  it('clips moved mask content dragged outside the document', () => {
    editorState.document = { width: 10, height: 10, layers: [] };
    const src = new Uint8ClampedArray(10 * 10);
    src[0] = 255; // pixel at (0,0)
    setMarqueePreview({ kind: 'move', dx: -3, dy: -3 });
    const state = withMoveGesture(
      makeState({ startPoint: { x: 0, y: 0 } }),
      { originalMask: src, originalBounds: { x: 0, y: 0, width: 1, height: 1 } },
    );
    marqueeStrategy.onUp!(state, { x: -3, y: -3 }, makeUpCtx(-3, -3));
    const [bounds, mask] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
    ];
    expect(bounds).toEqual({ x: -3, y: -3, width: 1, height: 1 });
    expect(mask.every((v) => v === 0)).toBe(true);
  });

  it('leaves the selection untouched when a move ends with no delta', () => {
    setMarqueePreview({ kind: 'move', dx: 0, dy: 0 });
    const state = withMoveGesture(makeState(), {
      originalMask: new Uint8ClampedArray(4),
      originalBounds: { x: 0, y: 0, width: 2, height: 2 },
    });
    marqueeStrategy.onUp!(state, { x: 50, y: 50 }, makeUpCtx(50, 50));
    expect(editorState.clearSelection).not.toHaveBeenCalled();
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });
});

/** A selection holding the rect (x, y, w, h) on the 100 x 100 test document. */
function selectRect(x: number, y: number, w: number, h: number): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(DOC_W * DOC_H);
  for (let yy = y; yy < y + h; yy++) mask.fill(255, yy * DOC_W + x, yy * DOC_W + x + w);
  editorState.selection = { active: true, mask, bounds: { x, y, width: w, height: h }, maskWidth: DOC_W, maskHeight: DOC_H };
  return mask;
}

function lastCommit(): { bounds: { x: number; y: number; width: number; height: number }; mask: Uint8ClampedArray } {
  const calls = editorState.setSelection.mock.calls;
  const [bounds, mask] = calls[calls.length - 1]! as [
    { x: number; y: number; width: number; height: number },
    Uint8ClampedArray,
  ];
  return { bounds, mask };
}

describe('marquee add / subtract / intersect', () => {
  it('Shift inside the selection starts a new shape instead of moving the outline', () => {
    selectRect(0, 0, 50, 50);
    const state = marqueeStrategy.onDown(makeCtx({ canvasPos: { x: 10, y: 10 }, shiftKey: true }), 'marquee-rect');
    expect(state?.gesture.kind).not.toBe('move');
    expect(state?.selectionCombineMode).toBe('add');
  });

  it('Alt inside the selection starts a subtract shape', () => {
    selectRect(0, 0, 50, 50);
    const state = marqueeStrategy.onDown(makeCtx({ canvasPos: { x: 10, y: 10 }, altKey: true }), 'marquee-rect');
    expect(state?.gesture.kind).not.toBe('move');
    expect(state?.selectionCombineMode).toBe('subtract');
  });

  it('a modifier with nothing selected just starts a new selection', () => {
    const state = marqueeStrategy.onDown(makeCtx({ shiftKey: true, altKey: true }), 'marquee-rect');
    expect(state?.selectionCombineMode).toBe('replace');
  });

  it('keeps the existing ants in the preview while combining', () => {
    marqueeStrategy.onMove!(makeState({ selectionCombineMode: 'add' }), { x: 30, y: 30 }, false);
    const preview = getMarqueePreview();
    if (!preview || preview.kind === 'move') throw new Error('expected a rect preview');
    expect(preview.isCombining).toBe(true);
  });

  it('Shift-drag adds the rect to the selection as one history step', () => {
    selectRect(0, 0, 10, 10);
    setMarqueePreview({ kind: 'rect', rect: { x: 50, y: 50, width: 20, height: 20 } });
    marqueeStrategy.onUp!(makeState({ startPoint: { x: 50, y: 50 }, selectionCombineMode: 'add' }), { x: 70, y: 70 }, makeUpCtx(70, 70));
    const { bounds, mask } = lastCommit();
    expect(mask[5 * DOC_W + 5]).toBe(255); // old selection kept
    expect(mask[60 * DOC_W + 60]).toBe(255); // new rect added
    expect(mask[30 * DOC_W + 30]).toBe(0); // gap between them stays out
    expect(bounds).toEqual({ x: 0, y: 0, width: 70, height: 70 });
    expect(editorState.pushHistoryMetadata).toHaveBeenCalledTimes(1);
    expect(editorState.pushHistoryMetadata).toHaveBeenCalledWith('Add to Selection');
  });

  it('Alt-drag cuts a hole in the selection', () => {
    selectRect(0, 0, 60, 60);
    setMarqueePreview({ kind: 'rect', rect: { x: 20, y: 20, width: 20, height: 20 } });
    marqueeStrategy.onUp!(makeState({ startPoint: { x: 20, y: 20 }, selectionCombineMode: 'subtract' }), { x: 40, y: 40 }, makeUpCtx(40, 40));
    const { bounds, mask } = lastCommit();
    expect(mask[30 * DOC_W + 30]).toBe(0); // hole
    expect(mask[10 * DOC_W + 10]).toBe(255); // ring kept
    expect(mask[50 * DOC_W + 50]).toBe(255);
    expect(bounds).toEqual({ x: 0, y: 0, width: 60, height: 60 });
    expect(editorState.pushHistoryMetadata).toHaveBeenCalledWith('Subtract from Selection');
  });

  it('Shift+Alt-drag keeps only the overlap', () => {
    selectRect(0, 0, 40, 40);
    setMarqueePreview({ kind: 'ellipse', rect: { x: 20, y: 20, width: 40, height: 40 } });
    marqueeStrategy.onUp!(
      makeState({ tool: 'marquee-ellipse', startPoint: { x: 20, y: 20 }, selectionCombineMode: 'intersect' }),
      { x: 60, y: 60 },
      makeUpCtx(60, 60),
    );
    const { bounds, mask } = lastCommit();
    expect(mask[35 * DOC_W + 35]).toBe(255); // in both
    expect(mask[5 * DOC_W + 5]).toBe(0); // rect only
    expect(mask[50 * DOC_W + 50]).toBe(0); // ellipse only
    expect(bounds.x).toBeGreaterThanOrEqual(20);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(40);
  });

  it('clears the selection when a subtract removes all of it', () => {
    selectRect(10, 10, 10, 10);
    setMarqueePreview({ kind: 'rect', rect: { x: 0, y: 0, width: 50, height: 50 } });
    marqueeStrategy.onUp!(makeState({ startPoint: { x: 0, y: 0 }, selectionCombineMode: 'subtract' }), { x: 50, y: 50 }, makeUpCtx(50, 50));
    expect(editorState.clearSelection).toHaveBeenCalledTimes(1);
    expect(editorState.setSelection).not.toHaveBeenCalled();
    expect(uiState.setTransform).toHaveBeenLastCalledWith(null);
  });

  it('a modifier-click keeps the selection and opens no dialog', () => {
    selectRect(10, 10, 10, 10);
    marqueeStrategy.onUp!(makeState({ startPoint: { x: 50, y: 50 }, selectionCombineMode: 'add' }), { x: 50, y: 50 }, makeUpCtx(50, 50));
    expect(editorState.clearSelection).not.toHaveBeenCalled();
    expect(editorState.setSelection).not.toHaveBeenCalled();
    expect(uiState.openModal).not.toHaveBeenCalled();
    expect(editorState.pushHistoryMetadata).not.toHaveBeenCalled();
  });

  it('a plain drag still replaces without a history step', () => {
    selectRect(0, 0, 10, 10);
    setMarqueePreview({ kind: 'rect', rect: { x: 50, y: 50, width: 20, height: 20 } });
    marqueeStrategy.onUp!(makeState({ startPoint: { x: 50, y: 50 }, selectionCombineMode: 'replace' }), { x: 70, y: 70 }, makeUpCtx(70, 70));
    const { mask } = lastCommit();
    expect(mask[5 * DOC_W + 5]).toBe(0);
    expect(editorState.pushHistoryMetadata).not.toHaveBeenCalled();
  });
});

describe('confirmMarqueeRegion', () => {
  function committed(): { rect: { x: number; y: number; width: number; height: number }; mask: Uint8ClampedArray } {
    const [rect, mask] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
    ];
    return { rect, mask };
  }

  it('commits a rect selection from typed corners, To exclusive', () => {
    confirmMarqueeRegion('rect', { x: 10, y: 20 }, { x: 40, y: 30 });
    const { rect, mask } = committed();
    expect(rect).toEqual({ x: 10, y: 20, width: 30, height: 10 });
    expect(mask[20 * DOC_W + 10]).toBe(255);
    expect(mask[29 * DOC_W + 39]).toBe(255);
    expect(mask[30 * DOC_W + 39]).toBe(0);
    expect(mask[29 * DOC_W + 40]).toBe(0);
    expect(uiState.setTransform).toHaveBeenCalledTimes(1);
  });

  it('commits an ellipse selection whose corners stay unselected', () => {
    confirmMarqueeRegion('ellipse', { x: 20, y: 20 }, { x: 60, y: 60 });
    const { rect, mask } = committed();
    expect(rect).toEqual({ x: 20, y: 20, width: 40, height: 40 });
    expect(mask[40 * DOC_W + 40]).toBe(255);
    expect(mask[20 * DOC_W + 20]).toBe(0);
  });

  it('accepts corners typed in reverse order', () => {
    confirmMarqueeRegion('rect', { x: 40, y: 30 }, { x: 10, y: 20 });
    expect(committed().rect).toEqual({ x: 10, y: 20, width: 30, height: 10 });
  });

  it('does nothing for a zero-area region', () => {
    confirmMarqueeRegion('rect', { x: 10, y: 10 }, { x: 10, y: 50 });
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });
});
