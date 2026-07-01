import { describe, it, expect, vi, beforeEach } from 'vitest';

const sampleColor = vi.fn();

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  sampleColor: (...args: unknown[]) => sampleColor(...args),
}));

let engine: { __engine: string } | null = { __engine: 'mock' };
vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => engine,
}));

const ts = {
  setForegroundColor: vi.fn(),
};
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => ts },
}));

import { handleEyedropperDown, handleEyedropperMove, _flushEyedropperSampleForTest } from './eyedropper-interaction';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';

function makeCtx(overrides: Partial<InteractionContext> = {}): InteractionContext {
  const layer = { id: 'layer-1', x: 0, y: 0, visible: true } as unknown as InteractionContext['activeLayer'];
  return {
    canvasPos: { x: 25, y: 35 },
    layerPos: { x: 25, y: 35 },
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
    tool: 'eyedropper',
    startPoint: null,
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    ...overrides,
  };
}

describe('eyedropper interaction', () => {
  beforeEach(() => {
    sampleColor.mockReset();
    ts.setForegroundColor.mockClear();
    engine = { __engine: 'mock' };
  });

  it('samples the composite at the canvas position and sets the foreground color', () => {
    sampleColor.mockReturnValue(new Uint8Array([10, 20, 30, 255]));
    handleEyedropperDown(makeCtx());
    expect(sampleColor).toHaveBeenCalledTimes(1);
    const args = sampleColor.mock.calls[0]!;
    expect(args[1]).toBe(25);
    expect(args[2]).toBe(35);
    expect(ts.setForegroundColor).toHaveBeenCalledWith({ r: 10, g: 20, b: 30, a: 1 });
  });

  it('normalizes alpha from 0..255 to 0..1', () => {
    sampleColor.mockReturnValue(new Uint8Array([0, 0, 0, 128]));
    handleEyedropperDown(makeCtx());
    expect(ts.setForegroundColor).toHaveBeenCalledWith({ r: 0, g: 0, b: 0, a: 128 / 255 });
  });

  it('returns a drawing state carrying the layer offset for later moves', () => {
    sampleColor.mockReturnValue(new Uint8Array([1, 2, 3, 255]));
    const layer = { id: 'layer-1', x: 100, y: 200, visible: true } as unknown as InteractionContext['activeLayer'];
    const state = handleEyedropperDown(makeCtx({ activeLayer: layer }));
    expect(state.tool).toBe('eyedropper');
    expect(state.drawing).toBe(true);
    expect(state.layerStartX).toBe(100);
    expect(state.layerStartY).toBe(200);
    expect(state.lastPoint).toEqual({ x: 25, y: 35 });
  });

  it('does not set a color when the engine returns a short result', () => {
    sampleColor.mockReturnValue(new Uint8Array([1, 2]));
    handleEyedropperDown(makeCtx());
    expect(ts.setForegroundColor).not.toHaveBeenCalled();
  });

  it('does not set a color when no engine is available', () => {
    engine = null;
    handleEyedropperDown(makeCtx());
    expect(sampleColor).not.toHaveBeenCalled();
    expect(ts.setForegroundColor).not.toHaveBeenCalled();
  });

  it('move samples at layer-local position translated back to canvas space', () => {
    sampleColor.mockReturnValue(new Uint8Array([5, 6, 7, 255]));
    handleEyedropperMove(makeState({ layerStartX: 100, layerStartY: 200 }), { x: 10, y: 15 });
    const args = sampleColor.mock.calls[0]!;
    expect(args[1]).toBe(110);
    expect(args[2]).toBe(215);
    expect(ts.setForegroundColor).toHaveBeenCalledWith({ r: 5, g: 6, b: 7, a: 1 });
  });

  it('move with negative coordinates still forwards them to the sampler', () => {
    sampleColor.mockReturnValue(new Uint8Array(0));
    handleEyedropperMove(makeState(), { x: -5, y: -8 });
    const args = sampleColor.mock.calls[0]!;
    expect(args[1]).toBe(-5);
    expect(args[2]).toBe(-8);
    expect(ts.setForegroundColor).not.toHaveBeenCalled();
  });

  describe('move throttling (fixes #641)', () => {
    it('coalesces rapid move events to one readPixels call per animation frame', () => {
      const raf = vi.fn((cb: () => void) => {
        (raf as unknown as { pending?: () => void }).pending = cb;
        return 1;
      });
      const cancelRaf = vi.fn();
      (globalThis as Record<string, unknown>).requestAnimationFrame = raf;
      (globalThis as Record<string, unknown>).cancelAnimationFrame = cancelRaf;

      try {
        sampleColor.mockReturnValue(new Uint8Array([1, 2, 3, 255]));

        // 5 pointer moves within one frame => only one rAF scheduled.
        for (let i = 0; i < 5; i++) {
          handleEyedropperMove(makeState(), { x: i, y: i });
        }
        expect(raf).toHaveBeenCalledTimes(1);
        expect(sampleColor).not.toHaveBeenCalled();

        // Firing the rAF samples only the last coalesced position.
        const pending = (raf as unknown as { pending?: () => void }).pending;
        expect(pending).toBeDefined();
        pending!();
        expect(sampleColor).toHaveBeenCalledTimes(1);
        const args = sampleColor.mock.calls[0]!;
        expect(args[1]).toBe(4);
        expect(args[2]).toBe(4);
        expect(ts.setForegroundColor).toHaveBeenCalledTimes(1);
        expect(ts.setForegroundColor).toHaveBeenCalledWith({ r: 1, g: 2, b: 3, a: 1 });
      } finally {
        delete (globalThis as Record<string, unknown>).requestAnimationFrame;
        delete (globalThis as Record<string, unknown>).cancelAnimationFrame;
        _flushEyedropperSampleForTest();
      }
    });

    it('runs synchronously when requestAnimationFrame is unavailable', () => {
      // Node test env has no rAF — verifies fallback so tests still work.
      sampleColor.mockReturnValue(new Uint8Array([9, 8, 7, 255]));
      handleEyedropperMove(makeState({ layerStartX: 100, layerStartY: 200 }), { x: 10, y: 15 });
      expect(sampleColor).toHaveBeenCalledTimes(1);
      const args = sampleColor.mock.calls[0]!;
      expect(args[1]).toBe(110);
      expect(args[2]).toBe(215);
      expect(ts.setForegroundColor).toHaveBeenCalledWith({ r: 9, g: 8, b: 7, a: 1 });
    });
  });
});
