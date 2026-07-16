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
};
vi.mock('../../app/editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

const uiState = {
  setTransform: vi.fn(),
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

import { marqueeStrategy } from './marquee-strategy';
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
  uiState.setTransform.mockClear();
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
  it('treats a sub-2px gesture as a click and clears the selection', () => {
    marqueeStrategy.onUp!(makeState({ startPoint: { x: 10, y: 10 } }), { x: 11, y: 11 }, makeUpCtx(11, 11));
    expect(editorState.clearSelection).toHaveBeenCalledTimes(1);
    expect(uiState.setTransform).toHaveBeenCalledWith(null);
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
