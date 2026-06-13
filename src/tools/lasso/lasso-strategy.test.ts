import { describe, it, expect, vi, beforeEach } from 'vitest';

// The strategy graph (selection-handlers) imports every selection strategy,
// so the wasm-bridge mock must cover all names in that import graph. The
// selection-mask builders throw so selection-handlers falls back to the
// pure TS implementations — the test asserts on real mask contents.
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
    hasFloat: vi.fn(() => false),
    dropFloat: vi.fn(),
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
  getEngine: () => null,
}));

const editorState = {
  document: { width: 12, height: 12, layers: [] as unknown[] },
  selection: { active: false, mask: null, bounds: null, maskWidth: 0, maskHeight: 0 },
  setSelection: vi.fn(),
  clearSelection: vi.fn(),
  notifyRender: vi.fn(),
};
vi.mock('../../app/editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

const uiState = {
  lassoPoints: [] as Array<{ x: number; y: number }>,
  setLassoPoints: vi.fn((pts: Array<{ x: number; y: number }>) => { uiState.lassoPoints = pts; }),
  clearLassoPoints: vi.fn(() => { uiState.lassoPoints = []; }),
  setTransform: vi.fn(),
};
vi.mock('../../app/ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

const ts = {
  settings: { marquee: { feather: 0 }, wand: { tolerance: 32, contiguous: true, graduated: false } },
  aspectRatioLocked: false,
  aspectRatioW: 1,
  aspectRatioH: 1,
};
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => ts },
}));

import { lassoStrategy } from './lasso-strategy';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { SelectionUpContext } from '../../app/interactions/selection-strategy';

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
    lastPoint: null,
    layerId: 'layer-1',
    tool: 'lasso',
    startPoint: { x: 2, y: 2 },
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    ...overrides,
  };
}

const upCtx: SelectionUpContext = {
  screenToCanvas: (sx, sy) => ({ x: sx, y: sy }),
  containerRef: { current: null },
  event: { clientX: 0, clientY: 0 },
};

describe('lasso strategy', () => {
  beforeEach(() => {
    uiState.lassoPoints = [];
    uiState.setLassoPoints.mockClear();
    uiState.clearLassoPoints.mockClear();
    uiState.setTransform.mockClear();
    editorState.setSelection.mockClear();
    editorState.clearSelection.mockClear();
    ts.settings.marquee.feather = 0;
  });

  it('onDown starts the lasso trace at the click point', () => {
    const state = lassoStrategy.onDown(makeCtx({ canvasPos: { x: 3, y: 4 } }), 'lasso');
    expect(uiState.setLassoPoints).toHaveBeenCalledWith([{ x: 3, y: 4 }]);
    expect(state).toMatchObject({
      drawing: true,
      tool: 'lasso',
      startPoint: { x: 3, y: 4 },
      layerStartX: 0,
      layerStartY: 0,
    });
  });

  it('onMove appends the cursor position to the trace', () => {
    lassoStrategy.onDown(makeCtx({ canvasPos: { x: 1, y: 1 } }), 'lasso');
    lassoStrategy.onMove!(makeState(), { x: 5, y: 1 }, false);
    lassoStrategy.onMove!(makeState(), { x: 5, y: 5 }, false);
    expect(uiState.lassoPoints).toEqual([
      { x: 1, y: 1 },
      { x: 5, y: 1 },
      { x: 5, y: 5 },
    ]);
  });

  it('onUp with a triangle commits a polygon selection mask', () => {
    uiState.lassoPoints = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
    ];
    lassoStrategy.onUp!(makeState(), { x: 8, y: 8 }, upCtx);
    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    const [bounds, mask, w, h] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
      number,
      number,
    ];
    expect(w).toBe(12);
    expect(h).toBe(12);
    // Inside the triangle (below the diagonal x >= y).
    expect(mask[2 * 12 + 6]).toBe(255);
    // Outside the triangle (above the diagonal).
    expect(mask[6 * 12 + 1]).toBe(0);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.width).toBeGreaterThan(0);
    expect(uiState.clearLassoPoints).toHaveBeenCalledTimes(1);
  });

  it('onUp with fewer than 3 points does not create a selection', () => {
    uiState.lassoPoints = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ];
    lassoStrategy.onUp!(makeState(), { x: 5, y: 5 }, upCtx);
    expect(editorState.setSelection).not.toHaveBeenCalled();
    expect(uiState.clearLassoPoints).toHaveBeenCalledTimes(1);
  });

  it('onUp with a degenerate (zero-area) polygon clears the trace without selecting', () => {
    uiState.lassoPoints = [
      { x: 2, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 2 },
    ];
    lassoStrategy.onUp!(makeState(), { x: 2, y: 2 }, upCtx);
    expect(editorState.setSelection).not.toHaveBeenCalled();
    expect(uiState.clearLassoPoints).toHaveBeenCalledTimes(1);
  });
});
