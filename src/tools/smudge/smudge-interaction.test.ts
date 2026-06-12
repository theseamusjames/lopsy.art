import { describe, it, expect, vi, beforeEach } from 'vitest';

const applySmudgeDab = vi.fn();
const applySmudgeDabBatch = vi.fn();

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  applySmudgeDab: (...args: unknown[]) => applySmudgeDab(...args),
  applySmudgeDabBatch: (...args: unknown[]) => applySmudgeDabBatch(...args),
}));

let engine: { __engine: string } | null = { __engine: 'mock' };
vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => engine,
}));

const editorState = {
  pushHistory: vi.fn(),
  notifyRender: vi.fn(),
};
vi.mock('../../app/editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

const ts = {
  settings: { smudge: { size: 40, strength: 50 } },
};
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => ts },
}));

import { handleSmudgeDown, handleSmudgeMove } from './smudge-interaction';
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
    tool: 'smudge',
    startPoint: null,
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    ...overrides,
  };
}

beforeEach(() => {
  engine = { __engine: 'mock' };
  applySmudgeDab.mockClear();
  applySmudgeDabBatch.mockClear();
  editorState.pushHistory.mockClear();
  editorState.notifyRender.mockClear();
  ts.settings.smudge = { size: 40, strength: 50 };
});

describe('smudge down', () => {
  it('applies a no-op first dab where prev equals current position', () => {
    const state = handleSmudgeDown(makeCtx({ layerPos: { x: 12, y: 34 } }));
    expect(editorState.pushHistory).toHaveBeenCalledWith('Smudge');
    expect(applySmudgeDab).toHaveBeenCalledTimes(1);
    const args = applySmudgeDab.mock.calls[0]!;
    // (engine, layerId, prevX, prevY, x, y, size, strength)
    expect(args[2]).toBe(12);
    expect(args[3]).toBe(34);
    expect(args[4]).toBe(12);
    expect(args[5]).toBe(34);
    expect(args[6]).toBe(40);
    expect(args[7]).toBeCloseTo(0.5);
    expect(state).toMatchObject({ drawing: true, tool: 'smudge', lastPoint: { x: 12, y: 34 } });
  });

  it('shift-click pulls the smudge along the full line from the last paint point', () => {
    const ctx = makeCtx({
      shiftKey: true,
      layerPos: { x: 20, y: 0 },
      lastPaintPointRef: { current: { point: { x: 0, y: 0 }, layerId: 'layer-1' } },
    });
    handleSmudgeDown(ctx);
    expect(applySmudgeDab).not.toHaveBeenCalled();
    const pts = applySmudgeDabBatch.mock.calls[0]![2] as Float64Array;
    // Leading pair is the stroke origin, then dabs at spacing 10: x=10, 20.
    expect(Array.from(pts)).toEqual([0, 0, 10, 0, 20, 0]);
  });

  it('shift-click from another layer behaves like a fresh dab', () => {
    const ctx = makeCtx({
      shiftKey: true,
      layerPos: { x: 20, y: 0 },
      lastPaintPointRef: { current: { point: { x: 0, y: 0 }, layerId: 'other' } },
    });
    handleSmudgeDown(ctx);
    expect(applySmudgeDab).toHaveBeenCalledTimes(1);
    expect(applySmudgeDabBatch).not.toHaveBeenCalled();
  });

  it('returns a state without painting when no engine is available', () => {
    engine = null;
    const state = handleSmudgeDown(makeCtx());
    expect(state.tool).toBe('smudge');
    expect(applySmudgeDab).not.toHaveBeenCalled();
    expect(editorState.notifyRender).not.toHaveBeenCalled();
  });
});

describe('smudge move', () => {
  it('prepends the previous point so the smudge drags continuously', () => {
    const state = makeState({ lastPoint: { x: 0, y: 0 } });
    handleSmudgeMove(state, { x: 30, y: 0 });
    const pts = applySmudgeDabBatch.mock.calls[0]![2] as Float64Array;
    expect(Array.from(pts)).toEqual([0, 0, 10, 0, 20, 0, 30, 0]);
    expect(state.lastPoint).toEqual({ x: 30, y: 0 });
    expect(editorState.notifyRender).toHaveBeenCalled();
  });

  it('short moves still carry the prev point plus the destination', () => {
    const state = makeState({ lastPoint: { x: 5, y: 5 } });
    handleSmudgeMove(state, { x: 7, y: 5 });
    const pts = applySmudgeDabBatch.mock.calls[0]![2] as Float64Array;
    expect(Array.from(pts)).toEqual([5, 5, 7, 5]);
  });

  it('passes the strength as a 0..1 fraction', () => {
    ts.settings.smudge.strength = 80;
    handleSmudgeMove(makeState({ lastPoint: { x: 0, y: 0 } }), { x: 10, y: 0 });
    expect(applySmudgeDabBatch.mock.calls[0]![4]).toBeCloseTo(0.8);
  });

  it('does nothing without a lastPoint', () => {
    handleSmudgeMove(makeState({ lastPoint: null }), { x: 10, y: 0 });
    expect(applySmudgeDabBatch).not.toHaveBeenCalled();
  });

  it('tracks the point without painting when no engine is available', () => {
    engine = null;
    const state = makeState({ lastPoint: { x: 0, y: 0 } });
    handleSmudgeMove(state, { x: 10, y: 0 });
    expect(applySmudgeDabBatch).not.toHaveBeenCalled();
    expect(state.lastPoint).toEqual({ x: 10, y: 0 });
  });
});
