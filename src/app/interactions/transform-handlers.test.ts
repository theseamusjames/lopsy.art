import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Rect } from '../../types';

// Bridges — we care that setSelection is NOT called per move, and IS called on up.
const setSelectionMaskMock = vi.fn();
vi.mock('../../engine-wasm/wasm-bridge', () => ({
  floatSelection: vi.fn(),
  hasFloat: vi.fn(() => false),
  setSelectionMask: (...a: unknown[]) => setSelectionMaskMock(...a),
  compositeFloat: vi.fn(),
  compositeFloatAffine: vi.fn(),
  compositeFloatPerspective: vi.fn(),
  dropFloat: vi.fn(),
}));

vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => ({ __engine: 'mock' }),
}));

const uiState = {
  showGrid: false,
  snapToGrid: false,
  gridSize: 8,
  activeTool: 'marquee-rect' as string,
  transform: null as unknown,
  setTransform: vi.fn((t: unknown) => { uiState.transform = t; }),
  setActiveTransformHandle: vi.fn(),
};
vi.mock('../ui-store', () => ({
  useUIStore: {
    getState: () => uiState,
  },
}));

const editorState = {
  document: { width: 1024, height: 1024, layers: [], activeLayerId: 'layer-1' },
  setSelection: vi.fn(),
  notifyRender: vi.fn(),
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

import { handleTransformMove, handleSelectionTransformUp } from './transform-handlers';
import type { InteractionState } from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';

function makeSelectionTransformState(): InteractionState {
  const startBounds: Rect = { x: 100, y: 100, width: 100, height: 100 };
  const startState = {
    originalBounds: startBounds,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    translateX: 0,
    translateY: 0,
    skewX: 0,
    skewY: 0,
    mode: 'free' as const,
    corners: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }] as [
      { x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number },
    ],
  };
  return {
    drawing: true,
    lastPoint: null,
    layerId: 'layer-1',
    tool: 'marquee-rect',
    startPoint: { x: 200, y: 200 },
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    // Overrides DEFAULT_TRANSFORM_FIELDS.gesture — spread order matters.
    gesture: {
      kind: 'transform',
      handle: 'bottom-right',
      startState,
      startAngle: 0,
      selectionOnly: true,
    },
  };
}

describe('handleTransformMove — selection-only resize (#643)', () => {
  beforeEach(() => {
    editorState.setSelection.mockClear();
    editorState.notifyRender.mockClear();
    setSelectionMaskMock.mockClear();
    uiState.setTransform.mockClear();
    uiState.transform = null;
    uiState.activeTool = 'marquee-rect';
  });

  it('does NOT rebuild or upload the selection mask per pointer-move', () => {
    const state = makeSelectionTransformState();

    // Simulate 30 rapid move events (drag from 200,200 outward).
    for (let i = 1; i <= 30; i++) {
      handleTransformMove(state, { x: 200 + i * 2, y: 200 + i * 2 }, false);
    }

    // The bug: setSelection was called on every move, forcing engine-sync
    // to re-upload a docW*docH selection mask each frame.
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });

  it('publishes an updated transform (with active scale/translate) each move so ants track live', () => {
    const state = makeSelectionTransformState();
    handleTransformMove(state, { x: 250, y: 250 }, false);

    expect(uiState.setTransform).toHaveBeenCalledTimes(1);
    const t = uiState.setTransform.mock.calls[0]![0] as {
      originalBounds: Rect;
      scaleX: number;
      scaleY: number;
      translateX: number;
      translateY: number;
    };
    // originalBounds are preserved from startState (not reset to identity).
    expect(t.originalBounds).toEqual({ x: 100, y: 100, width: 100, height: 100 });
    // The mask is unchanged — the scale is expressed on the transform, which
    // renderSelectionAnts applies to the mask contours.
    expect(t.scaleX !== 1 || t.scaleY !== 1 || t.translateX !== 0 || t.translateY !== 0).toBe(true);
  });
});

describe('handleSelectionTransformUp — materializes mask on commit (#643)', () => {
  beforeEach(() => {
    editorState.setSelection.mockClear();
    editorState.notifyRender.mockClear();
    uiState.setTransform.mockClear();
    uiState.activeTool = 'marquee-rect';
    uiState.transform = null;
  });

  it('rebuilds the selection mask + commits new bounds exactly once on release', () => {
    const state = makeSelectionTransformState();
    // Drive one move so the transform is set on the UI store.
    handleTransformMove(state, { x: 300, y: 250 }, false);
    expect(editorState.setSelection).not.toHaveBeenCalled();

    handleSelectionTransformUp(state);

    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    const [bounds, mask, w, h] = editorState.setSelection.mock.calls[0]!;
    expect(w).toBe(1024);
    expect(h).toBe(1024);
    expect(mask).toBeInstanceOf(Uint8ClampedArray);
    // The commit collapses the transform into fresh bounds + identity transform.
    const finalT = uiState.setTransform.mock.calls[uiState.setTransform.mock.calls.length - 1]![0] as {
      scaleX: number;
      scaleY: number;
      translateX: number;
      translateY: number;
    };
    expect(finalT.scaleX).toBe(1);
    expect(finalT.scaleY).toBe(1);
    expect(finalT.translateX).toBe(0);
    expect(finalT.translateY).toBe(0);
    // Sanity: the bounds passed to setSelection should be non-empty.
    const boundsRect = bounds as Rect;
    expect(boundsRect.width).toBeGreaterThan(0);
    expect(boundsRect.height).toBeGreaterThan(0);
  });

  it('is a no-op for non-selection-only transform gestures', () => {
    const state = makeSelectionTransformState();
    // Flip the flag to simulate a layer-transform gesture instead.
    (state.gesture as { selectionOnly: boolean }).selectionOnly = false;
    handleSelectionTransformUp(state);
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });

  it('is a no-op when the gesture is not a transform at all', () => {
    const state: InteractionState = {
      ...makeSelectionTransformState(),
      gesture: { kind: 'idle' },
    };
    handleSelectionTransformUp(state);
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });
});
