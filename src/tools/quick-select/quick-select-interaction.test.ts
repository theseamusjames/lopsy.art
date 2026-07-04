import { describe, it, expect, vi, beforeEach } from 'vitest';

const readLayerPixelsForFill = vi.fn();

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  readLayerPixelsForFill: (...args: unknown[]) => readLayerPixelsForFill(...args),
}));

let engine: { __engine: string } | null = { __engine: 'mock' };
vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => engine,
}));

const DOC_W = 12;
const DOC_H = 12;

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
};
vi.mock('../../app/ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

const ts = {
  settings: {
    quickSelect: {
      size: 3,
      tolerance: 32,
      edgeStrength: 0,
      mode: 'add' as 'add' | 'subtract',
    },
  },
};
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => ts },
}));

import {
  handleQuickSelectDown,
  handleQuickSelectMove,
  handleQuickSelectUp,
  __flushQuickSelectStrokeForTest,
} from './quick-select-interaction';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';

/**
 * 12x12 RGBA image split into two flat-color regions:
 * rows 0..5 red, rows 6..11 blue. The sharp horizontal boundary keeps the
 * flood fill from leaking across regions at any tolerance below ~147.
 */
function twoBandImage(): Uint8Array {
  const px = new Uint8Array(DOC_W * DOC_H * 4);
  for (let y = 0; y < DOC_H; y++) {
    for (let x = 0; x < DOC_W; x++) {
      const i = (y * DOC_W + x) * 4;
      if (y < 6) {
        px[i] = 255;
      } else {
        px[i + 2] = 255;
      }
      px[i + 3] = 255;
    }
  }
  return px;
}

function makeCtx(overrides: Partial<InteractionContext> = {}): InteractionContext {
  const layer = { id: 'layer-1', x: 0, y: 0, visible: true } as unknown as InteractionContext['activeLayer'];
  return {
    canvasPos: { x: 2, y: 2 },
    layerPos: { x: 2, y: 2 },
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
    lastPoint: { x: 2, y: 2 },
    layerId: 'layer-1',
    tool: 'quick-select',
    startPoint: { x: 2, y: 2 },
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    ...overrides,
  };
}

function lastSetSelectionMask(): Uint8ClampedArray {
  const calls = editorState.setSelection.mock.calls;
  const call = calls[calls.length - 1]!;
  return call[1] as Uint8ClampedArray;
}

beforeEach(() => {
  engine = { __engine: 'mock' };
  readLayerPixelsForFill.mockReset();
  readLayerPixelsForFill.mockReturnValue(twoBandImage());
  editorState.setSelection.mockClear();
  editorState.clearSelection.mockClear();
  editorState.selection = { active: false, mask: null, bounds: null, maskWidth: 0, maskHeight: 0 };
  uiState.setTransform.mockClear();
  ts.settings.quickSelect.mode = 'add';
  ts.settings.quickSelect.tolerance = 32;
  // Clear the module-level stroke session from any previous test.
  handleQuickSelectUp();
});

describe('quick select down', () => {
  it('returns undefined when no engine is available', () => {
    engine = null;
    expect(handleQuickSelectDown(makeCtx())).toBeUndefined();
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });

  it('returns undefined when the GPU readback fails', () => {
    readLayerPixelsForFill.mockImplementation(() => {
      throw new Error('readback failed');
    });
    expect(handleQuickSelectDown(makeCtx())).toBeUndefined();
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });

  it('seeds the selection with the clicked color region', () => {
    const state = handleQuickSelectDown(makeCtx({ canvasPos: { x: 2, y: 2 } }));
    expect(state).toMatchObject({ drawing: true, tool: 'quick-select' });
    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    const [bounds, mask, w, h] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
      number,
      number,
    ];
    expect(w).toBe(DOC_W);
    expect(h).toBe(DOC_H);
    // Whole red band selected, blue band untouched.
    expect(bounds).toEqual({ x: 0, y: 0, width: DOC_W, height: 6 });
    expect(mask[2 * DOC_W + 2]).toBe(255);
    expect(mask[11 * DOC_W + 2]).toBe(0);
    expect(uiState.setTransform).toHaveBeenCalledTimes(1);
  });

  it('preserves a prior selection when adding', () => {
    const prior = new Uint8ClampedArray(DOC_W * DOC_H);
    prior[10 * DOC_W + 10] = 255; // a blue-region pixel selected earlier
    editorState.selection = {
      active: true,
      mask: prior,
      bounds: { x: 10, y: 10, width: 1, height: 1 },
      maskWidth: DOC_W,
      maskHeight: DOC_H,
    };
    handleQuickSelectDown(makeCtx({ canvasPos: { x: 2, y: 2 } }));
    const mask = lastSetSelectionMask();
    expect(mask[10 * DOC_W + 10]).toBe(255); // prior selection kept
    expect(mask[2 * DOC_W + 2]).toBe(255); // red region added
  });

  it('subtract mode removes the clicked region from a prior selection', () => {
    ts.settings.quickSelect.mode = 'subtract';
    const prior = new Uint8ClampedArray(DOC_W * DOC_H).fill(255);
    editorState.selection = {
      active: true,
      mask: prior,
      bounds: { x: 0, y: 0, width: DOC_W, height: DOC_H },
      maskWidth: DOC_W,
      maskHeight: DOC_H,
    };
    handleQuickSelectDown(makeCtx({ canvasPos: { x: 2, y: 2 } }));
    const [bounds, mask] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
    ];
    expect(mask[2 * DOC_W + 2]).toBe(0); // red region removed
    expect(mask[10 * DOC_W + 10]).toBe(255); // blue region still selected
    expect(bounds).toEqual({ x: 0, y: 6, width: DOC_W, height: 6 });
  });

  it('clears the selection when subtracting leaves nothing', () => {
    ts.settings.quickSelect.mode = 'subtract';
    const prior = new Uint8ClampedArray(DOC_W * DOC_H);
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < DOC_W; x++) prior[y * DOC_W + x] = 255;
    }
    editorState.selection = {
      active: true,
      mask: prior,
      bounds: { x: 0, y: 0, width: DOC_W, height: 6 },
      maskWidth: DOC_W,
      maskHeight: DOC_H,
    };
    handleQuickSelectDown(makeCtx({ canvasPos: { x: 2, y: 2 } }));
    expect(editorState.clearSelection).toHaveBeenCalledTimes(1);
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });
});

describe('quick select move', () => {
  it('grows the stroke mask into newly visited regions', () => {
    handleQuickSelectDown(makeCtx({ canvasPos: { x: 2, y: 2 } }));
    editorState.setSelection.mockClear();
    handleQuickSelectMove(makeState(), { x: 2, y: 9 });
    __flushQuickSelectStrokeForTest();
    const mask = lastSetSelectionMask();
    expect(mask[2 * DOC_W + 2]).toBe(255); // red band from the down
    expect(mask[9 * DOC_W + 2]).toBe(255); // blue band from the move
  });

  it('does nothing without an active session', () => {
    handleQuickSelectMove(makeState(), { x: 5, y: 5 });
    __flushQuickSelectStrokeForTest();
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });

  it('does nothing after the stroke is finished', () => {
    handleQuickSelectDown(makeCtx());
    handleQuickSelectUp();
    editorState.setSelection.mockClear();
    handleQuickSelectMove(makeState(), { x: 2, y: 9 });
    __flushQuickSelectStrokeForTest();
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });

  // Regression for #643: applyQuickSelectStroke does full-doc CPU work
  // per invocation. Coalescing many pointer-moves within a single
  // animation frame collapses that to one stroke pass per frame.
  it('coalesces multiple mid-frame moves into a single stroke pass', () => {
    handleQuickSelectDown(makeCtx({ canvasPos: { x: 2, y: 2 } }));
    editorState.setSelection.mockClear();
    handleQuickSelectMove(makeState(), { x: 2, y: 7 });
    handleQuickSelectMove(makeState(), { x: 2, y: 8 });
    handleQuickSelectMove(makeState(), { x: 2, y: 9 });
    // Nothing has fired yet — all points sit in the pending buffer.
    expect(editorState.setSelection).not.toHaveBeenCalled();
    __flushQuickSelectStrokeForTest();
    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    const mask = lastSetSelectionMask();
    expect(mask[9 * DOC_W + 2]).toBe(255);
  });

  it('flushes any pending stroke on pointer-up so the last move is not dropped', () => {
    handleQuickSelectDown(makeCtx({ canvasPos: { x: 2, y: 2 } }));
    editorState.setSelection.mockClear();
    handleQuickSelectMove(makeState(), { x: 2, y: 9 });
    handleQuickSelectUp();
    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    const mask = lastSetSelectionMask();
    expect(mask[9 * DOC_W + 2]).toBe(255);
  });
});
