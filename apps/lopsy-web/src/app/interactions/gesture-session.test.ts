import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { InteractionContext, InteractionState, PersistentTransform, ToolHandler } from './interaction-types';
import type { Point, ToolId } from '../../types';

const h = vi.hoisted(() => {
  const unregisterFloat = vi.fn();
  return {
    engine: { current: { __engine: 'mock' } as { __engine: string } | null },
    beginStroke: vi.fn(),
    endStroke: vi.fn(),
    hasFloat: vi.fn(() => false),
    dropFloat: vi.fn(),
    uploadLayerPixels: vi.fn(),
    restoreFromGpuSnapshot: vi.fn(),
    flushLayerSync: vi.fn(),
    resetTrackedState: vi.fn(),
    syncDocumentSize: vi.fn(),
    syncSelection: vi.fn(),
    smoothStroke: vi.fn((points: ReadonlyArray<{ x: number; y: number }>) => ({ sampledPoints: points })),
    brushDabBatchSymmetric: vi.fn(),
    forgetLayerAlphaSelection: vi.fn(),
    clearJsPixelData: vi.fn(),
    deferCacheLayerSnapshot: vi.fn(),
    scheduleMaskDataRefresh: vi.fn(),
    syncLayerAfterFullSize: vi.fn((): unknown => null),
    handleTransformDown: vi.fn((): unknown => null),
    commitSelectionTransform: vi.fn(),
    refuseGroupSelectionTransform: vi.fn(() => false),
    handleTransformMove: vi.fn(),
    commitLayerTransform: vi.fn(),
    markLayerTransformDirty: vi.fn(),
    handleMeshWarpDown: vi.fn((): unknown => null),
    handleMeshWarpMove: vi.fn(),
    handleMeshWarpUp: vi.fn(),
    handleTiltShiftDown: vi.fn((): unknown => null),
    handleTiltShiftMove: vi.fn(),
    handleTiltShiftUp: vi.fn(),
    handleLiquifyDown: vi.fn((): unknown => null),
    handleLiquifyMove: vi.fn((state: unknown) => state),
    handleNudgeMove: vi.fn(),
    commitLiveFloat: vi.fn(),
    flushNudgeMask: vi.fn(),
    unregisterFloat,
    registerFloatSession: vi.fn(() => unregisterFloat),
    nudgeHeldSelection: vi.fn(),
    toolHandlers: {} as Record<string, unknown>,
    finishTextBodyMove: vi.fn(),
    handleTextTransformDown: vi.fn((): unknown => null),
    handleTextTransformMove: vi.fn(),
    handleTextTransformUp: vi.fn(),
    refusePartialTextMove: vi.fn(() => false),
    releaseCoveringTextSelection: vi.fn(),
    refuseMaskEditSelectionMove: vi.fn(() => false),
    announceRefusal: vi.fn(),
    pixelDataGet: vi.fn((): unknown => undefined),
    destroyPaintingCanvas: vi.fn(),
  };
});

vi.mock('../../engine-wasm/engine-state', () => ({ getEngine: () => h.engine.current }));
vi.mock('../../engine-wasm/wasm-bridge', () => ({
  beginStroke: h.beginStroke,
  endStroke: h.endStroke,
  hasFloat: h.hasFloat,
  dropFloat: h.dropFloat,
  uploadLayerPixels: h.uploadLayerPixels,
  restoreFromGpuSnapshot: h.restoreFromGpuSnapshot,
}));
vi.mock('../../engine-wasm/engine-sync', () => ({
  flushLayerSync: h.flushLayerSync,
  resetTrackedState: h.resetTrackedState,
  syncDocumentSize: h.syncDocumentSize,
  syncSelection: h.syncSelection,
}));
vi.mock('../../tools/smooth-line/smooth-line', () => ({ smoothStroke: h.smoothStroke, HOLD_TIMEOUT_MS: 1500 }));
vi.mock('./symmetric-dabs', () => ({ brushDabBatchSymmetric: h.brushDabBatchSymmetric }));
vi.mock('./layer-alpha-selection', () => ({ forgetLayerAlphaSelection: h.forgetLayerAlphaSelection }));
vi.mock('../store/clear-js-pixel-data', () => ({ clearJsPixelData: h.clearJsPixelData }));
vi.mock('../store/history-slice', () => ({ deferCacheLayerSnapshot: h.deferCacheLayerSnapshot }));
vi.mock('../mask-data-sync', () => ({ scheduleMaskDataRefresh: h.scheduleMaskDataRefresh }));
vi.mock('../sync-layer-after-full-size', () => ({ syncLayerAfterFullSize: h.syncLayerAfterFullSize }));
vi.mock('./transform-handlers', () => ({
  handleTransformDown: h.handleTransformDown,
  commitSelectionTransform: h.commitSelectionTransform,
  refuseGroupSelectionTransform: h.refuseGroupSelectionTransform,
}));
vi.mock('./layer-transform', () => ({
  commitLayerTransform: h.commitLayerTransform,
  markLayerTransformDirty: h.markLayerTransformDirty,
}));
vi.mock('./mesh-warp-handlers', () => ({
  handleMeshWarpDown: h.handleMeshWarpDown,
  handleMeshWarpMove: h.handleMeshWarpMove,
  handleMeshWarpUp: h.handleMeshWarpUp,
}));
vi.mock('./tilt-shift-handlers', () => ({
  handleTiltShiftDown: h.handleTiltShiftDown,
  handleTiltShiftMove: h.handleTiltShiftMove,
  handleTiltShiftUp: h.handleTiltShiftUp,
}));
vi.mock('./liquify-handlers', () => ({
  handleLiquifyDown: h.handleLiquifyDown,
  handleLiquifyMove: h.handleLiquifyMove,
}));
vi.mock('./move-handlers', () => ({ handleNudgeMove: h.handleNudgeMove }));
vi.mock('./live-float', () => ({
  commitLiveFloat: h.commitLiveFloat,
  flushNudgeMask: h.flushNudgeMask,
  registerFloatSession: h.registerFloatSession,
}));
vi.mock('./selection-nudge', () => ({ nudgeHeldSelection: h.nudgeHeldSelection }));
vi.mock('./tool-router', () => ({ toolHandlers: h.toolHandlers, handleTransformMove: h.handleTransformMove }));
vi.mock('./text-transform-handlers', () => ({
  finishTextBodyMove: h.finishTextBodyMove,
  handleTextTransformDown: h.handleTextTransformDown,
  handleTextTransformMove: h.handleTextTransformMove,
  handleTextTransformUp: h.handleTextTransformUp,
  refusePartialTextMove: h.refusePartialTextMove,
  releaseCoveringTextSelection: h.releaseCoveringTextSelection,
}));
vi.mock('./mask-edit-move-guard', () => ({ refuseMaskEditSelectionMove: h.refuseMaskEditSelectionMove }));
vi.mock('../../commands/refusal', () => ({ announceRefusal: h.announceRefusal }));
vi.mock('../../engine/pixel-data-manager', () => ({ pixelDataManager: { get: h.pixelDataGet } }));
vi.mock('../../engine/bitmap-cache', () => ({ destroyPaintingCanvas: h.destroyPaintingCanvas }));
vi.mock('../../tools/tool-registry', () => {
  const paint = ['brush', 'pencil', 'eraser', 'spray', 'dodge'];
  return {
    toolRegistry: Object.fromEntries(paint.map((id) => [id, { isPaint: true }])),
    PAINT_TOOLS: new Set(paint),
    GPU_TOOLS: new Set(paint),
    SELF_HISTORY_PAINT_TOOLS: new Set(['dodge']),
  };
});

interface TestLayer {
  id: string;
  type: 'raster' | 'group' | 'text';
  x: number;
  y: number;
  locked: boolean;
}

const editorState = {
  document: { activeLayerId: 'layer-1' as string | null, layers: [] as TestLayer[], width: 200, height: 100 },
  selection: { active: false },
  undoStack: [] as unknown[],
  pushHistory: vi.fn(),
  notifyRender: vi.fn(),
  updateLayerPixelData: vi.fn(),
};
vi.mock('../editor-store', () => ({ useEditorStore: { getState: () => editorState } }));

const uiState = {
  activeTool: 'brush' as ToolId,
  maskMode: 'off' as 'off' | 'layerMask' | 'quickMask',
  setIsStroking: vi.fn(),
  setLastPaintPoint: vi.fn(),
  setActiveTransformHandle: vi.fn(),
  setGradientPreview: vi.fn(),
};
vi.mock('../ui-store', () => ({ useUIStore: { getState: () => uiState } }));

const ts = {
  settings: {
    shape: { output: 'pixels' },
    brush: { size: 10, hardness: 100, opacity: 100, spacing: 25 },
  },
  foregroundColor: { r: 255, g: 0, b: 0, a: 1 },
  symmetryRadialSegments: 0,
  symmetryHorizontal: false,
  symmetryVertical: false,
  setSymmetryCenter: vi.fn(),
};
vi.mock('../tool-settings-store', () => ({ useToolSettingsStore: { getState: () => ts } }));

import { INITIAL_INTERACTION_STATE } from './interaction-types';
import {
  attachGestureSession,
  clearPersistentTransform,
  gestureDown,
  gestureMove,
  gestureUp,
  nudgeMove,
  nudgeSelection,
  resetGestureSessionForTest,
} from './gesture-session';
import type { GestureEnvironment, ToolEvent } from './gesture-session';

type DownFn = NonNullable<ToolHandler['down']>;
type MoveFn = NonNullable<ToolHandler['move']>;
type UpFn = NonNullable<ToolHandler['up']>;

const TOOLS: readonly ToolId[] = ['brush', 'pencil', 'eraser', 'spray', 'dodge', 'move', 'marquee-rect', 'gradient'];
const LAYER: TestLayer = { id: 'layer-1', type: 'raster', x: 10, y: 20, locked: false };
const HOLD_STROKE: Point[] = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];

function drawingState(tool: ToolId, extra: Partial<InteractionState> = {}): InteractionState {
  return {
    ...INITIAL_INTERACTION_STATE,
    drawing: true,
    tool,
    layerId: 'layer-1',
    layerStartX: 10,
    layerStartY: 20,
    ...extra,
  };
}

function makeHandler(tool: ToolId) {
  return {
    down: vi.fn<DownFn>(() => drawingState(tool)),
    move: vi.fn<MoveFn>(),
    up: vi.fn<UpFn>(),
  };
}

let handlers: Record<string, ReturnType<typeof makeHandler>> = {};

function handler(tool: ToolId): ReturnType<typeof makeHandler> {
  const found = handlers[tool];
  if (!found) throw new Error(`no handler for ${tool}`);
  return found;
}

function ev(clientX: number, clientY: number, over: Partial<ToolEvent> = {}): ToolEvent {
  return { clientX, clientY, button: 0, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, ...over };
}

const env = {
  toCanvas: vi.fn((x: number, y: number): Point | null => ({ x, y })),
  toPixel: vi.fn((x: number, y: number): Point | undefined => ({ x: Math.floor(x), y: Math.floor(y) })),
} satisfies GestureEnvironment;

let frames: Array<FrameRequestCallback | null> = [];

function runFrames(): void {
  const pending = frames;
  frames = [];
  for (const cb of pending) cb?.(0);
}

function firstCall(fn: { mock: { invocationCallOrder: number[] } }, index = 0): number {
  const order = fn.mock.invocationCallOrder[index];
  if (order === undefined) throw new Error('expected the mock to have been called');
  return order;
}

function expectInOrder(...orders: number[]): void {
  for (let i = 1; i < orders.length; i++) {
    expect(orders[i]).toBeGreaterThan(orders[i - 1]!);
  }
}

function downCtx(tool: ToolId, index = 0): InteractionContext {
  const call = handler(tool).down.mock.calls[index];
  if (!call) throw new Error(`${tool}.down was not called`);
  return call[0];
}

/** Starts a marquee drag to read the session's boxes off the context. */
function sessionBoxes(): InteractionContext {
  uiState.activeTool = 'marquee-rect';
  gestureDown(ev(1, 1), env);
  const ctx = downCtx('marquee-rect');
  gestureUp(ev(1, 1), env);
  return ctx;
}

/** Puts the session into `state` through the first pre-tool guard. */
function enterState(state: InteractionState): void {
  h.handleLiquifyDown.mockReturnValueOnce(state);
  gestureDown(ev(50, 60), env);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames[id - 1] = null;
  });

  h.engine.current = { __engine: 'mock' };
  for (const key of Object.keys(h.toolHandlers)) delete h.toolHandlers[key];
  handlers = {};
  for (const tool of TOOLS) {
    handlers[tool] = makeHandler(tool);
    h.toolHandlers[tool] = handlers[tool];
  }

  editorState.document = { activeLayerId: 'layer-1', layers: [{ ...LAYER }], width: 200, height: 100 };
  editorState.undoStack = [];
  uiState.activeTool = 'brush';
  uiState.maskMode = 'off';
  ts.symmetryRadialSegments = 0;
  ts.symmetryHorizontal = false;
  ts.symmetryVertical = false;

  resetGestureSessionForTest();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a brush stroke on a raster layer', () => {
  it('pushes one Brush history entry after the engine sync and before beginStroke', () => {
    gestureDown(ev(50, 60), env);

    expect(editorState.pushHistory).toHaveBeenCalledTimes(1);
    expect(editorState.pushHistory).toHaveBeenCalledWith('Brush');
    expect(h.syncDocumentSize).toHaveBeenCalledWith(h.engine.current, 200, 100);
    expect(h.beginStroke).toHaveBeenCalledWith(h.engine.current, 'layer-1');
    expectInOrder(
      firstCall(h.flushNudgeMask),
      firstCall(h.syncDocumentSize),
      firstCall(h.flushLayerSync),
      firstCall(h.syncSelection),
      firstCall(editorState.pushHistory),
      firstCall(h.beginStroke),
      firstCall(h.syncLayerAfterFullSize),
      firstCall(handler('brush').down),
    );
  });

  it('hands the tool a stroke-continuation context in document and layer space', () => {
    gestureDown(ev(50, 60, { detail: 1 }), env);

    const ctx = downCtx('brush');
    expect(ctx.isStrokeContinuation).toBe(true);
    expect(ctx.canvasPos).toEqual({ x: 50, y: 60 });
    expect(ctx.layerPos).toEqual({ x: 40, y: 40 });
    expect(ctx.pixelPos).toEqual({ x: 50, y: 60 });
    expect(ctx.clickDetail).toBe(1);
    expect(ctx.activeLayerId).toBe('layer-1');
  });

  it('measures layer space from the layer beginStroke expanded', () => {
    h.syncLayerAfterFullSize.mockReturnValueOnce({ ...LAYER, x: -30, y: -40 });

    gestureDown(ev(50, 60), env);

    expect(downCtx('brush').layerPos).toEqual({ x: 80, y: 100 });
  });

  it('dispatches moves to the tool in layer space measured from the stroke start', () => {
    gestureDown(ev(50, 60), env);
    gestureMove(ev(70, 90), env);

    const [ctx, state] = handler('brush').move.mock.calls[0]!;
    expect(ctx.canvasPos).toEqual({ x: 70, y: 90 });
    expect(ctx.layerPos).toEqual({ x: 60, y: 70 });
    expect(state.gesture).toEqual({ kind: 'paint', usedGpuStroke: true });
  });

  it('finishes the GPU stroke on up and keeps the last paint point', () => {
    handler('brush').down.mockImplementationOnce(() => drawingState('brush', { lastPoint: { x: 5, y: 6 } }));
    gestureDown(ev(50, 60), env);
    const ctx = downCtx('brush');
    gestureUp(ev(52, 62), env);

    expect(handler('brush').up).toHaveBeenCalledTimes(1);
    expect(uiState.setIsStroking).toHaveBeenCalledWith(false);
    expect(h.endStroke).toHaveBeenCalledWith(h.engine.current, 'layer-1');
    expect(h.clearJsPixelData).toHaveBeenCalledWith('layer-1');
    expect(h.deferCacheLayerSnapshot).toHaveBeenCalledWith('layer-1');
    expectInOrder(
      firstCall(handler('brush').up),
      firstCall(h.endStroke),
      firstCall(h.clearJsPixelData),
      firstCall(editorState.notifyRender),
      firstCall(h.deferCacheLayerSnapshot),
    );
    expect(ctx.lastPaintPointRef.current).toEqual({ point: { x: 5, y: 6 }, layerId: 'layer-1' });
    expect(uiState.setLastPaintPoint).toHaveBeenCalledWith({ point: { x: 5, y: 6 }, layerId: 'layer-1' });
    expect(ctx.stateRef.current).toEqual(INITIAL_INTERACTION_STATE);
  });

  it.each([
    ['pencil', 'Pencil'],
    ['eraser', 'Eraser'],
    ['spray', 'Spray'],
  ] as const)('labels the %s history entry %s', (tool, label) => {
    uiState.activeTool = tool;
    gestureDown(ev(50, 60), env);

    expect(editorState.pushHistory).toHaveBeenCalledTimes(1);
    expect(editorState.pushHistory).toHaveBeenCalledWith(label);
  });

  it('leaves history to a tool that pushes its own entry', () => {
    uiState.activeTool = 'dodge';
    gestureDown(ev(50, 60), env);

    expect(editorState.pushHistory).not.toHaveBeenCalled();
    expect(h.beginStroke).toHaveBeenCalledTimes(1);
    expect(handler('dodge').down).toHaveBeenCalledTimes(1);
  });
});

describe('gestureDown refusals', () => {
  it('ignores any button but the primary', () => {
    gestureDown(ev(50, 60, { button: 2 }), env);

    expect(h.flushNudgeMask).not.toHaveBeenCalled();
    expect(handler('brush').down).not.toHaveBeenCalled();
  });

  it('does nothing without an active layer', () => {
    editorState.document.activeLayerId = null;
    gestureDown(ev(50, 60), env);

    expect(env.toCanvas).not.toHaveBeenCalled();
    expect(handler('brush').down).not.toHaveBeenCalled();
  });

  it('does nothing when the active layer id names no layer', () => {
    editorState.document.activeLayerId = 'missing';
    gestureDown(ev(50, 60), env);

    expect(env.toCanvas).not.toHaveBeenCalled();
    expect(handler('brush').down).not.toHaveBeenCalled();
  });

  it('refuses a locked layer', () => {
    editorState.document.layers = [{ ...LAYER, locked: true }];
    gestureDown(ev(50, 60), env);

    expect(env.toCanvas).not.toHaveBeenCalled();
    expect(editorState.pushHistory).not.toHaveBeenCalled();
    expect(handler('brush').down).not.toHaveBeenCalled();
  });

  it('lets a lock-exempt tool run on a locked layer', () => {
    editorState.document.layers = [{ ...LAYER, locked: true }];
    uiState.activeTool = 'marquee-rect';
    gestureDown(ev(50, 60), env);

    expect(handler('marquee-rect').down).toHaveBeenCalledTimes(1);
  });

  it.each(['group', 'text'] as const)('refuses a raster write on a %s layer with a toast', (type) => {
    editorState.document.layers = [{ ...LAYER, type }];
    gestureDown(ev(50, 60), env);

    expect(h.announceRefusal).toHaveBeenCalledTimes(1);
    expect(env.toCanvas).not.toHaveBeenCalled();
    expect(h.handleLiquifyDown).not.toHaveBeenCalled();
    expect(editorState.pushHistory).not.toHaveBeenCalled();
    expect(h.beginStroke).not.toHaveBeenCalled();
    expect(handler('brush').down).not.toHaveBeenCalled();
  });

  it('stops after the write guard when there is no canvas to measure against', () => {
    env.toCanvas.mockReturnValueOnce(null);
    gestureDown(ev(50, 60), env);

    expect(env.toCanvas).toHaveBeenCalledWith(50, 60);
    expect(ts.setSymmetryCenter).not.toHaveBeenCalled();
    expect(h.handleLiquifyDown).not.toHaveBeenCalled();
    expect(h.syncDocumentSize).not.toHaveBeenCalled();
    expect(handler('brush').down).not.toHaveBeenCalled();
  });
});

describe('gestureDown pre-tool steps', () => {
  it.each([{ metaKey: true }, { ctrlKey: true }])('sets the symmetry centre on %o with symmetry on', (mods) => {
    ts.symmetryHorizontal = true;
    gestureDown(ev(50, 60, mods), env);

    expect(ts.setSymmetryCenter).toHaveBeenCalledWith({ x: 50, y: 60 });
    expect(h.handleLiquifyDown).not.toHaveBeenCalled();
    expect(editorState.pushHistory).not.toHaveBeenCalled();
    expect(handler('brush').down).not.toHaveBeenCalled();
  });

  it('dispatches a Cmd press normally when symmetry is off', () => {
    gestureDown(ev(50, 60, { metaKey: true }), env);

    expect(ts.setSymmetryCenter).not.toHaveBeenCalled();
    expect(handler('brush').down).toHaveBeenCalledTimes(1);
  });

  it('stops at the first pre-tool guard that claims the gesture', () => {
    h.handleTiltShiftDown.mockReturnValueOnce(drawingState('brush', { gesture: { kind: 'tiltShift' } }));
    gestureDown(ev(50, 60), env);

    expect(h.handleLiquifyDown).toHaveBeenCalledWith({ x: 50, y: 60 }, 'layer-1');
    expect(h.handleTiltShiftDown).toHaveBeenCalledWith({ x: 50, y: 60 }, 'layer-1');
    expect(h.handleMeshWarpDown).not.toHaveBeenCalled();
    expect(h.beginStroke).not.toHaveBeenCalled();
    expect(handler('brush').down).not.toHaveBeenCalled();

    gestureMove(ev(55, 65, { metaKey: true }), env);
    expect(h.handleTiltShiftMove).toHaveBeenCalledWith({ x: 55, y: 65 }, true);
  });

  it('commits a live float and re-syncs the layer before a non-Move tool runs', () => {
    h.hasFloat.mockReturnValue(true);
    h.syncLayerAfterFullSize.mockReturnValueOnce({ ...LAYER, x: -5, y: -5 });
    uiState.activeTool = 'marquee-rect';
    gestureDown(ev(50, 60), env);

    expectInOrder(
      firstCall(h.handleTransformDown),
      firstCall(h.commitLiveFloat),
      firstCall(h.syncLayerAfterFullSize),
      firstCall(handler('marquee-rect').down),
    );
    const ctx = downCtx('marquee-rect');
    expect(ctx.layerPos).toEqual({ x: 55, y: 65 });
    expect(ctx.activeLayer).toEqual({ ...LAYER, x: -5, y: -5 });
  });

  it('leaves a live float to the Move tool', () => {
    h.hasFloat.mockReturnValue(true);
    uiState.activeTool = 'move';
    gestureDown(ev(50, 60), env);

    expect(h.commitLiveFloat).not.toHaveBeenCalled();
    expect(handler('move').down).toHaveBeenCalledTimes(1);
  });

  it('forgets the layer-alpha selection before a raster-writing tool', () => {
    uiState.activeTool = 'gradient';
    gestureDown(ev(50, 60), env);

    expect(h.forgetLayerAlphaSelection).toHaveBeenCalledTimes(1);
    expectInOrder(firstCall(h.forgetLayerAlphaSelection), firstCall(handler('gradient').down));
  });

  it('runs the Move-tool steps in order before the transform handles', () => {
    uiState.activeTool = 'move';
    gestureDown(ev(50, 60), env);

    expectInOrder(
      firstCall(h.handleTextTransformDown),
      firstCall(h.refusePartialTextMove),
      firstCall(h.refuseMaskEditSelectionMove),
      firstCall(h.refuseGroupSelectionTransform),
      firstCall(h.releaseCoveringTextSelection),
      firstCall(h.handleTransformDown),
      firstCall(handler('move').down),
    );
  });

  it('skips the Move-tool steps for other tools', () => {
    uiState.activeTool = 'marquee-rect';
    gestureDown(ev(50, 60), env);

    expect(h.handleTextTransformDown).not.toHaveBeenCalled();
    expect(h.releaseCoveringTextSelection).not.toHaveBeenCalled();
    expect(h.handleTransformDown).toHaveBeenCalledTimes(1);
  });

  it('lets a text-transform handle claim a Move press', () => {
    uiState.activeTool = 'move';
    h.handleTextTransformDown.mockReturnValueOnce(drawingState('move'));
    gestureDown(ev(50, 60), env);

    expect(h.refusePartialTextMove).not.toHaveBeenCalled();
    expect(h.handleTransformDown).not.toHaveBeenCalled();
    expect(handler('move').down).not.toHaveBeenCalled();
  });

  it.each([
    ['refusePartialTextMove', h.refusePartialTextMove],
    ['refuseMaskEditSelectionMove', h.refuseMaskEditSelectionMove],
    ['refuseGroupSelectionTransform', h.refuseGroupSelectionTransform],
  ] as const)('stops a Move press that %s refuses', (_name, refusal) => {
    uiState.activeTool = 'move';
    refusal.mockReturnValueOnce(true);
    gestureDown(ev(50, 60), env);

    expect(h.releaseCoveringTextSelection).not.toHaveBeenCalled();
    expect(h.handleTransformDown).not.toHaveBeenCalled();
    expect(handler('move').down).not.toHaveBeenCalled();
  });

  it('lets a transform handle claim the press before the tool', () => {
    uiState.activeTool = 'marquee-rect';
    h.handleTransformDown.mockReturnValueOnce(drawingState('marquee-rect'));
    gestureDown(ev(50, 60), env);

    expect(h.commitLiveFloat).not.toHaveBeenCalled();
    expect(handler('marquee-rect').down).not.toHaveBeenCalled();
  });
});

describe('gestureMove', () => {
  it('does nothing while not drawing', () => {
    gestureMove(ev(50, 60), env);

    expect(env.toCanvas).not.toHaveBeenCalled();
    expect(handler('brush').move).not.toHaveBeenCalled();
  });

  it('routes a liquify drag with the layer-space point', () => {
    const state = drawingState('brush', { gesture: { kind: 'liquify', lastPoint: { x: 0, y: 0 } } });
    enterState(state);
    gestureMove(ev(70, 90), env);

    expect(h.handleLiquifyMove).toHaveBeenCalledWith(state, { x: 60, y: 70 });
    expect(handler('brush').move).not.toHaveBeenCalled();
  });

  it('routes a mesh-warp drag', () => {
    enterState(drawingState('brush', { gesture: { kind: 'meshWarp' } }));
    gestureMove(ev(70, 90), env);

    expect(h.handleMeshWarpMove).toHaveBeenCalledWith({ x: 70, y: 90 });
    expect(handler('brush').move).not.toHaveBeenCalled();
  });

  it.each([
    ['transform', h.handleTransformMove],
    ['textTransform', h.handleTextTransformMove],
  ] as const)('routes a %s drag with Ctrl as the snap modifier', (kind, routed) => {
    const gesture = { kind } as unknown as InteractionState['gesture'];
    const state = drawingState('move', { gesture });
    enterState(state);
    gestureMove(ev(70, 90, { ctrlKey: true }), env);

    expect(routed).toHaveBeenCalledWith(state, { x: 70, y: 90 }, true);
    expect(handler('move').move).not.toHaveBeenCalled();
  });

  it('stops when there is no canvas to measure against', () => {
    gestureDown(ev(50, 60), env);
    env.toCanvas.mockReturnValueOnce(null);
    gestureMove(ev(70, 90), env);

    expect(handler('brush').move).not.toHaveBeenCalled();
  });
});

describe('gestureUp', () => {
  it.each([
    ['tiltShift', { kind: 'tiltShift' }, h.handleTiltShiftUp],
    ['meshWarp', { kind: 'meshWarp' }, h.handleMeshWarpUp],
    ['liquify', { kind: 'liquify', lastPoint: { x: 0, y: 0 } }, null],
    ['textTransform', { kind: 'textTransform' }, h.handleTextTransformUp],
    ['selection transform', { kind: 'transform', selectionOnly: true, isLayerTransform: false }, h.commitSelectionTransform],
    ['layer transform', { kind: 'transform', selectionOnly: false, isLayerTransform: true }, h.markLayerTransformDirty],
  ] as const)('ends a %s gesture without the tool up', (_name, gesture, finisher) => {
    enterState(drawingState('brush', { gesture: gesture as unknown as InteractionState['gesture'] }));
    env.toCanvas.mockClear();
    gestureUp(ev(70, 90), env);

    if (finisher) expect(finisher).toHaveBeenCalledTimes(1);
    expect(handler('brush').up).not.toHaveBeenCalled();
    expect(h.endStroke).not.toHaveBeenCalled();
    gestureMove(ev(80, 90), env);
    expect(env.toCanvas).not.toHaveBeenCalled();
  });

  it('clears the transform handle on a selection or layer transform', () => {
    enterState(drawingState('move', {
      gesture: { kind: 'transform', selectionOnly: true, isLayerTransform: false } as unknown as InteractionState['gesture'],
    }));
    gestureUp(ev(70, 90), env);

    expect(uiState.setActiveTransformHandle).toHaveBeenCalledWith(null);
  });

  it('falls back to the origin with no pixel when there is no canvas to measure against', () => {
    uiState.activeTool = 'marquee-rect';
    gestureDown(ev(50, 60), env);
    const noRect = {
      toCanvas: vi.fn((): Point | null => null),
      toPixel: vi.fn((): Point | undefined => undefined),
    } satisfies GestureEnvironment;
    gestureUp(ev(70, 90), noRect);

    const [ctx] = handler('marquee-rect').up.mock.calls[0]!;
    expect(ctx.canvasPos).toEqual({ x: 0, y: 0 });
    expect(ctx.layerPos).toEqual({ x: -10, y: -20 });
    expect(ctx.pixelPos).toBeUndefined();
  });

  it('takes the CPU path when the stroke did not use the GPU', () => {
    h.engine.current = null;
    const layerData = { width: 1, height: 1 };
    h.pixelDataGet.mockReturnValueOnce(layerData);
    gestureDown(ev(50, 60), env);
    expect(downCtx('brush').isStrokeContinuation).toBeUndefined();
    gestureUp(ev(50, 60), env);

    expect(h.endStroke).not.toHaveBeenCalled();
    expect(h.destroyPaintingCanvas).toHaveBeenCalledWith('layer-1');
    expect(editorState.updateLayerPixelData).toHaveBeenCalledWith('layer-1', layerData);
  });

  it('refreshes the layer mask after a mask stroke', () => {
    uiState.maskMode = 'layerMask';
    handler('brush').down.mockImplementationOnce(() => drawingState('brush', { maskMode: true }));
    gestureDown(ev(50, 60), env);
    gestureUp(ev(50, 60), env);

    expect(h.endStroke).not.toHaveBeenCalled();
    expect(h.destroyPaintingCanvas).not.toHaveBeenCalled();
    expect(h.scheduleMaskDataRefresh).toHaveBeenCalledWith('layer-1');
  });

  it('skips the mask refresh in Quick Mask', () => {
    uiState.maskMode = 'quickMask';
    handler('brush').down.mockImplementationOnce(() => drawingState('brush', { maskMode: true }));
    gestureDown(ev(50, 60), env);
    gestureUp(ev(50, 60), env);

    expect(h.scheduleMaskDataRefresh).not.toHaveBeenCalled();
  });

  it('clears the gradient preview', () => {
    uiState.activeTool = 'gradient';
    gestureDown(ev(50, 60), env);
    gestureUp(ev(60, 60), env);

    expect(handler('gradient').up).toHaveBeenCalledTimes(1);
    expect(uiState.setGradientPreview).toHaveBeenCalledWith(null);
  });
});

describe('hold-to-smooth', () => {
  function startHeldStroke(extra: Partial<InteractionState> = {}): InteractionContext {
    handler('brush').down.mockImplementationOnce(() => drawingState('brush', {
      strokePoints: [...HOLD_STROKE],
      lastPoint: { x: 3, y: 3 },
      ...extra,
    }));
    gestureDown(ev(50, 60), env);
    return downCtx('brush');
  }

  it('smooths a held brush stroke and leaves the session idle with a resume point', () => {
    const ctx = startHeldStroke({ symmetryCenter: { x: 100, y: 50 } });
    ts.symmetryHorizontal = true;
    editorState.undoStack = [{ kind: 'pixels', gpuSnapshots: new Map([['layer-1', 7]]) }, { kind: 'pixels', gpuSnapshots: new Map() }];
    gestureMove(ev(52, 62), env);
    vi.clearAllMocks();

    vi.advanceTimersByTime(1500);
    expect(h.endStroke).not.toHaveBeenCalled();
    runFrames();

    expect(h.smoothStroke).toHaveBeenCalledWith(HOLD_STROKE, 2.5);
    expect(editorState.pushHistory).toHaveBeenCalledWith('Brush');
    expect(h.restoreFromGpuSnapshot).toHaveBeenCalledWith(h.engine.current, 'layer-1', 7);
    expect(h.uploadLayerPixels).not.toHaveBeenCalled();
    expect(h.resetTrackedState).toHaveBeenCalledWith(h.engine.current, { preserveContentRefs: true });
    expect(h.brushDabBatchSymmetric).toHaveBeenCalledWith(
      h.engine.current,
      'layer-1',
      Float64Array.from([1, 1, 2, 2, 3, 3]),
      { horizontal: true, vertical: false, centerX: 100, centerY: 50, radialSegments: 0 },
      expect.objectContaining({ size: 10, r: 1, g: 0, b: 0, flow: 1 }),
    );
    expectInOrder(
      firstCall(h.endStroke, 0),
      firstCall(h.clearJsPixelData, 0),
      firstCall(editorState.pushHistory),
      firstCall(h.restoreFromGpuSnapshot),
      firstCall(h.resetTrackedState),
      firstCall(h.flushLayerSync),
      firstCall(h.syncSelection),
      firstCall(h.beginStroke),
      firstCall(h.brushDabBatchSymmetric),
      firstCall(h.endStroke, 1),
      firstCall(h.clearJsPixelData, 1),
      firstCall(editorState.notifyRender),
    );
    expect(ctx.stateRef.current).toEqual(INITIAL_INTERACTION_STATE);
    expect(ctx.lastPaintPointRef.current).toEqual({ point: { x: 3, y: 3 }, layerId: 'layer-1' });
    expect(uiState.setLastPaintPoint).toHaveBeenCalledWith({ point: { x: 3, y: 3 }, layerId: 'layer-1' });

    gestureUp(ev(52, 62), env);
    expect(handler('brush').up).not.toHaveBeenCalled();
  });

  it('clears the layer when the stroke began on a blank layer', () => {
    startHeldStroke();
    editorState.undoStack = [{ kind: 'pixels', gpuSnapshots: new Map() }, { kind: 'pixels', gpuSnapshots: new Map() }];
    gestureMove(ev(52, 62), env);
    vi.advanceTimersByTime(1500);
    runFrames();

    expect(h.restoreFromGpuSnapshot).not.toHaveBeenCalled();
    expect(h.uploadLayerPixels).toHaveBeenCalledWith(h.engine.current, 'layer-1', new Uint8Array(4), 1, 1, 0, 0);
    expect(h.brushDabBatchSymmetric).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a pencil stroke', 'pencil' as ToolId, {}],
    ['fewer than three points', 'brush' as ToolId, { strokePoints: HOLD_STROKE.slice(0, 2) }],
    ['a mask stroke', 'brush' as ToolId, { maskMode: true }],
  ])('is not armed for %s', (_name, tool, extra) => {
    uiState.activeTool = tool;
    handler(tool).down.mockImplementationOnce(() => drawingState(tool, {
      strokePoints: [...HOLD_STROKE],
      lastPoint: { x: 3, y: 3 },
      ...extra,
    }));
    gestureDown(ev(50, 60), env);
    gestureMove(ev(52, 62), env);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('is not armed for a CPU brush stroke', () => {
    h.engine.current = null;
    startHeldStroke();
    gestureMove(ev(52, 62), env);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('re-arms the timer on every move', () => {
    startHeldStroke();
    gestureMove(ev(52, 62), env);
    vi.advanceTimersByTime(1000);
    gestureMove(ev(53, 63), env);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(1000);
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(500);
    expect(frames).toHaveLength(1);
  });

  it('does not smooth when a move arrived between the timeout and the frame', () => {
    startHeldStroke();
    gestureMove(ev(52, 62), env);
    vi.advanceTimersByTime(1500);
    // A move that returns before re-arming (nothing to measure against)
    // leaves the frame queued, so only the move counter can stop it.
    env.toCanvas.mockReturnValueOnce(null);
    gestureMove(ev(52, 62), env);
    expect(frames.filter(Boolean)).toHaveLength(1);
    runFrames();

    expect(h.smoothStroke).not.toHaveBeenCalled();
  });

  it('does not smooth when the gesture state was replaced', () => {
    const ctx = startHeldStroke();
    gestureMove(ev(52, 62), env);
    vi.advanceTimersByTime(1500);
    ctx.stateRef.current = { ...ctx.stateRef.current };
    runFrames();

    expect(h.smoothStroke).not.toHaveBeenCalled();
  });

  it('resumes the stroke from the hold point once the drag moves past the threshold', () => {
    startHeldStroke();
    editorState.undoStack = [{ kind: 'pixels', gpuSnapshots: new Map() }, { kind: 'pixels', gpuSnapshots: new Map() }];
    gestureMove(ev(52, 62), env);
    vi.advanceTimersByTime(1500);
    runFrames();
    handler('brush').down.mockClear();

    gestureMove(ev(54, 63), env);
    expect(handler('brush').down).not.toHaveBeenCalled();

    let lastPaintAtDown: unknown = null;
    handler('brush').down.mockImplementationOnce((ctx) => {
      lastPaintAtDown = ctx.lastPaintPointRef.current;
      return drawingState('brush');
    });
    gestureMove(ev(60, 62, { altKey: true, metaKey: true }), env);

    const ctx = downCtx('brush');
    expect(ctx.shiftKey).toBe(true);
    expect(ctx.altKey).toBe(true);
    expect(ctx.metaKey).toBe(false);
    expect(ctx.canvasPos).toEqual({ x: 60, y: 62 });
    expect(lastPaintAtDown).toEqual({ point: { x: 3, y: 3 }, layerId: 'layer-1' });
    expect(handler('brush').move).toHaveBeenCalledTimes(1);
  });

  it('is cancelled by pointer up, before or after the timeout', () => {
    startHeldStroke();
    gestureMove(ev(52, 62), env);
    gestureUp(ev(52, 62), env);
    expect(vi.getTimerCount()).toBe(0);

    startHeldStroke();
    gestureMove(ev(52, 62), env);
    vi.advanceTimersByTime(1500);
    gestureUp(ev(52, 62), env);
    runFrames();

    expect(h.smoothStroke).not.toHaveBeenCalled();
  });
});

describe('session operations', () => {
  it('clearPersistentTransform drops the float and the live session state', () => {
    const ctx = sessionBoxes();
    ctx.persistentTransformRef.current = {} as PersistentTransform;
    h.hasFloat.mockReturnValue(true);
    vi.clearAllMocks();

    clearPersistentTransform();

    expect(ctx.persistentTransformRef.current).toBeNull();
    expect(ctx.floatingSelectionRef.current).toBeNull();
    expectInOrder(firstCall(h.commitLayerTransform), firstCall(h.dropFloat), firstCall(h.clearJsPixelData));
    expect(h.clearJsPixelData).toHaveBeenCalledWith('layer-1');
    expect(editorState.notifyRender).toHaveBeenCalledTimes(1);
  });

  it('clearPersistentTransform keeps a missing float alone', () => {
    clearPersistentTransform();

    expect(h.commitLayerTransform).toHaveBeenCalledTimes(1);
    expect(h.dropFloat).not.toHaveBeenCalled();
  });

  it('nudgeMove hands the session boxes to the nudge handler', () => {
    const ctx = sessionBoxes();
    nudgeMove(3, -1);

    const [dx, dy, floating, persistent] = h.handleNudgeMove.mock.calls[0]!;
    expect([dx, dy]).toEqual([3, -1]);
    expect(floating).toBe(ctx.floatingSelectionRef);
    expect(persistent).toBe(ctx.persistentTransformRef);
  });

  it('nudgeSelection nudges the held selection', () => {
    nudgeSelection(-2, 4);

    expect(h.nudgeHeldSelection).toHaveBeenCalledWith('selection', -2, 4);
  });

  it('attachGestureSession registers the session boxes and returns the unregister', () => {
    const ctx = sessionBoxes();
    const detach = attachGestureSession();

    const [floating, persistent] = h.registerFloatSession.mock.calls[0]! as unknown[];
    expect(floating).toBe(ctx.floatingSelectionRef);
    expect(persistent).toBe(ctx.persistentTransformRef);
    expect(h.unregisterFloat).not.toHaveBeenCalled();
    detach();
    expect(h.unregisterFloat).toHaveBeenCalledTimes(1);
  });
});
