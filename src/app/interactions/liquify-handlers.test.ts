import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Point } from '../../types';

const applyDabMock = vi.fn();
const renderMock = vi.fn();

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  liquifyApplyDabGpu: (...args: unknown[]) => applyDabMock(...args),
  liquifyRender: (...args: unknown[]) => renderMock(...args),
}));

vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => ({}),
}));

const liquifySession = {
  layerId: 'layer-1',
  settings: { mode: 'push', brushSize: 60, pressure: 50 },
};

vi.mock('../ui-store', () => ({
  useUIStore: {
    getState: () => ({ liquify: liquifySession }),
  },
}));

vi.mock('../editor-store', () => ({
  useEditorStore: {
    getState: () => ({
      document: { layers: [{ id: 'layer-1', x: 10, y: 20 }] },
    }),
  },
}));

import { handleLiquifyDown, handleLiquifyMove } from './liquify-handlers';
import type { InteractionState } from './interaction-types';

describe('liquify gesture state', () => {
  beforeEach(() => {
    applyDabMock.mockClear();
    renderMock.mockClear();
  });

  it('handleLiquifyDown stores the start point on the gesture variant', () => {
    const state = handleLiquifyDown({ x: 110, y: 220 }, 'layer-1');
    expect(state).not.toBeNull();
    expect(state!.gesture).toEqual({
      kind: 'liquify',
      lastPoint: { x: 100, y: 200 },
    });
  });

  it('handleLiquifyMove advances lastPoint immutably and applies the dab delta', () => {
    const start = handleLiquifyDown({ x: 110, y: 220 }, 'layer-1')!;
    const startGesture = start.gesture;

    const next = handleLiquifyMove(start, { x: 105, y: 203 });

    expect(next).not.toBe(start);
    expect(next.gesture).toEqual({ kind: 'liquify', lastPoint: { x: 105, y: 203 } });
    // The original gesture object is untouched (no hidden module state).
    expect(startGesture).toEqual({ kind: 'liquify', lastPoint: { x: 100, y: 200 } });

    expect(applyDabMock).toHaveBeenCalledTimes(1);
    const [, cx, cy, size, pressure, dx, dy] = applyDabMock.mock.calls[0] as [
      unknown, number, number, number, number, number, number,
    ];
    expect([cx, cy]).toEqual([105, 203]);
    expect(size).toBe(60);
    expect(pressure).toBe(50);
    expect([dx, dy]).toEqual([5, 3]);
    expect(renderMock).toHaveBeenCalledTimes(1);
  });

  it('handleLiquifyMove is a no-op for non-liquify gestures', () => {
    const state: InteractionState = {
      ...handleLiquifyDown({ x: 0, y: 0 }, 'layer-1')!,
      gesture: { kind: 'idle' },
    };
    const pos: Point = { x: 5, y: 5 };
    expect(handleLiquifyMove(state, pos)).toBe(state);
    expect(applyDabMock).not.toHaveBeenCalled();
  });

  it('consecutive moves chain deltas through the returned state', () => {
    let state = handleLiquifyDown({ x: 110, y: 220 }, 'layer-1')!;
    state = handleLiquifyMove(state, { x: 102, y: 200 });
    state = handleLiquifyMove(state, { x: 104, y: 201 });

    expect(applyDabMock).toHaveBeenCalledTimes(2);
    const second = applyDabMock.mock.calls[1] as unknown[];
    // delta of the second dab is measured from the first move's point
    expect([second[5], second[6]]).toEqual([2, 1]);
    expect(state.gesture).toEqual({ kind: 'liquify', lastPoint: { x: 104, y: 201 } });
  });
});
