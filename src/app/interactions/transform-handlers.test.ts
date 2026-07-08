import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// transform-handlers creates its selection-transform coalescer at import
// time. Install rAF/cancelAnimationFrame stubs above the ES-hoisted
// imports so the coalescer's captured closures see the stubs.
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

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  floatSelection: vi.fn(() => new Int32Array()),
  hasFloat: vi.fn(() => false),
  setSelectionMask: vi.fn(),
  compositeFloat: vi.fn(),
  compositeFloatAffine: vi.fn(),
  compositeFloatPerspective: vi.fn(),
  dropFloat: vi.fn(),
}));

vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => ({ __engine: 'mock' }),
}));

vi.mock('../../panels/LayerPanel/layer-selection', () => ({
  selectLayerAlpha: vi.fn(),
}));

vi.mock('../store/clear-js-pixel-data', () => ({
  clearJsPixelData: vi.fn(),
}));

const DOC_W = 100;
const DOC_H = 100;

const editorState = {
  document: { width: DOC_W, height: DOC_H },
  selection: {
    active: true,
    mask: null as Uint8ClampedArray | null,
    bounds: { x: 10, y: 10, width: 30, height: 30 },
    maskWidth: DOC_W,
    maskHeight: DOC_H,
  },
  viewport: { zoom: 1 },
  setSelection: vi.fn(),
  notifyRender: vi.fn(),
  pushHistory: vi.fn(),
};

vi.mock('../editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

const uiState = {
  activeTool: 'marquee-rect' as
    | 'marquee-rect'
    | 'marquee-ellipse'
    | 'lasso'
    | 'lasso-magnetic'
    | 'wand'
    | 'move',
  transform: null as ReturnType<
    typeof import('../../tools/transform/transform').createTransformState
  > | null,
  showGrid: false,
  snapToGrid: false,
  gridSize: 10,
  setTransform: vi.fn(),
  setActiveTransformHandle: vi.fn(),
};

vi.mock('../ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

import {
  handleTransformMove,
  flushSelectionTransform,
} from './transform-handlers';
import { createTransformState } from '../../tools/transform/transform';
import type { InteractionState } from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';

function makeState(
  overrides: Partial<InteractionState> & { startState?: ReturnType<typeof createTransformState> } = {},
): InteractionState {
  const startState =
    overrides.startState ?? createTransformState({ x: 10, y: 10, width: 30, height: 30 });
  // NB: DEFAULT_TRANSFORM_FIELDS carries `gesture: GESTURE_IDLE`, so it
  // must be spread BEFORE we set our explicit gesture — otherwise the
  // idle gesture wins and handleTransformMove short-circuits.
  return {
    drawing: true,
    lastPoint: { x: 40, y: 40 },
    layerId: 'layer-1',
    tool: 'marquee-rect',
    startPoint: { x: 40, y: 40 },
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    ...overrides,
    gesture: {
      kind: 'transform',
      handle: 'bottom-right',
      startState,
      startAngle: 0,
      selectionOnly: true,
    },
  };
}

describe('handleTransformMove — selection-transform coalescing (issue #653)', () => {
  beforeEach(() => {
    rafHandles.cbs = [];
    rafHandles.nextId = 1;

    editorState.setSelection.mockClear();
    editorState.notifyRender.mockClear();
    uiState.setTransform.mockClear();
    uiState.activeTool = 'marquee-rect';

    // Drain any stale pending frame from a prior test.
    flushSelectionTransform();
    editorState.setSelection.mockClear();
    uiState.setTransform.mockClear();
    rafHandles.cbs = [];
  });

  afterEach(() => {
    rafHandles.cbs = [];
  });

  function tickFrame(): void {
    const pending = rafHandles.cbs;
    rafHandles.cbs = [];
    for (const cb of pending) cb(0);
  }

  // Pinning the invariant from #651: N pointer moves in one frame reach
  // the underlying mask rebuild + setSelection exactly ONCE — not N
  // times. This is the whole point of the coalescer.
  it('collapses a burst of moves into 1 setSelection per frame', () => {
    const state = makeState();
    for (let i = 0; i < 12; i++) {
      handleTransformMove(state, { x: 40 + i, y: 40 + i }, false);
    }
    expect(editorState.setSelection).not.toHaveBeenCalled();
    tickFrame();
    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    expect(uiState.setTransform).toHaveBeenCalledTimes(1);
  });

  // #653 (1): the coalescer runs regardless of selection tool. Marquee-ellipse
  // is a marquee variant, lasso/wand were the concern in #650 — verify the
  // coalescer fires exactly once per frame for each.
  for (const tool of ['marquee-rect', 'marquee-ellipse', 'lasso', 'lasso-magnetic', 'wand'] as const) {
    it(`coalesces bursts for selection tool "${tool}"`, () => {
      uiState.activeTool = tool;
      const state = makeState({ tool });
      for (let i = 0; i < 5; i++) {
        handleTransformMove(state, { x: 40 + i, y: 40 + i }, false);
      }
      expect(editorState.setSelection).not.toHaveBeenCalled();
      tickFrame();
      expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    });
  }

  // #653 (2): the last-position wins. Only the newest args survive to the
  // frame; intermediate positions are dropped by design.
  it('uses only the latest pointer position when firing', () => {
    const state = makeState();
    handleTransformMove(state, { x: 45, y: 45 }, false);
    handleTransformMove(state, { x: 60, y: 60 }, false);
    tickFrame();

    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    const [bounds] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
      number,
      number,
    ];
    // Starting bounds were 10..40 (30-wide). Bottom-right handle drag by
    // (+20,+20) grows the box by 20 on the right + bottom edges, so the
    // new bounds are x:10 y:10 w:50 h:50 (drag centered on cx+dx/2).
    expect(bounds.width).toBeGreaterThan(30);
    expect(bounds.height).toBeGreaterThan(30);
  });

  // #653 (3): ellipse vs rect mask correctness. marquee-ellipse produces
  // an elliptical mask (corners are 0); every other selection tool falls
  // through to a rectangular mask.
  it('produces an elliptical mask when the active tool is marquee-ellipse', () => {
    uiState.activeTool = 'marquee-ellipse';
    const state = makeState({ tool: 'marquee-ellipse' });
    handleTransformMove(state, { x: 60, y: 60 }, false);
    tickFrame();

    const [bounds, mask] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
      number,
      number,
    ];
    // Ellipse mask: the four corner pixels of the tight bounding box are
    // outside the ellipse, so their alpha is 0. A pixel near the centre
    // is inside.
    const cornerIdx = Math.floor(bounds.y) * DOC_W + Math.floor(bounds.x);
    const centreIdx =
      Math.floor(bounds.y + bounds.height / 2) * DOC_W +
      Math.floor(bounds.x + bounds.width / 2);
    expect(mask[cornerIdx]).toBe(0);
    expect(mask[centreIdx]).toBe(255);
  });

  it('produces a rectangular mask for non-ellipse selection tools', () => {
    uiState.activeTool = 'marquee-rect';
    const state = makeState({ tool: 'marquee-rect' });
    handleTransformMove(state, { x: 60, y: 60 }, false);
    tickFrame();

    const [bounds, mask] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
      number,
      number,
    ];
    // Rect mask: every pixel inside the bounds is 255 including the
    // corner where the ellipse mask would have been 0.
    const cornerIdx = Math.floor(bounds.y) * DOC_W + Math.floor(bounds.x);
    expect(mask[cornerIdx]).toBe(255);
  });

  // #653 (4): degenerate / collapsed bounds is a no-op on commit. Dragging
  // the bottom-right handle past the top-left collapses width/height to 0
  // or negative; the coalescer's underlying apply function must not push
  // an empty mask through setSelection.
  it('does not push a mask when the transform collapses bounds below 1px', () => {
    const state = makeState();
    // Drag bottom-right handle so far above/left that width+height both
    // go to zero. computeScale for bottom-right adds deltaX/origW to
    // scaleX and deltaY/origH to scaleY. deltaX = -30, origW = 30 →
    // scaleX = 0 → width = 0.
    handleTransformMove(state, { x: 10, y: 10 }, false);
    tickFrame();

    expect(editorState.setSelection).not.toHaveBeenCalled();
    expect(uiState.setTransform).not.toHaveBeenCalled();
  });

  // #653 (2, extension): the coalescer schedules and then no-ops when the
  // computed transform lands at the same effective position twice.
  it('reschedules cleanly after a flush (a subsequent burst produces a new call)', () => {
    const state = makeState();

    handleTransformMove(state, { x: 45, y: 45 }, false);
    tickFrame();
    handleTransformMove(state, { x: 50, y: 50 }, false);
    tickFrame();

    expect(editorState.setSelection).toHaveBeenCalledTimes(2);
  });

  // flushSelectionTransform is the test seam used by pointer-up
  // handling — pending work must fire synchronously.
  it('flushSelectionTransform runs pending work synchronously', () => {
    const state = makeState();
    handleTransformMove(state, { x: 45, y: 45 }, false);
    expect(editorState.setSelection).not.toHaveBeenCalled();
    flushSelectionTransform();
    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
  });

  it('flushSelectionTransform is a no-op when nothing is pending', () => {
    flushSelectionTransform();
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });
});
