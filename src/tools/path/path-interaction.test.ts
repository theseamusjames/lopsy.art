import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const commitCurrentPath = vi.fn();
vi.mock('../../app/interactions/path-stroke', () => ({
  commitCurrentPath: (...args: unknown[]) => commitCurrentPath(...args),
}));

import type { PathAnchor } from './path';

interface MockPath {
  id: string;
  anchors: PathAnchor[];
  closed: boolean;
}

const editorState = {
  selectedPathId: null as string | null,
  paths: [] as MockPath[],
  viewport: { zoom: 1 },
  updatePathAnchors: vi.fn((id: string, anchors: PathAnchor[], closed: boolean) => {
    const path = editorState.paths.find((p) => p.id === id);
    if (path) {
      path.anchors = anchors;
      path.closed = closed;
    }
  }),
  selectPath: vi.fn((id: string | null) => { editorState.selectedPathId = id; }),
  notifyRender: vi.fn(),
};
vi.mock('../../app/editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

interface DraggingHandle {
  anchorIndex: number;
  handle: 'in' | 'out';
}

const uiState = {
  pathDraft: null as { anchors: PathAnchor[] } | null,
  addPathAnchor: vi.fn((a: PathAnchor) => {
    if (!uiState.pathDraft) uiState.pathDraft = { anchors: [] };
    uiState.pathDraft.anchors.push(a);
  }),
  updateLastPathAnchor: vi.fn((a: PathAnchor) => {
    if (uiState.pathDraft && uiState.pathDraft.anchors.length > 0) {
      uiState.pathDraft.anchors[uiState.pathDraft.anchors.length - 1] = a;
    }
  }),
  closePath: vi.fn(),
  editingAnchorIndex: null as number | null,
  setEditingAnchorIndex: vi.fn((idx: number | null) => { uiState.editingAnchorIndex = idx; }),
  convertingAnchorToSpline: false,
  setConvertingAnchorToSpline: vi.fn((v: boolean) => { uiState.convertingAnchorToSpline = v; }),
  draggingHandle: null as DraggingHandle | null,
  setDraggingHandle: vi.fn((h: DraggingHandle | null) => { uiState.draggingHandle = h; }),
};
vi.mock('../../app/ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

import { handlePathDown, handlePathMove, handlePathUp } from './path-interaction';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';

function makeCtx(overrides: Partial<InteractionContext> = {}): InteractionContext {
  const layer = { id: 'layer-1', x: 0, y: 0, visible: true } as unknown as InteractionContext['activeLayer'];
  return {
    canvasPos: { x: 50, y: 50 },
    layerPos: { x: 50, y: 50 },
    shiftKey: false,
    altKey: false,
    metaKey: false,
    activeLayerId: 'layer-1',
    activeLayer: layer,
    clientX: 0,
    clientY: 0,
    stateRef: { current: {} } as unknown as InteractionContext['stateRef'],
    floatingSelectionRef: { current: null },
    persistentTransformRef: { current: null },
    stampSourceRef: { current: null },
    stampOffsetRef: { current: null },
    lastPaintPointRef: { current: null },
    ...overrides,
  };
}

function makeState(overrides: Partial<InteractionState> = {}): InteractionState {
  return {
    drawing: true,
    lastPoint: { x: 50, y: 50 },
    layerId: 'layer-1',
    tool: 'path',
    startPoint: { x: 50, y: 50 },
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    ...overrides,
  };
}

function anchor(x: number, y: number): PathAnchor {
  return { point: { x, y }, handleIn: null, handleOut: null };
}

// The double-click detector uses module-level Date.now() state. Advance the
// mocked clock by 10s before each test so clicks never bleed across tests.
let now = 1_000_000;

beforeEach(() => {
  now += 10_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  commitCurrentPath.mockClear();
  editorState.selectedPathId = null;
  editorState.paths = [];
  editorState.viewport = { zoom: 1 };
  editorState.updatePathAnchors.mockClear();
  editorState.selectPath.mockClear();
  uiState.pathDraft = null;
  uiState.addPathAnchor.mockClear();
  uiState.updateLastPathAnchor.mockClear();
  uiState.closePath.mockClear();
  uiState.editingAnchorIndex = null;
  uiState.setEditingAnchorIndex.mockClear();
  uiState.convertingAnchorToSpline = false;
  uiState.setConvertingAnchorToSpline.mockClear();
  uiState.draggingHandle = null;
  uiState.setDraggingHandle.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('path creation mode', () => {
  it('first click places an anchor at the layer position', () => {
    const state = handlePathDown(makeCtx({ layerPos: { x: 10, y: 20 } }));
    expect(uiState.addPathAnchor).toHaveBeenCalledWith({
      point: { x: 10, y: 20 },
      handleIn: null,
      handleOut: null,
    });
    expect(state).toMatchObject({ drawing: true, tool: 'path', startPoint: { x: 10, y: 20 } });
  });

  it('clicking near the first anchor with 2+ anchors closes the path', () => {
    uiState.pathDraft = { anchors: [anchor(10, 10), anchor(60, 10)] };
    const result = handlePathDown(makeCtx({ layerPos: { x: 13, y: 13 } }));
    expect(result).toBeUndefined();
    expect(uiState.closePath).toHaveBeenCalledTimes(1);
    expect(commitCurrentPath).toHaveBeenCalledTimes(1);
    expect(uiState.addPathAnchor).not.toHaveBeenCalled();
  });

  it('clicking exactly 8px away from the first anchor does not close', () => {
    uiState.pathDraft = { anchors: [anchor(10, 10), anchor(60, 10)] };
    handlePathDown(makeCtx({ layerPos: { x: 18, y: 10 } }));
    expect(uiState.closePath).not.toHaveBeenCalled();
    expect(uiState.addPathAnchor).toHaveBeenCalledTimes(1);
  });

  it('with a single anchor the path cannot close yet', () => {
    uiState.pathDraft = { anchors: [anchor(10, 10)] };
    handlePathDown(makeCtx({ layerPos: { x: 11, y: 11 } }));
    expect(uiState.closePath).not.toHaveBeenCalled();
    expect(uiState.addPathAnchor).toHaveBeenCalledTimes(1);
  });

  it('dragging past 2px pulls out symmetric handles on the new anchor', () => {
    handlePathMove(makeState({ startPoint: { x: 10, y: 10 } }), { x: 15, y: 13 });
    expect(uiState.updateLastPathAnchor).toHaveBeenCalledWith({
      point: { x: 10, y: 10 },
      handleOut: { x: 15, y: 13 },
      handleIn: { x: 5, y: 7 },
    });
    expect(editorState.notifyRender).toHaveBeenCalled();
  });

  it('a sub-2px drag does not create handles', () => {
    handlePathMove(makeState({ startPoint: { x: 10, y: 10 } }), { x: 11, y: 11 });
    expect(uiState.updateLastPathAnchor).not.toHaveBeenCalled();
  });

  it('move without a start point is ignored', () => {
    handlePathMove(makeState({ startPoint: null }), { x: 100, y: 100 });
    expect(uiState.updateLastPathAnchor).not.toHaveBeenCalled();
  });
});

describe('path edit mode', () => {
  function selectPathWith(anchors: PathAnchor[], closed = false): void {
    editorState.selectedPathId = 'path-1';
    editorState.paths = [{ id: 'path-1', anchors, closed }];
  }

  it('clicking a handle starts a handle drag', () => {
    selectPathWith([
      { point: { x: 50, y: 50 }, handleIn: { x: 40, y: 40 }, handleOut: { x: 60, y: 60 } },
      anchor(100, 50),
    ]);
    const state = handlePathDown(makeCtx({ canvasPos: { x: 60, y: 60 } }));
    expect(uiState.setDraggingHandle).toHaveBeenCalledWith({ anchorIndex: 0, handle: 'out' });
    expect(uiState.setEditingAnchorIndex).toHaveBeenCalledWith(0);
    expect(state).toMatchObject({ drawing: true, tool: 'path' });
  });

  it('clicking an anchor begins an anchor drag without converting', () => {
    selectPathWith([anchor(50, 50), anchor(100, 50)]);
    const state = handlePathDown(makeCtx({ canvasPos: { x: 51, y: 51 } }));
    expect(uiState.setEditingAnchorIndex).toHaveBeenCalledWith(0);
    expect(uiState.setConvertingAnchorToSpline).toHaveBeenCalledWith(false);
    expect(state?.drawing).toBe(true);
  });

  it('double-clicking a spline anchor strips its handles', () => {
    selectPathWith([
      { point: { x: 50, y: 50 }, handleIn: { x: 30, y: 50 }, handleOut: { x: 70, y: 50 } },
      anchor(100, 50),
    ]);
    handlePathDown(makeCtx({ canvasPos: { x: 50, y: 50 } }));
    now += 100; // second click 100ms later — inside the 400ms window
    handlePathDown(makeCtx({ canvasPos: { x: 50, y: 50 } }));
    expect(editorState.paths[0]!.anchors[0]).toEqual({
      point: { x: 50, y: 50 },
      handleIn: null,
      handleOut: null,
    });
    expect(uiState.setConvertingAnchorToSpline).toHaveBeenLastCalledWith(true);
  });

  it('two slow clicks do not count as a double click', () => {
    selectPathWith([
      { point: { x: 50, y: 50 }, handleIn: { x: 30, y: 50 }, handleOut: { x: 70, y: 50 } },
      anchor(100, 50),
    ]);
    handlePathDown(makeCtx({ canvasPos: { x: 50, y: 50 } }));
    now += 500; // outside the 400ms window
    handlePathDown(makeCtx({ canvasPos: { x: 50, y: 50 } }));
    expect(editorState.paths[0]!.anchors[0]!.handleIn).toEqual({ x: 30, y: 50 });
    expect(uiState.setConvertingAnchorToSpline).toHaveBeenLastCalledWith(false);
  });

  it('meta-click converts immediately without waiting for a double click', () => {
    selectPathWith([
      { point: { x: 50, y: 50 }, handleIn: { x: 30, y: 50 }, handleOut: { x: 70, y: 50 } },
      anchor(100, 50),
    ]);
    handlePathDown(makeCtx({ canvasPos: { x: 50, y: 50 }, metaKey: true }));
    expect(editorState.paths[0]!.anchors[0]!.handleIn).toBeNull();
    expect(uiState.setConvertingAnchorToSpline).toHaveBeenCalledWith(true);
  });

  it('clicking a segment splits it at the midpoint', () => {
    selectPathWith([anchor(0, 50), anchor(100, 50)]);
    const result = handlePathDown(makeCtx({ canvasPos: { x: 50, y: 50 } }));
    expect(result).toBeUndefined();
    expect(editorState.paths[0]!.anchors).toHaveLength(3);
    expect(editorState.paths[0]!.anchors[1]!.point).toEqual({ x: 50, y: 50 });
  });

  it('clicking empty space deselects the path', () => {
    selectPathWith([anchor(0, 0), anchor(10, 0)]);
    const result = handlePathDown(makeCtx({ canvasPos: { x: 200, y: 200 } }));
    expect(result).toBeUndefined();
    expect(editorState.selectPath).toHaveBeenCalledWith(null);
    expect(uiState.setEditingAnchorIndex).toHaveBeenCalledWith(null);
  });

  it('scales the hit threshold with zoom', () => {
    selectPathWith([anchor(50, 50), anchor(100, 50)]);
    editorState.viewport = { zoom: 4 }; // threshold becomes 2px
    handlePathDown(makeCtx({ canvasPos: { x: 55, y: 50 } }));
    // 5px away at threshold 2 — no anchor hit; the click lands on the segment.
    expect(uiState.setEditingAnchorIndex).not.toHaveBeenCalledWith(0);
  });

  it('dragging an anchor moves its point and translates its handles', () => {
    selectPathWith([
      { point: { x: 50, y: 50 }, handleIn: { x: 40, y: 50 }, handleOut: { x: 60, y: 50 } },
    ]);
    uiState.editingAnchorIndex = 0;
    handlePathMove(makeState(), { x: 70, y: 80 });
    expect(editorState.paths[0]!.anchors[0]).toEqual({
      point: { x: 70, y: 80 },
      handleIn: { x: 60, y: 80 },
      handleOut: { x: 80, y: 80 },
    });
  });

  it('a sub-1px anchor drag is ignored', () => {
    selectPathWith([anchor(50, 50)]);
    uiState.editingAnchorIndex = 0;
    handlePathMove(makeState(), { x: 50.5, y: 50.5 });
    expect(editorState.updatePathAnchors).not.toHaveBeenCalled();
  });

  it('dragging a handle moves only that handle', () => {
    selectPathWith([
      { point: { x: 50, y: 50 }, handleIn: { x: 40, y: 50 }, handleOut: { x: 60, y: 50 } },
    ]);
    uiState.editingAnchorIndex = 0;
    uiState.draggingHandle = { anchorIndex: 0, handle: 'in' };
    handlePathMove(makeState(), { x: 30, y: 30 });
    expect(editorState.paths[0]!.anchors[0]).toEqual({
      point: { x: 50, y: 50 },
      handleIn: { x: 30, y: 30 },
      handleOut: { x: 60, y: 50 },
    });
  });

  it('handle drags translate layer-local input into canvas space', () => {
    selectPathWith([
      { point: { x: 50, y: 50 }, handleIn: null, handleOut: { x: 60, y: 50 } },
    ]);
    uiState.editingAnchorIndex = 0;
    uiState.draggingHandle = { anchorIndex: 0, handle: 'out' };
    handlePathMove(makeState({ layerStartX: 100, layerStartY: 200 }), { x: 10, y: 10 });
    expect(editorState.paths[0]!.anchors[0]!.handleOut).toEqual({ x: 110, y: 210 });
  });

  it('convert-to-spline drag pulls out symmetric handles', () => {
    selectPathWith([anchor(50, 50)]);
    uiState.editingAnchorIndex = 0;
    uiState.convertingAnchorToSpline = true;
    handlePathMove(makeState(), { x: 60, y: 55 });
    expect(editorState.paths[0]!.anchors[0]).toEqual({
      point: { x: 50, y: 50 },
      handleOut: { x: 60, y: 55 },
      handleIn: { x: 40, y: 45 },
    });
  });

  it('convert-to-spline ignores tiny drags', () => {
    selectPathWith([anchor(50, 50)]);
    uiState.editingAnchorIndex = 0;
    uiState.convertingAnchorToSpline = true;
    handlePathMove(makeState(), { x: 51, y: 51 });
    expect(editorState.updatePathAnchors).not.toHaveBeenCalled();
  });
});

describe('path up', () => {
  it('clears all transient edit state', () => {
    uiState.editingAnchorIndex = 2;
    uiState.convertingAnchorToSpline = true;
    uiState.draggingHandle = { anchorIndex: 2, handle: 'out' };
    handlePathUp();
    expect(uiState.setEditingAnchorIndex).toHaveBeenCalledWith(null);
    expect(uiState.setConvertingAnchorToSpline).toHaveBeenCalledWith(false);
    expect(uiState.setDraggingHandle).toHaveBeenCalledWith(null);
  });

  it('leaves untouched state alone when nothing was being edited', () => {
    handlePathUp();
    expect(uiState.setEditingAnchorIndex).not.toHaveBeenCalled();
    expect(uiState.setConvertingAnchorToSpline).not.toHaveBeenCalled();
    expect(uiState.setDraggingHandle).not.toHaveBeenCalled();
  });
});
