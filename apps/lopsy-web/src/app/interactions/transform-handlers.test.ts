import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  commitSelectionTransform,
} from './transform-handlers';
import { createTransformState } from '../../tools/transform/transform';
import type { TransformHandle } from '../../tools/transform/transform';
import { getMarqueePreview, setMarqueePreview } from '../../tools/marquee/marquee-preview';
import { useToolSettingsStore } from '../tool-settings-store';
import type { InteractionState } from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';

type Bounds = { x: number; y: number; width: number; height: number };

function makeState(
  overrides: Partial<InteractionState> & { startState?: ReturnType<typeof createTransformState> } = {},
  handle: TransformHandle = 'bottom-right',
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
      handle,
      startState,
      startAngle: 0,
      selectionOnly: true,
      isLayerTransform: false,
    },
  };
}

function committedBounds(): Bounds {
  return editorState.setSelection.mock.calls[0]![0] as Bounds;
}

function committedMask(): Uint8ClampedArray {
  return editorState.setSelection.mock.calls[0]![1] as Uint8ClampedArray;
}

describe('marquee handle resize (#1421, #653)', () => {
  beforeEach(() => {
    commitSelectionTransform();
    setMarqueePreview(null);
    editorState.setSelection.mockClear();
    editorState.notifyRender.mockClear();
    uiState.setTransform.mockClear();
    uiState.activeTool = 'marquee-rect';
    useToolSettingsStore.setState({ aspectRatioLocked: false, aspectRatioW: 1, aspectRatioH: 1 });
  });

  // #1421: rebuilding and uploading a document-sized mask on every frame
  // made resizing crawl. The drag only moves the analytic preview.
  it('builds no mask while the handle is dragged', () => {
    const state = makeState();
    for (let i = 0; i < 12; i++) {
      handleTransformMove(state, { x: 40 + i, y: 40 + i }, false);
    }
    expect(editorState.setSelection).not.toHaveBeenCalled();
    expect(uiState.setTransform).not.toHaveBeenCalled();
    expect(getMarqueePreview()).toEqual({ kind: 'rect', rect: { x: 10, y: 10, width: 41, height: 41 } });
  });

  it('commits the last dragged box once on release', () => {
    const state = makeState();
    handleTransformMove(state, { x: 45, y: 45 }, false);
    handleTransformMove(state, { x: 60, y: 60 }, false);
    commitSelectionTransform();

    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    expect(committedBounds()).toEqual({ x: 10, y: 10, width: 50, height: 50 });
    expect(uiState.setTransform).toHaveBeenCalledTimes(1);
    expect(getMarqueePreview()).toBeNull();
  });

  it('commits nothing when the handle was only tapped', () => {
    handleTransformMove(makeState(), { x: 40, y: 40 }, false);
    commitSelectionTransform();
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });

  it('produces an elliptical mask when the active tool is marquee-ellipse', () => {
    uiState.activeTool = 'marquee-ellipse';
    const state = makeState({ tool: 'marquee-ellipse' });
    handleTransformMove(state, { x: 60, y: 60 }, false);
    expect(getMarqueePreview()?.kind).toBe('ellipse');
    commitSelectionTransform();

    const bounds = committedBounds();
    const mask = committedMask();
    const cornerIdx = Math.floor(bounds.y) * DOC_W + Math.floor(bounds.x);
    const centreIdx =
      Math.floor(bounds.y + bounds.height / 2) * DOC_W +
      Math.floor(bounds.x + bounds.width / 2);
    expect(mask[cornerIdx]).toBe(0);
    expect(mask[centreIdx]).toBe(255);
  });

  it('produces a rectangular mask for non-ellipse selection tools', () => {
    for (const tool of ['marquee-rect', 'lasso', 'lasso-magnetic'] as const) {
      editorState.setSelection.mockClear();
      uiState.activeTool = tool;
      handleTransformMove(makeState({ tool }), { x: 60, y: 60 }, false);
      commitSelectionTransform();
      const bounds = committedBounds();
      expect(committedMask()[Math.floor(bounds.y) * DOC_W + Math.floor(bounds.x)]).toBe(255);
    }
  });

  it('never collapses or flips the box when dragged past the opposite corner', () => {
    handleTransformMove(makeState(), { x: 0, y: 0 }, false);
    commitSelectionTransform();
    expect(committedBounds()).toEqual({ x: 10, y: 10, width: 1, height: 1 });
  });

  // #1421: the lock applied only while drawing, not while resizing.
  it('keeps the locked aspect ratio on a corner drag', () => {
    useToolSettingsStore.setState({ aspectRatioLocked: true, aspectRatioW: 16, aspectRatioH: 9 });
    const startState = createTransformState({ x: 10, y: 10, width: 32, height: 18 });
    handleTransformMove(makeState({ startState, startPoint: { x: 42, y: 28 } }), { x: 74, y: 70 }, false);
    commitSelectionTransform();
    expect(committedBounds()).toEqual({ x: 10, y: 10, width: 64, height: 36 });
  });

  it('keeps the locked aspect ratio on an edge drag', () => {
    useToolSettingsStore.setState({ aspectRatioLocked: true, aspectRatioW: 2, aspectRatioH: 1 });
    const startState = createTransformState({ x: 10, y: 20, width: 40, height: 20 });
    handleTransformMove(
      makeState({ startState, startPoint: { x: 50, y: 30 } }, 'right'),
      { x: 70, y: 30 },
      false,
    );
    commitSelectionTransform();
    expect(committedBounds()).toEqual({ x: 10, y: 15, width: 60, height: 30 });
  });

  it('resizes freely when the lock is off', () => {
    const startState = createTransformState({ x: 10, y: 10, width: 32, height: 18 });
    handleTransformMove(makeState({ startState, startPoint: { x: 42, y: 28 } }), { x: 74, y: 70 }, false);
    commitSelectionTransform();
    expect(committedBounds()).toEqual({ x: 10, y: 10, width: 64, height: 60 });
  });
});
