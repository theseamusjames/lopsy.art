import { describe, it, expect, vi, beforeEach } from 'vitest';

const beginDodgeBurnStroke = vi.fn();
const applyDodgeBurnDabBatch = vi.fn();
const endDodgeBurnStroke = vi.fn();

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  beginDodgeBurnStroke: (...args: unknown[]) => beginDodgeBurnStroke(...args),
  applyDodgeBurnDabBatch: (...args: unknown[]) => applyDodgeBurnDabBatch(...args),
  endDodgeBurnStroke: (...args: unknown[]) => endDodgeBurnStroke(...args),
}));

let engine: { __engine: string } | null = { __engine: 'mock' };
vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => engine,
}));

const setPendingDodgeStroke = vi.fn();
const clearPendingDodgeStroke = vi.fn();
vi.mock('../../app/interactions/pending-stroke', () => ({
  setPendingDodgeStroke: (...args: unknown[]) => setPendingDodgeStroke(...args),
  clearPendingDodgeStroke: (...args: unknown[]) => clearPendingDodgeStroke(...args),
}));

const editorState = {
  pushHistory: vi.fn(),
  notifyRender: vi.fn(),
};
vi.mock('../../app/editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

const ts = {
  dodgeMode: 'dodge' as 'dodge' | 'burn',
  dodgeExposure: 50,
  brushSize: 20,
};
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => ts },
}));

import { handleDodgeDown, handleDodgeMove, handleDodgeUp } from './dodge-interaction';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';

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
    lastPoint: { x: 10, y: 10 },
    layerId: 'layer-1',
    tool: 'dodge',
    startPoint: null,
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    ...overrides,
  };
}

beforeEach(() => {
  engine = { __engine: 'mock' };
  beginDodgeBurnStroke.mockClear();
  applyDodgeBurnDabBatch.mockClear();
  endDodgeBurnStroke.mockClear();
  setPendingDodgeStroke.mockClear();
  clearPendingDodgeStroke.mockClear();
  editorState.pushHistory.mockClear();
  editorState.notifyRender.mockClear();
  ts.dodgeMode = 'dodge';
  ts.dodgeExposure = 50;
  ts.brushSize = 20;
});

describe('dodge down', () => {
  it('begins a dodge stroke and dabs once at the layer point', () => {
    const state = handleDodgeDown(makeCtx());
    expect(editorState.pushHistory).toHaveBeenCalledWith('Dodge');
    expect(beginDodgeBurnStroke).toHaveBeenCalledWith(expect.anything(), 'layer-1', 0);
    expect(setPendingDodgeStroke).toHaveBeenCalledWith('layer-1');
    const [, , pts, size, hardness, exposure] = applyDodgeBurnDabBatch.mock.calls[0]! as
      [unknown, string, Float64Array, number, number, number];
    expect(Array.from(pts)).toEqual([10, 10]);
    expect(size).toBe(20);
    expect(hardness).toBe(0.5);
    expect(exposure).toBeCloseTo(0.5);
    expect(state).toMatchObject({ drawing: true, tool: 'dodge', lastPoint: { x: 10, y: 10 } });
  });

  it('burn mode uses mode 1 and the Burn history label', () => {
    ts.dodgeMode = 'burn';
    handleDodgeDown(makeCtx());
    expect(editorState.pushHistory).toHaveBeenCalledWith('Burn');
    expect(beginDodgeBurnStroke).toHaveBeenCalledWith(expect.anything(), 'layer-1', 1);
  });

  it('shift-click connects from the last paint point on the same layer', () => {
    const ctx = makeCtx({
      shiftKey: true,
      layerPos: { x: 20, y: 0 },
      lastPaintPointRef: { current: { point: { x: 0, y: 0 }, layerId: 'layer-1' } },
    });
    handleDodgeDown(ctx);
    const pts = applyDodgeBurnDabBatch.mock.calls[0]![2] as Float64Array;
    // spacing = 20 * 0.25 = 5 over 20px => dabs at x = 5, 10, 15, 20
    expect(Array.from(pts)).toEqual([5, 0, 10, 0, 15, 0, 20, 0]);
  });

  it('shift-click from another layer dabs only at the click point', () => {
    const ctx = makeCtx({
      shiftKey: true,
      layerPos: { x: 20, y: 0 },
      lastPaintPointRef: { current: { point: { x: 0, y: 0 }, layerId: 'other' } },
    });
    handleDodgeDown(ctx);
    const pts = applyDodgeBurnDabBatch.mock.calls[0]![2] as Float64Array;
    expect(Array.from(pts)).toEqual([20, 0]);
  });

  it('returns a state without touching the GPU when no engine exists', () => {
    engine = null;
    const state = handleDodgeDown(makeCtx());
    expect(state.tool).toBe('dodge');
    expect(beginDodgeBurnStroke).not.toHaveBeenCalled();
    expect(applyDodgeBurnDabBatch).not.toHaveBeenCalled();
  });
});

describe('dodge move', () => {
  it('interpolates dabs at quarter-size spacing and advances lastPoint', () => {
    const state = makeState({ lastPoint: { x: 0, y: 0 } });
    handleDodgeMove(state, { x: 10, y: 0 });
    const pts = applyDodgeBurnDabBatch.mock.calls[0]![2] as Float64Array;
    expect(Array.from(pts)).toEqual([5, 0, 10, 0]);
    expect(state.lastPoint).toEqual({ x: 10, y: 0 });
  });

  it('passes the current exposure setting on every move', () => {
    ts.dodgeExposure = 80;
    handleDodgeMove(makeState({ lastPoint: { x: 0, y: 0 } }), { x: 10, y: 0 });
    expect(applyDodgeBurnDabBatch.mock.calls[0]![5]).toBeCloseTo(0.8);
  });

  it('does nothing without a lastPoint', () => {
    handleDodgeMove(makeState({ lastPoint: null }), { x: 10, y: 0 });
    expect(applyDodgeBurnDabBatch).not.toHaveBeenCalled();
  });
});

describe('dodge up', () => {
  it('ends the stroke and clears the pending registry', () => {
    handleDodgeUp(makeState());
    expect(endDodgeBurnStroke).toHaveBeenCalledWith(expect.anything(), 'layer-1');
    expect(clearPendingDodgeStroke).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a layer id', () => {
    handleDodgeUp(makeState({ layerId: null }));
    expect(endDodgeBurnStroke).not.toHaveBeenCalled();
  });

  it('does nothing without an engine', () => {
    engine = null;
    handleDodgeUp(makeState());
    expect(endDodgeBurnStroke).not.toHaveBeenCalled();
    expect(clearPendingDodgeStroke).not.toHaveBeenCalled();
  });
});
