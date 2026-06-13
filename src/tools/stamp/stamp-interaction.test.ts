import { describe, it, expect, vi, beforeEach } from 'vitest';

const applyStampDab = vi.fn();
const applyStampDabBatch = vi.fn();

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  applyStampDab: (...args: unknown[]) => applyStampDab(...args),
  applyStampDabBatch: (...args: unknown[]) => applyStampDabBatch(...args),
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
  settings: { stamp: { size: 40 } },
};
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => ts },
}));

import { handleStampDown, handleStampMove } from './stamp-interaction';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';

function makeCtx(overrides: Partial<InteractionContext> = {}): InteractionContext {
  const layer = { id: 'layer-1', x: 0, y: 0, visible: true } as unknown as InteractionContext['activeLayer'];
  return {
    canvasPos: { x: 50, y: 50 },
    layerPos: { x: 50, y: 50 },
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
    stampSourceRef: { current: null as Point | null },
    stampOffsetRef: { current: null as Point | null },
    lastPaintPointRef: { current: null },
    ...overrides,
  };
}

function makeState(overrides: Partial<InteractionState> = {}): InteractionState {
  return {
    drawing: true,
    lastPoint: { x: 50, y: 50 },
    layerId: 'layer-1',
    tool: 'stamp',
    startPoint: { x: 50, y: 50 },
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    ...overrides,
  };
}

beforeEach(() => {
  engine = { __engine: 'mock' };
  applyStampDab.mockClear();
  applyStampDabBatch.mockClear();
  editorState.pushHistory.mockClear();
  editorState.notifyRender.mockClear();
  ts.settings.stamp.size = 40;
});

describe('stamp down — source picking', () => {
  it('alt-click records the source point without painting', () => {
    const ctx = makeCtx({ altKey: true, layerPos: { x: 10, y: 20 } });
    const result = handleStampDown(ctx);
    expect(result).toBeUndefined();
    expect(ctx.stampSourceRef.current).toEqual({ x: 10, y: 20 });
    expect(ctx.stampOffsetRef.current).toBeNull();
    expect(applyStampDab).not.toHaveBeenCalled();
    expect(editorState.pushHistory).not.toHaveBeenCalled();
  });

  it('meta-click also records the source point', () => {
    const ctx = makeCtx({ metaKey: true, layerPos: { x: 3, y: 4 } });
    handleStampDown(ctx);
    expect(ctx.stampSourceRef.current).toEqual({ x: 3, y: 4 });
  });

  it('re-picking the source resets a previously locked offset', () => {
    const ctx = makeCtx({
      altKey: true,
      layerPos: { x: 1, y: 1 },
      stampOffsetRef: { current: { x: -5, y: -5 } },
    });
    handleStampDown(ctx);
    expect(ctx.stampOffsetRef.current).toBeNull();
  });

  it('painting without a source does nothing', () => {
    const result = handleStampDown(makeCtx());
    expect(result).toBeUndefined();
    expect(applyStampDab).not.toHaveBeenCalled();
    expect(editorState.pushHistory).not.toHaveBeenCalled();
  });
});

describe('stamp down — painting', () => {
  it('first paint click locks the offset as source minus click and dabs once', () => {
    const ctx = makeCtx({
      layerPos: { x: 50, y: 60 },
      stampSourceRef: { current: { x: 10, y: 20 } },
    });
    const state = handleStampDown(ctx);
    expect(editorState.pushHistory).toHaveBeenCalledWith('Clone Stamp');
    expect(ctx.stampOffsetRef.current).toEqual({ x: -40, y: -40 });
    expect(applyStampDab).toHaveBeenCalledTimes(1);
    const args = applyStampDab.mock.calls[0]!;
    // (engine, layerId, x, y, offsetX, offsetY, size)
    expect(args[1]).toBe('layer-1');
    expect(args[2]).toBe(50);
    expect(args[3]).toBe(60);
    expect(args[4]).toBe(-40);
    expect(args[5]).toBe(-40);
    expect(args[6]).toBe(40);
    expect(state).toMatchObject({ drawing: true, tool: 'stamp', startPoint: { x: 50, y: 60 } });
  });

  it('subsequent clicks reuse the locked offset instead of recomputing it', () => {
    const ctx = makeCtx({
      layerPos: { x: 80, y: 80 },
      stampSourceRef: { current: { x: 10, y: 20 } },
      stampOffsetRef: { current: { x: -40, y: -40 } },
    });
    handleStampDown(ctx);
    expect(ctx.stampOffsetRef.current).toEqual({ x: -40, y: -40 });
    const args = applyStampDab.mock.calls[0]!;
    expect(args[4]).toBe(-40);
    expect(args[5]).toBe(-40);
  });

  it('shift-click clones along a line from the last paint point', () => {
    const ctx = makeCtx({
      shiftKey: true,
      layerPos: { x: 20, y: 0 },
      stampSourceRef: { current: { x: 0, y: 0 } },
      stampOffsetRef: { current: { x: -5, y: -5 } },
      lastPaintPointRef: { current: { point: { x: 0, y: 0 }, layerId: 'layer-1' } },
    });
    handleStampDown(ctx);
    expect(applyStampDab).not.toHaveBeenCalled();
    expect(applyStampDabBatch).toHaveBeenCalledTimes(1);
    const [, , pts, ox, oy, size] = applyStampDabBatch.mock.calls[0]! as
      [unknown, string, Float64Array, number, number, number];
    // spacing = 40 * 0.25 = 10 over 20px => dabs at x = 10, 20
    expect(Array.from(pts)).toEqual([10, 0, 20, 0]);
    expect(ox).toBe(-5);
    expect(oy).toBe(-5);
    expect(size).toBe(40);
  });

  it('returns a state without painting when no engine is available', () => {
    engine = null;
    const ctx = makeCtx({ stampSourceRef: { current: { x: 0, y: 0 } } });
    const state = handleStampDown(ctx);
    expect(state?.tool).toBe('stamp');
    expect(applyStampDab).not.toHaveBeenCalled();
  });
});

describe('stamp move', () => {
  it('interpolates dabs with the locked offset and advances lastPoint', () => {
    const state = makeState({ lastPoint: { x: 0, y: 0 } });
    handleStampMove(state, { x: 30, y: 0 }, { current: { x: -7, y: 9 } });
    const [, , pts, ox, oy] = applyStampDabBatch.mock.calls[0]! as
      [unknown, string, Float64Array, number, number];
    expect(Array.from(pts)).toEqual([10, 0, 20, 0, 30, 0]);
    expect(ox).toBe(-7);
    expect(oy).toBe(9);
    expect(state.lastPoint).toEqual({ x: 30, y: 0 });
    expect(editorState.notifyRender).toHaveBeenCalled();
  });

  it('does nothing without a locked offset', () => {
    const state = makeState({ lastPoint: { x: 0, y: 0 } });
    handleStampMove(state, { x: 30, y: 0 }, { current: null });
    expect(applyStampDabBatch).not.toHaveBeenCalled();
    expect(state.lastPoint).toEqual({ x: 0, y: 0 });
  });

  it('does nothing without a lastPoint', () => {
    handleStampMove(makeState({ lastPoint: null }), { x: 30, y: 0 }, { current: { x: 0, y: 0 } });
    expect(applyStampDabBatch).not.toHaveBeenCalled();
  });
});
