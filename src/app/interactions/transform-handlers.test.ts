/**
 * Tests for the deferred selection-transform-resize commit (issue #643).
 *
 * The move-time handler used to rebuild + re-upload a full-document
 * selection mask on every pointer event (~16.7 MB per move on a 4K canvas).
 * The rebuild now happens once, on pointer-up, via commitSelectionTransform.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../engine-wasm/wasm-bridge', () => {
  const wasmThrow = (): never => { throw new Error('wasm unavailable in test'); };
  return {
    createRectSelection: wasmThrow,
    createEllipseSelection: wasmThrow,
    selectionBounds: wasmThrow,
    floatSelection: vi.fn(),
    compositeFloat: vi.fn(),
    compositeFloatAffine: vi.fn(),
    compositeFloatPerspective: vi.fn(),
    hasFloat: vi.fn(() => false),
    dropFloat: vi.fn(),
    setSelectionMask: vi.fn(),
  };
});

vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => ({ __engine: 'mock' }),
}));

const editorState = {
  document: { width: 100, height: 100, layers: [] as unknown[] },
  setSelection: vi.fn(),
  notifyRender: vi.fn(),
};
vi.mock('../editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

const uiState = {
  transform: null as import('../../tools/transform/transform').TransformState | null,
  activeTool: 'marquee-rect' as string,
  setTransform: vi.fn((t: unknown) => { uiState.transform = t as typeof uiState.transform; }),
  setActiveTransformHandle: vi.fn(),
  showGrid: false,
  snapToGrid: false,
  gridSize: 10,
};
vi.mock('../ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

vi.mock('../store/clear-js-pixel-data', () => ({
  clearJsPixelData: vi.fn(),
}));

vi.mock('../../panels/LayerPanel/layer-selection', () => ({
  selectLayerAlpha: vi.fn(),
}));

import { handleTransformMove, commitSelectionTransform } from './transform-handlers';
import type { InteractionState } from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';
import { createTransformState } from '../../tools/transform/transform';

function makeStartState(): InteractionState {
  const bounds = { x: 20, y: 20, width: 20, height: 20 };
  const start = createTransformState(bounds);
  return {
    drawing: true,
    lastPoint: { x: 40, y: 40 },
    layerId: 'layer-1',
    tool: 'marquee-rect',
    startPoint: { x: 40, y: 40 },
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    gesture: {
      kind: 'transform',
      handle: 'bottom-right',
      startState: start,
      startAngle: 0,
      selectionOnly: true,
    },
  };
}

beforeEach(() => {
  editorState.setSelection.mockClear();
  editorState.notifyRender.mockClear();
  uiState.setTransform.mockClear();
  uiState.transform = null;
  uiState.activeTool = 'marquee-rect';
});

describe('handleTransformMove — selection-only resize (issue #643)', () => {
  it('does not rebuild or upload a selection mask during the drag', () => {
    handleTransformMove(makeStartState(), { x: 60, y: 60 }, false);
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });

  it('only updates the transform state so the ants scale via the renderer', () => {
    handleTransformMove(makeStartState(), { x: 60, y: 60 }, false);
    expect(uiState.setTransform).toHaveBeenCalledTimes(1);
    const t = uiState.setTransform.mock.calls[0]![0]! as import('../../tools/transform/transform').TransformState;
    // Dragging the bottom-right handle to a 40x40 target box doubles both axes.
    expect(t.scaleX).toBeGreaterThan(1);
    expect(t.scaleY).toBeGreaterThan(1);
  });
});

describe('commitSelectionTransform — pointer-up commit (issue #643)', () => {
  it('materialises the scaled mask exactly once on release', () => {
    const state = makeStartState();
    handleTransformMove(state, { x: 60, y: 60 }, false);
    editorState.setSelection.mockClear();
    commitSelectionTransform(state);
    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    const [bounds, mask, w, h] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
      number,
      number,
    ];
    expect(w).toBe(100);
    expect(h).toBe(100);
    // The scaled bounds are wider/taller than the original 20×20.
    expect(bounds.width).toBeGreaterThan(20);
    expect(bounds.height).toBeGreaterThan(20);
    expect(mask.length).toBe(100 * 100);
  });

  it('builds a rect mask by default and an ellipse mask for marquee-ellipse', () => {
    uiState.activeTool = 'marquee-ellipse';
    const state = makeStartState();
    handleTransformMove(state, { x: 60, y: 60 }, false);
    commitSelectionTransform(state);
    const mask = editorState.setSelection.mock.calls[0]![1]! as Uint8ClampedArray;
    // Corners of the transformed bounding box should be outside an ellipse.
    const b = editorState.setSelection.mock.calls[0]![0]!;
    const cornerIdx = b.y * 100 + b.x;
    expect(mask[cornerIdx]).toBe(0);
  });

  it('is a no-op when the gesture is not a selection-only transform', () => {
    const state: InteractionState = {
      ...makeStartState(),
      gesture: { kind: 'idle' },
    };
    commitSelectionTransform(state);
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });

  it('is a no-op when the collapsed bounds are degenerate', () => {
    uiState.transform = {
      ...createTransformState({ x: 0, y: 0, width: 20, height: 20 }),
      scaleX: 0,
      scaleY: 0,
    };
    commitSelectionTransform(makeStartState());
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });
});
