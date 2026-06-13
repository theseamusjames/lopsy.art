import { describe, it, expect, vi, beforeEach } from 'vitest';

const magneticLassoBegin = vi.fn();
const magneticLassoSnap = vi.fn();
const magneticLassoSnapPoint = vi.fn();
const magneticLassoEnd = vi.fn();

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
    hasFloat: vi.fn(() => false),
    dropFloat: vi.fn(),
    floodFill: vi.fn(),
    floodFillGraduated: vi.fn(),
    readLayerPixelsForFill: vi.fn(),
    magneticLassoBegin: (...args: unknown[]) => magneticLassoBegin(...args),
    magneticLassoSnap: (...args: unknown[]) => magneticLassoSnap(...args),
    magneticLassoSnapPoint: (...args: unknown[]) => magneticLassoSnapPoint(...args),
    magneticLassoEnd: (...args: unknown[]) => magneticLassoEnd(...args),
  };
});

let engine: { __engine: string } | null = { __engine: 'mock' };
vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => engine,
}));

const DOC_W = 12;
const DOC_H = 12;

const editorState = {
  document: { width: DOC_W, height: DOC_H, layers: [] as unknown[] },
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
  settings: {
    marquee: { feather: 0 },
    magneticLasso: { width: 10, contrast: 10, frequency: 100 },
  },
};
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => ts },
}));

import { magneticLassoStrategy } from './magnetic-lasso-strategy';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { SelectionUpContext } from '../../app/interactions/selection-strategy';

function makeCtx(overrides: Partial<InteractionContext> = {}): InteractionContext {
  const layer = { id: 'layer-1', x: 0, y: 0, visible: true } as unknown as InteractionContext['activeLayer'];
  return {
    canvasPos: { x: 0, y: 0 },
    layerPos: { x: 0, y: 0 },
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

function makeState(): InteractionState {
  return {
    drawing: true,
    lastPoint: { x: 0, y: 0 },
    layerId: 'layer-1',
    tool: 'lasso-magnetic',
    startPoint: { x: 0, y: 0 },
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

const upCtx: SelectionUpContext = {
  screenToCanvas: (sx, sy) => ({ x: sx, y: sy }),
  containerRef: { current: null },
  event: { clientX: 0, clientY: 0 },
};

/** Identity snap: a straight two-point segment, no edge attraction. */
function straightSnap(...args: unknown[]): Float32Array {
  const [, fromX, fromY, toX, toY] = args as [unknown, number, number, number, number];
  return new Float32Array([fromX, fromY, toX, toY]);
}

beforeEach(() => {
  engine = { __engine: 'mock' };
  magneticLassoBegin.mockReset();
  magneticLassoSnap.mockReset();
  magneticLassoSnapPoint.mockReset();
  magneticLassoEnd.mockClear();
  uiState.lassoPoints = [];
  uiState.setLassoPoints.mockClear();
  uiState.clearLassoPoints.mockClear();
  editorState.setSelection.mockClear();
  editorState.clearSelection.mockClear();
  ts.settings.magneticLasso = { width: 10, contrast: 10, frequency: 100 };
  magneticLassoSnap.mockImplementation(straightSnap);
  magneticLassoSnapPoint.mockImplementation((...args: unknown[]) => {
    const [, x, y] = args as [unknown, number, number];
    return new Float32Array([x, y]);
  });
  // Reset module-level trace state from any previous test.
  magneticLassoStrategy.onUp!(makeState(), { x: 0, y: 0 }, upCtx);
  magneticLassoEnd.mockClear();
  uiState.clearLassoPoints.mockClear();
  editorState.setSelection.mockClear();
  uiState.setLassoPoints.mockClear();
});

describe('magnetic lasso onDown', () => {
  it('returns undefined when no engine is available', () => {
    engine = null;
    expect(magneticLassoStrategy.onDown(makeCtx(), 'lasso-magnetic')).toBeUndefined();
    expect(magneticLassoBegin).not.toHaveBeenCalled();
  });

  it('returns undefined when the engine cannot begin a trace', () => {
    magneticLassoBegin.mockImplementation(() => {
      throw new Error('no layer');
    });
    expect(magneticLassoStrategy.onDown(makeCtx(), 'lasso-magnetic')).toBeUndefined();
  });

  it('begins a trace on the active layer with the start snapped to an edge', () => {
    magneticLassoSnapPoint.mockReturnValue(new Float32Array([3, 4]));
    const state = magneticLassoStrategy.onDown(makeCtx({ canvasPos: { x: 1, y: 1 } }), 'lasso-magnetic');
    expect(magneticLassoBegin.mock.calls[0]![1]).toBe('layer-1');
    expect(uiState.setLassoPoints).toHaveBeenCalledWith([{ x: 3, y: 4 }]);
    expect(state).toMatchObject({ drawing: true, tool: 'lasso-magnetic', startPoint: { x: 1, y: 1 } });
  });

  it('converts the contrast setting into a 1..255 threshold for the snapper', () => {
    ts.settings.magneticLasso = { ...ts.settings.magneticLasso, contrast: 10 };
    magneticLassoStrategy.onDown(makeCtx(), 'lasso-magnetic');
    // round(10 * 2.55) = 26
    expect(magneticLassoSnapPoint.mock.calls[0]![4]).toBe(26);
    expect(magneticLassoSnapPoint.mock.calls[0]![3]).toBe(10); // radius
  });

  it('falls back to the raw click point when snapping returns nothing', () => {
    magneticLassoSnapPoint.mockReturnValue(new Float32Array(0));
    magneticLassoStrategy.onDown(makeCtx({ canvasPos: { x: 5, y: 6 } }), 'lasso-magnetic');
    expect(uiState.setLassoPoints).toHaveBeenCalledWith([{ x: 5, y: 6 }]);
  });
});

describe('magnetic lasso onMove', () => {
  it('updates the live segment with the snapped polyline', () => {
    magneticLassoStrategy.onDown(makeCtx({ canvasPos: { x: 0, y: 0 } }), 'lasso-magnetic');
    magneticLassoStrategy.onMove!(makeState(), { x: 4, y: 0 }, false);
    expect(uiState.lassoPoints).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it('auto-anchors when the live segment grows past the frequency length', () => {
    ts.settings.magneticLasso = { ...ts.settings.magneticLasso, frequency: 5 };
    magneticLassoStrategy.onDown(makeCtx({ canvasPos: { x: 0, y: 0 } }), 'lasso-magnetic');
    magneticLassoStrategy.onMove!(makeState(), { x: 8, y: 0 }, false);
    // The 8px segment exceeds frequency 5, so an anchor is committed at the
    // cursor and the preview contains the committed segment.
    expect(uiState.lassoPoints).toEqual([
      { x: 0, y: 0 },
      { x: 8, y: 0 },
    ]);
    magneticLassoStrategy.onMove!(makeState(), { x: 8, y: 8 }, false);
    expect(uiState.lassoPoints).toEqual([
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
    ]);
  });

  it('does nothing when no trace is active', () => {
    magneticLassoStrategy.onMove!(makeState(), { x: 4, y: 4 }, false);
    expect(uiState.setLassoPoints).not.toHaveBeenCalled();
  });
});

describe('magnetic lasso onUp', () => {
  it('closes the loop and commits a polygon selection', () => {
    ts.settings.magneticLasso = { ...ts.settings.magneticLasso, frequency: 5 };
    magneticLassoStrategy.onDown(makeCtx({ canvasPos: { x: 0, y: 0 } }), 'lasso-magnetic');
    magneticLassoStrategy.onMove!(makeState(), { x: 8, y: 0 }, false);
    magneticLassoStrategy.onMove!(makeState(), { x: 8, y: 8 }, false);
    magneticLassoStrategy.onUp!(makeState(), { x: 8, y: 8 }, upCtx);

    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    const [bounds, mask, w, h] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
      number,
      number,
    ];
    expect(w).toBe(DOC_W);
    expect(h).toBe(DOC_H);
    // Triangle (0,0)-(8,0)-(8,8): inside is x >= y.
    expect(mask[2 * DOC_W + 6]).toBe(255);
    expect(mask[6 * DOC_W + 1]).toBe(0);
    expect(bounds.width).toBeGreaterThan(0);
    expect(magneticLassoEnd).toHaveBeenCalledTimes(1);
    expect(uiState.clearLassoPoints).toHaveBeenCalledTimes(1);
  });

  it('releases the engine trace without selecting when the loop is degenerate', () => {
    magneticLassoStrategy.onDown(makeCtx({ canvasPos: { x: 0, y: 0 } }), 'lasso-magnetic');
    magneticLassoStrategy.onUp!(makeState(), { x: 0, y: 0 }, upCtx);
    expect(editorState.setSelection).not.toHaveBeenCalled();
    expect(magneticLassoEnd).toHaveBeenCalledTimes(1);
    expect(uiState.clearLassoPoints).toHaveBeenCalledTimes(1);
  });

  it('a second onUp without a new trace only clears the preview', () => {
    magneticLassoStrategy.onDown(makeCtx(), 'lasso-magnetic');
    magneticLassoStrategy.onUp!(makeState(), { x: 0, y: 0 }, upCtx);
    magneticLassoEnd.mockClear();
    editorState.setSelection.mockClear();
    magneticLassoStrategy.onUp!(makeState(), { x: 0, y: 0 }, upCtx);
    expect(editorState.setSelection).not.toHaveBeenCalled();
    // engine end is still called defensively, but no commit happens
    expect(magneticLassoEnd).toHaveBeenCalledTimes(1);
  });
});
