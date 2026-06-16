import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const applyBrushDab = vi.fn();

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  applyBrushDab: (...args: unknown[]) => applyBrushDab(...args),
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
  settings: {
    spray: { size: 40, density: 12, opacity: 60, hardness: 30 },
  },
  foregroundColor: { r: 255, g: 0, b: 0, a: 1 },
  addRecentColor: vi.fn(),
};
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => ts },
}));

import { handleSprayDown, handleSprayMove, handleSprayUp } from './spray-interaction';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';

function makeCtx(overrides: Partial<InteractionContext> = {}): InteractionContext {
  const layer = { id: 'layer-1', x: 0, y: 0, visible: true } as unknown as InteractionContext['activeLayer'];
  return {
    canvasPos: { x: 100, y: 100 },
    layerPos: { x: 100, y: 100 },
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

beforeEach(() => {
  vi.useFakeTimers();
  engine = { __engine: 'mock' };
  applyBrushDab.mockClear();
  editorState.pushHistory.mockClear();
  editorState.notifyRender.mockClear();
  ts.addRecentColor.mockClear();
  ts.foregroundColor = { r: 255, g: 0, b: 0, a: 1 };
  ts.settings = { spray: { size: 40, density: 12, opacity: 60, hardness: 30 } };
});

afterEach(() => {
  // Always stop the module-level interval so it cannot leak across tests.
  handleSprayUp();
  vi.useRealTimers();
});

describe('spray down', () => {
  it('pushes history and immediately emits one dab per density unit', () => {
    const state = handleSprayDown(makeCtx());
    expect(editorState.pushHistory).toHaveBeenCalledWith('Spray');
    expect(ts.addRecentColor).toHaveBeenCalledWith({ r: 255, g: 0, b: 0, a: 1 });
    expect(applyBrushDab).toHaveBeenCalledTimes(12);
    expect(state?.tool).toBe('spray');
    expect(state?.lastPoint).toEqual({ x: 100, y: 100 });
    expect(state?.strokeColor).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('scatters dabs within the brush radius around the cursor', () => {
    handleSprayDown(makeCtx({ layerPos: { x: 100, y: 100 } }));
    const brushRadius = ts.settings.spray.size / 2;
    for (const call of applyBrushDab.mock.calls) {
      const x = call[2] as number;
      const y = call[3] as number;
      const dist = Math.hypot(x - 100, y - 100);
      expect(dist).toBeLessThanOrEqual(brushRadius + 0.001);
    }
  });

  it('passes normalized color, hardness and capped opacity to each dab', () => {
    handleSprayDown(makeCtx());
    for (const call of applyBrushDab.mock.calls) {
      expect(call[5]).toBeCloseTo(0.3); // hardness 30%
      expect(call[6]).toBe(1); // r
      expect(call[7]).toBe(0); // g
      expect(call[8]).toBe(0); // b
      expect(call[9]).toBe(1); // a
      const opacity = call[10] as number;
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThanOrEqual(0.6); // base opacity 60%
    }
  });

  it('keeps spraying at the cursor while the pointer is held still', () => {
    handleSprayDown(makeCtx());
    applyBrushDab.mockClear();
    vi.advanceTimersByTime(166);
    expect(applyBrushDab).toHaveBeenCalledTimes(12);
    vi.advanceTimersByTime(166 * 2);
    expect(applyBrushDab).toHaveBeenCalledTimes(36);
  });

  it('returns a state without dabs or timer when no engine is available', () => {
    engine = null;
    const state = handleSprayDown(makeCtx());
    expect(state?.tool).toBe('spray');
    expect(applyBrushDab).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(applyBrushDab).not.toHaveBeenCalled();
  });
});

describe('spray move', () => {
  it('emits dab clusters along the drag path', () => {
    const state = handleSprayDown(makeCtx({ layerPos: { x: 0, y: 0 } }))!;
    applyBrushDab.mockClear();
    // spacing = size * 0.3 = 12; a 36px drag => 3 interpolation steps
    handleSprayMove(makeCtx({ layerPos: { x: 36, y: 0 } }), state);
    expect(applyBrushDab).toHaveBeenCalledTimes(3 * 12);
    expect(state.lastPoint).toEqual({ x: 36, y: 0 });
  });

  it('a short move only advances the anchor without spraying', () => {
    const state = handleSprayDown(makeCtx({ layerPos: { x: 0, y: 0 } }))!;
    applyBrushDab.mockClear();
    handleSprayMove(makeCtx({ layerPos: { x: 5, y: 0 } }), state);
    expect(applyBrushDab).not.toHaveBeenCalled();
    expect(state.lastPoint).toEqual({ x: 5, y: 0 });
  });

  it('keeps using the color captured at stroke start', () => {
    const state = handleSprayDown(makeCtx({ layerPos: { x: 0, y: 0 } }))!;
    applyBrushDab.mockClear();
    ts.foregroundColor = { r: 0, g: 255, b: 0, a: 1 };
    handleSprayMove(makeCtx({ layerPos: { x: 36, y: 0 } }), state);
    expect(applyBrushDab.mock.calls[0]![6]).toBe(1); // still red
    expect(applyBrushDab.mock.calls[0]![7]).toBe(0);
  });

  it('does nothing when the stroke has no layer', () => {
    const state = handleSprayDown(makeCtx({ layerPos: { x: 0, y: 0 } }))!;
    applyBrushDab.mockClear();
    handleSprayMove(makeCtx({ layerPos: { x: 36, y: 0 } }), { ...state, layerId: null } as InteractionState);
    expect(applyBrushDab).not.toHaveBeenCalled();
  });
});

describe('spray up', () => {
  it('stops the held-position spray timer', () => {
    handleSprayDown(makeCtx());
    applyBrushDab.mockClear();
    handleSprayUp();
    vi.advanceTimersByTime(166 * 5);
    expect(applyBrushDab).not.toHaveBeenCalled();
  });

  it('a new stroke after up restarts the interval spray', () => {
    handleSprayDown(makeCtx());
    handleSprayUp();
    handleSprayDown(makeCtx());
    applyBrushDab.mockClear();
    vi.advanceTimersByTime(166);
    expect(applyBrushDab).toHaveBeenCalledTimes(12);
  });
});
