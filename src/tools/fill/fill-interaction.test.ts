import { describe, it, expect, vi, beforeEach } from 'vitest';

const floodFill = vi.fn();
const applyFillToLayer = vi.fn();
const readLayerPixelsForFill = vi.fn();
const bucketFillSolid = vi.fn();
const bucketFillByColorGpu = vi.fn();
const fillQuickMask = vi.fn();
const fillMask = vi.fn();
const uploadLayerMask = vi.fn();
const readMaskTexture = vi.fn();
// #667 fast-path branches ask the engine for the layer texture dimensions to
// decide "is this layer effectively empty?". Default to a full-size texture
// so the existing "regular content" tests still hit the CPU flood-fill path;
// the empty-layer test flips this to (1, 1) locally.
const getLayerTextureDimensions = vi.fn((..._args: unknown[]) => new Uint32Array([64, 64]));

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  floodFill: (...args: unknown[]) => floodFill(...args),
  applyFillToLayer: (...args: unknown[]) => applyFillToLayer(...args),
  readLayerPixelsForFill: (...args: unknown[]) => readLayerPixelsForFill(...args),
  bucketFillSolid: (...args: unknown[]) => bucketFillSolid(...args),
  bucketFillByColorGpu: (...args: unknown[]) => bucketFillByColorGpu(...args),
  getLayerTextureDimensions: (...args: unknown[]) => getLayerTextureDimensions(...args),
  fillQuickMask: (...args: unknown[]) => fillQuickMask(...args),
  fillMask: (...args: unknown[]) => fillMask(...args),
  uploadLayerMask: (...args: unknown[]) => uploadLayerMask(...args),
  readMaskTexture: (...args: unknown[]) => readMaskTexture(...args),
}));

// #667 empty-layer fast path also consults the pixel-data manager to
// distinguish "lazy 1x1 texture, no JS pixel data" from "cleared full-size
// texture, JS pixel data queued". Stub both accessors as always-empty here.
vi.mock('../../engine/pixel-data-manager', () => ({
  pixelDataManager: { get: () => null, getSparse: () => null },
}));

let engine: { __engine: string } | null = { __engine: 'mock' };
vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => engine,
}));

const clearJsPixelData = vi.fn();
vi.mock('../../app/store/clear-js-pixel-data', () => ({
  clearJsPixelData: (...args: unknown[]) => clearJsPixelData(...args),
}));

// #742 — every fill path reconciles JS layer bounds against the engine's
// post-ensure_layer_full_size descriptor. That helper reads the store and
// touches the pixel-data manager; stub it out here and record calls so
// tests can assert the reconciliation ran.
const syncLayerAfterFullSize = vi.fn((_engine: unknown, _id: string) => null);
vi.mock('../../app/sync-layer-after-full-size', () => ({
  syncLayerAfterFullSize: (engine: unknown, id: string) => syncLayerAfterFullSize(engine, id),
}));

const DOC_W = 8;
const DOC_H = 8;

interface MockLayer {
  id: string;
  x: number;
  y: number;
  mask: { data: Uint8ClampedArray; width: number; height: number } | null;
}

const editorState = {
  document: {
    width: DOC_W,
    height: DOC_H,
    layers: [{ id: 'layer-1', x: 0, y: 0, mask: null }] as MockLayer[],
  },
  selection: {
    active: false,
    mask: null as Uint8ClampedArray | null,
    bounds: null as { x: number; y: number; width: number; height: number } | null,
    maskWidth: 0,
    maskHeight: 0,
  },
  pushHistory: vi.fn(),
  notifyRender: vi.fn(),
  updateLayerMaskData: vi.fn(),
};
vi.mock('../../app/editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

const uiState = {
  maskMode: 'off' as 'off' | 'layerMask' | 'quickMask',
};
vi.mock('../../app/ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

const ts = {
  foregroundColor: { r: 200, g: 100, b: 50, a: 1 },
  settings: { fill: { tolerance: 24, contiguous: true } },
  addRecentColor: vi.fn(),
};
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => ts },
}));

import { handleFillDown } from './fill-interaction';
import type { InteractionContext } from '../../app/interactions/interaction-types';

function makeCtx(overrides: Partial<InteractionContext> = {}): InteractionContext {
  const layer = { id: 'layer-1', x: 0, y: 0, visible: true } as unknown as InteractionContext['activeLayer'];
  return {
    canvasPos: { x: 3.4, y: 3.6 },
    layerPos: { x: 3.4, y: 3.6 },
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
  engine = { __engine: 'mock' };
  floodFill.mockReset();
  applyFillToLayer.mockClear();
  readLayerPixelsForFill.mockReset();
  fillQuickMask.mockClear();
  fillMask.mockClear();
  uploadLayerMask.mockClear();
  readMaskTexture.mockReset();
  clearJsPixelData.mockClear();
  syncLayerAfterFullSize.mockClear();
  editorState.pushHistory.mockClear();
  editorState.notifyRender.mockClear();
  editorState.updateLayerMaskData.mockClear();
  ts.addRecentColor.mockClear();
  uiState.maskMode = 'off';
  editorState.document.layers = [{ id: 'layer-1', x: 0, y: 0, mask: null }];
  editorState.selection = { active: false, mask: null, bounds: null, maskWidth: 0, maskHeight: 0 };
  readLayerPixelsForFill.mockReturnValue(new Uint8Array(DOC_W * DOC_H * 4));
  floodFill.mockReturnValue(new Uint8Array(DOC_W * DOC_H).fill(255));
});

describe('bucket fill — normal mode', () => {
  it('flood-fills from the click point and applies the result to the layer', () => {
    handleFillDown(makeCtx());
    expect(editorState.pushHistory).toHaveBeenCalledWith('Bucket Fill');
    expect(ts.addRecentColor).toHaveBeenCalledWith(ts.foregroundColor);

    expect(floodFill).toHaveBeenCalledTimes(1);
    const ff = floodFill.mock.calls[0]!;
    // (pixels, docW, docH, x, y, r, g, b, a255, tolerance, contiguous)
    expect(ff[1]).toBe(DOC_W);
    expect(ff[2]).toBe(DOC_H);
    expect(ff[3]).toBe(3); // round(3.4)
    expect(ff[4]).toBe(4); // round(3.6)
    expect(ff[5]).toBe(200);
    expect(ff[6]).toBe(100);
    expect(ff[7]).toBe(50);
    expect(ff[8]).toBe(255);
    expect(ff[9]).toBe(24);
    expect(ff[10]).toBe(true);

    expect(applyFillToLayer).toHaveBeenCalledTimes(1);
    const af = applyFillToLayer.mock.calls[0]!;
    // (engine, layerId, r, g, b, a, mask, docW, docH)
    expect(af[1]).toBe('layer-1');
    expect(af[2]).toBeCloseTo(200 / 255);
    expect(af[3]).toBeCloseTo(100 / 255);
    expect(af[4]).toBeCloseTo(50 / 255);
    expect(af[5]).toBe(1);
    expect(clearJsPixelData).toHaveBeenCalledWith('layer-1');
    expect(editorState.notifyRender).toHaveBeenCalled();
  });

  it('translates layer-local click coordinates into document space', () => {
    editorState.document.layers = [{ id: 'layer-1', x: 2, y: 3, mask: null }];
    handleFillDown(makeCtx({ layerPos: { x: 1, y: 1 } }));
    const ff = floodFill.mock.calls[0]!;
    expect(ff[3]).toBe(3); // 1 + layer.x
    expect(ff[4]).toBe(4); // 1 + layer.y
  });

  it('aborts when clicking outside an active selection', () => {
    const selMask = new Uint8ClampedArray(DOC_W * DOC_H); // nothing selected at click
    editorState.selection = {
      active: true,
      mask: selMask,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      maskWidth: DOC_W,
      maskHeight: DOC_H,
    };
    handleFillDown(makeCtx());
    expect(floodFill).not.toHaveBeenCalled();
    expect(applyFillToLayer).not.toHaveBeenCalled();
  });

  it('intersects the flood mask with the active selection', () => {
    const selMask = new Uint8ClampedArray(DOC_W * DOC_H);
    // Select only the top half (rows 0..3), which includes the click at (3,4)? No —
    // include row 4 so the click point itself is selected.
    for (let y = 0; y <= 4; y++) {
      for (let x = 0; x < DOC_W; x++) selMask[y * DOC_W + x] = 255;
    }
    editorState.selection = {
      active: true,
      mask: selMask,
      bounds: { x: 0, y: 0, width: DOC_W, height: 5 },
      maskWidth: DOC_W,
      maskHeight: DOC_H,
    };
    handleFillDown(makeCtx());
    const fillMaskArg = applyFillToLayer.mock.calls[0]![6] as Uint8Array;
    expect(fillMaskArg[4 * DOC_W + 3]).toBe(255); // inside selection
    expect(fillMaskArg[6 * DOC_W + 3]).toBe(0); // flood hit it, selection vetoed it
  });

  it('does nothing after pushing history when no engine is available', () => {
    engine = null;
    handleFillDown(makeCtx());
    expect(editorState.pushHistory).toHaveBeenCalledWith('Bucket Fill');
    expect(floodFill).not.toHaveBeenCalled();
    expect(applyFillToLayer).not.toHaveBeenCalled();
  });

  // #742 — the fill's engine-side ensure_layer_full_size resets the layer
  // descriptor to doc-sized at the origin. Without a bounds reconciliation
  // on the JS side, the next syncLayers frame re-applies the pre-fill
  // offset and double-offsets the result (#722 revert). Every fill path
  // must call syncLayerAfterFullSize to keep the store in step.
  it('reconciles bounds via syncLayerAfterFullSize after the CPU BFS path', () => {
    handleFillDown(makeCtx());
    expect(applyFillToLayer).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
    expect(syncLayerAfterFullSize.mock.calls[0]![1]).toBe('layer-1');
  });

  it('reconciles bounds via syncLayerAfterFullSize on the non-contiguous GPU fast path', () => {
    ts.settings.fill.contiguous = false;
    handleFillDown(makeCtx());
    expect(bucketFillByColorGpu).toHaveBeenCalledTimes(1);
    expect(applyFillToLayer).not.toHaveBeenCalled();
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
    ts.settings.fill.contiguous = true;
  });

  it('reconciles bounds via syncLayerAfterFullSize on the empty-layer solid fast path', () => {
    getLayerTextureDimensions.mockReturnValueOnce(new Uint32Array([1, 1]));
    handleFillDown(makeCtx());
    expect(bucketFillSolid).toHaveBeenCalledTimes(1);
    expect(applyFillToLayer).not.toHaveBeenCalled();
    expect(syncLayerAfterFullSize).toHaveBeenCalledTimes(1);
  });
});

describe('bucket fill — quick mask mode', () => {
  it('fills the quick mask texture instead of the layer', () => {
    uiState.maskMode = 'quickMask';
    handleFillDown(makeCtx({ canvasPos: { x: 5.6, y: 2.2 } }));
    expect(editorState.pushHistory).toHaveBeenCalledWith('Quick Mask Fill');
    expect(fillQuickMask).toHaveBeenCalledTimes(1);
    const args = fillQuickMask.mock.calls[0]!;
    // (engine, x, y, tolerance, contiguous, mode)
    expect(args[1]).toBe(6); // round(5.6)
    expect(args[2]).toBe(2); // round(2.2)
    expect(args[3]).toBe(24);
    expect(args[4]).toBe(true);
    expect(args[5]).toBe(0);
    expect(floodFill).not.toHaveBeenCalled();
    expect(applyFillToLayer).not.toHaveBeenCalled();
  });

  it('does nothing without an engine', () => {
    uiState.maskMode = 'quickMask';
    engine = null;
    handleFillDown(makeCtx());
    expect(fillQuickMask).not.toHaveBeenCalled();
    expect(editorState.notifyRender).not.toHaveBeenCalled();
  });
});

describe('bucket fill — layer mask mode', () => {
  it('uploads the current mask, fills it black, and reads the result back', () => {
    uiState.maskMode = 'layerMask';
    const maskData = new Uint8ClampedArray(DOC_W * DOC_H).fill(255);
    editorState.document.layers = [
      { id: 'layer-1', x: 0, y: 0, mask: { data: maskData, width: DOC_W, height: DOC_H } },
    ];
    const updated = new Uint8Array(DOC_W * DOC_H).fill(127);
    readMaskTexture.mockReturnValue(updated);

    handleFillDown(makeCtx({ layerPos: { x: 4.4, y: 4.6 } }));

    expect(editorState.pushHistory).toHaveBeenCalledWith('Mask Fill');
    expect(uploadLayerMask).toHaveBeenCalledTimes(1);
    const up = uploadLayerMask.mock.calls[0]!;
    expect(up[1]).toBe('layer-1');
    expect(up[3]).toBe(DOC_W);
    expect(up[4]).toBe(DOC_H);

    expect(fillMask).toHaveBeenCalledTimes(1);
    const fm = fillMask.mock.calls[0]!;
    // (engine, layerId, x, y, tolerance, contiguous, mode=1 fill-black)
    expect(fm[2]).toBe(4);
    expect(fm[3]).toBe(5);
    expect(fm[6]).toBe(1);

    expect(editorState.updateLayerMaskData).toHaveBeenCalledTimes(1);
    const [layerId, newMask] = editorState.updateLayerMaskData.mock.calls[0]! as [string, Uint8ClampedArray];
    expect(layerId).toBe('layer-1');
    expect(newMask[0]).toBe(127);
    expect(floodFill).not.toHaveBeenCalled();
  });

  it('falls back to a normal bucket fill when the layer has no mask', () => {
    uiState.maskMode = 'layerMask';
    handleFillDown(makeCtx());
    expect(editorState.pushHistory).toHaveBeenCalledWith('Bucket Fill');
    expect(fillMask).not.toHaveBeenCalled();
    expect(floodFill).toHaveBeenCalledTimes(1);
  });
});
