import { describe, it, expect, vi, beforeEach } from 'vitest';

const beginSpongeStroke = vi.fn();
const applySpongeDabBatch = vi.fn();
const endSpongeStroke = vi.fn();

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  beginSpongeStroke: (...args: unknown[]) => beginSpongeStroke(...args),
  applySpongeDabBatch: (...args: unknown[]) => applySpongeDabBatch(...args),
  endSpongeStroke: (...args: unknown[]) => endSpongeStroke(...args),
}));

let engine: { __engine: string } | null = { __engine: 'mock' };
vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => engine,
}));

const setPendingSpongeStroke = vi.fn();
const clearPendingSpongeStroke = vi.fn();
vi.mock('../../app/interactions/pending-stroke', () => ({
  setPendingSpongeStroke: (...args: unknown[]) => setPendingSpongeStroke(...args),
  clearPendingSpongeStroke: (...args: unknown[]) => clearPendingSpongeStroke(...args),
}));

const editorState = {
  pushHistory: vi.fn(),
  notifyRender: vi.fn(),
};
vi.mock('../../app/editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

const ts = {
  settings: { sponge: { mode: 'saturate' as 'saturate' | 'desaturate', strength: 100, size: 40 } },
};
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => ts },
}));

import { handleSpongeDown, handleSpongeMove, handleSpongeUp } from './sponge-interaction';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';

function makeCtx(overrides: Partial<InteractionContext> = {}): InteractionContext {
  const layer = { id: 'layer-1', x: 5, y: 7, visible: true } as unknown as InteractionContext['activeLayer'];
  return {
    canvasPos: { x: 20, y: 20 },
    layerPos: { x: 15, y: 13 },
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
    lastPoint: { x: 15, y: 13 },
    layerId: 'layer-1',
    tool: 'sponge',
    startPoint: null,
    layerStartX: 5,
    layerStartY: 7,
    ...DEFAULT_TRANSFORM_FIELDS,
    ...overrides,
  };
}

beforeEach(() => {
  engine = { __engine: 'mock' };
  beginSpongeStroke.mockClear();
  applySpongeDabBatch.mockClear();
  endSpongeStroke.mockClear();
  setPendingSpongeStroke.mockClear();
  clearPendingSpongeStroke.mockClear();
  editorState.pushHistory.mockClear();
  editorState.notifyRender.mockClear();
  ts.settings.sponge = { mode: 'saturate', strength: 100, size: 40 };
});

describe('sponge down', () => {
  it('begins a saturate stroke and applies a single dab at the layer point', () => {
    const state = handleSpongeDown(makeCtx());
    expect(editorState.pushHistory).toHaveBeenCalledWith('Saturate');
    expect(beginSpongeStroke).toHaveBeenCalledWith(expect.anything(), 'layer-1', 0);
    expect(setPendingSpongeStroke).toHaveBeenCalledWith('layer-1');
    const [, , pts, size, hardness, strength] = applySpongeDabBatch.mock.calls[0]! as
      [unknown, string, Float64Array, number, number, number];
    expect(Array.from(pts)).toEqual([15, 13]);
    expect(size).toBe(40);
    expect(hardness).toBe(0.5);
    // strength = (100/100)^2 * 0.25
    expect(strength).toBeCloseTo(0.25);
    expect(state).toMatchObject({
      drawing: true,
      tool: 'sponge',
      lastPoint: { x: 15, y: 13 },
      layerStartX: 5,
      layerStartY: 7,
    });
  });

  it('uses mode 1 and a Desaturate history label in desaturate mode', () => {
    ts.settings.sponge.mode = 'desaturate';
    handleSpongeDown(makeCtx());
    expect(editorState.pushHistory).toHaveBeenCalledWith('Desaturate');
    expect(beginSpongeStroke).toHaveBeenCalledWith(expect.anything(), 'layer-1', 1);
  });

  it('squares the strength setting (50% => 6.25% effective)', () => {
    ts.settings.sponge.strength = 50;
    handleSpongeDown(makeCtx());
    const strength = applySpongeDabBatch.mock.calls[0]![5] as number;
    expect(strength).toBeCloseTo(0.5 * 0.5 * 0.25);
  });

  it('shift-click draws a connecting line from the last paint point', () => {
    const ctx = makeCtx({
      shiftKey: true,
      layerPos: { x: 100, y: 0 },
      lastPaintPointRef: { current: { point: { x: 0, y: 0 }, layerId: 'layer-1' } },
    });
    handleSpongeDown(ctx);
    const pts = applySpongeDabBatch.mock.calls[0]![2] as Float64Array;
    // spacing = 40 * 0.25 = 10 over a 100px line => 10 interpolated dabs
    expect(pts.length).toBe(20);
    expect(pts[0]).toBeCloseTo(10);
    expect(pts[pts.length - 2]).toBeCloseTo(100);
    expect(pts[pts.length - 1]).toBeCloseTo(0);
  });

  it('shift-click on a different layer falls back to a single dab', () => {
    const ctx = makeCtx({
      shiftKey: true,
      layerPos: { x: 100, y: 0 },
      lastPaintPointRef: { current: { point: { x: 0, y: 0 }, layerId: 'other-layer' } },
    });
    handleSpongeDown(ctx);
    const pts = applySpongeDabBatch.mock.calls[0]![2] as Float64Array;
    expect(Array.from(pts)).toEqual([100, 0]);
  });

  it('still returns an interaction state when no engine is available', () => {
    engine = null;
    const state = handleSpongeDown(makeCtx());
    expect(state.drawing).toBe(true);
    expect(beginSpongeStroke).not.toHaveBeenCalled();
    expect(setPendingSpongeStroke).not.toHaveBeenCalled();
  });
});

describe('sponge move', () => {
  it('interpolates dabs from the previous point and advances lastPoint', () => {
    const state = makeState({ lastPoint: { x: 0, y: 0 } });
    handleSpongeMove(state, { x: 30, y: 0 });
    const pts = applySpongeDabBatch.mock.calls[0]![2] as Float64Array;
    // spacing 10 over 30px => 3 dabs at x = 10, 20, 30
    expect(Array.from(pts)).toEqual([10, 0, 20, 0, 30, 0]);
    expect(state.lastPoint).toEqual({ x: 30, y: 0 });
    expect(editorState.notifyRender).toHaveBeenCalled();
  });

  it('emits the destination dab even for a short move', () => {
    const state = makeState({ lastPoint: { x: 0, y: 0 } });
    handleSpongeMove(state, { x: 2, y: 0 });
    const pts = applySpongeDabBatch.mock.calls[0]![2] as Float64Array;
    expect(Array.from(pts)).toEqual([2, 0]);
  });

  it('does nothing without a lastPoint', () => {
    handleSpongeMove(makeState({ lastPoint: null }), { x: 30, y: 0 });
    expect(applySpongeDabBatch).not.toHaveBeenCalled();
  });

  it('skips the GPU call but tracks the point when no engine is available', () => {
    engine = null;
    const state = makeState({ lastPoint: { x: 0, y: 0 } });
    handleSpongeMove(state, { x: 30, y: 0 });
    expect(applySpongeDabBatch).not.toHaveBeenCalled();
    expect(state.lastPoint).toEqual({ x: 30, y: 0 });
  });
});

describe('sponge up', () => {
  it('ends the stroke and clears the pending-stroke registry', () => {
    handleSpongeUp(makeState());
    expect(endSpongeStroke).toHaveBeenCalledWith(expect.anything(), 'layer-1');
    expect(clearPendingSpongeStroke).toHaveBeenCalledTimes(1);
    expect(editorState.notifyRender).toHaveBeenCalled();
  });

  it('does nothing without a layer id', () => {
    handleSpongeUp(makeState({ layerId: null }));
    expect(endSpongeStroke).not.toHaveBeenCalled();
    expect(clearPendingSpongeStroke).not.toHaveBeenCalled();
  });

  it('does nothing without an engine', () => {
    engine = null;
    handleSpongeUp(makeState());
    expect(endSpongeStroke).not.toHaveBeenCalled();
    expect(clearPendingSpongeStroke).not.toHaveBeenCalled();
  });
});
