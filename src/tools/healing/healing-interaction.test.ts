import { describe, it, expect, vi, beforeEach } from 'vitest';

const applyHealingDab = vi.fn();
const applyHealingDabBatch = vi.fn();

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  applyHealingDab: (...args: unknown[]) => applyHealingDab(...args),
  applyHealingDabBatch: (...args: unknown[]) => applyHealingDabBatch(...args),
}));

vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => ({ __engine: 'mock' }),
}));

const editorState = {
  pushHistory: vi.fn(),
  notifyRender: vi.fn(),
  document: { layers: [{ id: 'layer-1', x: 100, y: 200, type: 'raster' }] },
};
vi.mock('../../app/editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

const ts = {
  healingSize: 20,
  healingOpacity: 100,
};
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => ts },
}));

import {
  handleHealingDown,
  handleHealingMove,
} from './healing-interaction';
import type { InteractionContext } from '../../app/interactions/interaction-types';

function makeCtx(overrides: Partial<InteractionContext> = {}): InteractionContext {
  const layer = { id: 'layer-1', x: 100, y: 200, visible: true } as unknown as InteractionContext['activeLayer'];
  return {
    canvasPos: { x: 150, y: 250 },
    // layerPos is layer-local (canvasPos - layer.xy): (50, 50)
    layerPos: { x: 50, y: 50 },
    shiftKey: false,
    altKey: false,
    metaKey: false,
    activeLayerId: 'layer-1',
    activeLayer: layer,
    pixelBuffer: {} as unknown as InteractionContext['pixelBuffer'],
    paintSurface: {} as unknown as InteractionContext['paintSurface'],
    clientX: 0,
    clientY: 0,
    stateRef: { current: {} } as unknown as InteractionContext['stateRef'],
    floatingSelectionRef: { current: null } as unknown as InteractionContext['floatingSelectionRef'],
    persistentTransformRef: { current: null } as unknown as InteractionContext['persistentTransformRef'],
    stampSourceRef: { current: null } as unknown as InteractionContext['stampSourceRef'],
    stampOffsetRef: { current: null } as unknown as InteractionContext['stampOffsetRef'],
    lastPaintPointRef: { current: null } as unknown as InteractionContext['lastPaintPointRef'],
    ...overrides,
  };
}

describe('healing brush coordinate space (issue #497)', () => {
  beforeEach(() => {
    applyHealingDab.mockClear();
    applyHealingDabBatch.mockClear();
    editorState.pushHistory.mockClear();
    editorState.notifyRender.mockClear();
  });

  it('cmd+click sets the source reference and does not paint', () => {
    const ctx = makeCtx({ metaKey: true });
    handleHealingDown(ctx);
    expect(ctx.stampSourceRef.current).toEqual({ x: 50, y: 50 });
    expect(applyHealingDab).not.toHaveBeenCalled();
  });

  it('passes layer-local coordinates to applyHealingDab (NOT doc-space minus layer.xy again)', () => {
    // Source set first via cmd+click at layer-local (10, 10)
    const sourceCtx = makeCtx({ metaKey: true, layerPos: { x: 10, y: 10 } });
    handleHealingDown(sourceCtx);
    // Now click at layer-local (50, 50) — should heal at layer-local (50, 50)
    const ctx = makeCtx({
      layerPos: { x: 50, y: 50 },
      stampSourceRef: sourceCtx.stampSourceRef,
      stampOffsetRef: sourceCtx.stampOffsetRef,
    });
    handleHealingDown(ctx);
    expect(applyHealingDab).toHaveBeenCalledTimes(1);
    const args = applyHealingDab.mock.calls[0]!;
    // (engine, layerId, dx, dy, ox, oy, size, opacity)
    expect(args[2]).toBe(50);
    expect(args[3]).toBe(50);
  });

  it('handleHealingMove forwards layer-local points to applyHealingDabBatch without subtracting docX/docY', () => {
    handleHealingMove(
      {
        lastPoint: { x: 0, y: 0 },
        layerId: 'layer-1',
        drawing: true,
      } as never,
      { x: 80, y: 80 },
      { current: { x: -40, y: -40 } } as never,
    );
    expect(applyHealingDabBatch).toHaveBeenCalledTimes(1);
    const args = applyHealingDabBatch.mock.calls[0]!;
    const pts = args[2] as Float64Array;
    // All points must be positive (within layer-local 0..80 range).
    // The double-subtraction bug produced (-20, -120) etc., which would
    // be far outside the layer texture.
    for (let i = 0; i < pts.length; i += 2) {
      expect(pts[i]).toBeGreaterThanOrEqual(0);
      expect(pts[i]).toBeLessThanOrEqual(80);
      expect(pts[i + 1]).toBeGreaterThanOrEqual(0);
      expect(pts[i + 1]).toBeLessThanOrEqual(80);
    }
    // Source offset must be passed through unchanged.
    expect(args[3]).toBe(-40);
    expect(args[4]).toBe(-40);
  });
});
