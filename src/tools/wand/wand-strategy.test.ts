import { describe, it, expect, vi, beforeEach } from 'vitest';

const floodFill = vi.fn();
const floodFillGraduated = vi.fn();
const readLayerPixelsForFill = vi.fn();

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
    combineSelections: wasmThrow,
    setSelectionMask: vi.fn(),
    featherSelectionMask: vi.fn(),
    readSelectionMask: vi.fn(),
    hasFloat: vi.fn(() => false),
    dropFloat: vi.fn(),
    floodFill: (...args: unknown[]) => floodFill(...args),
    floodFillGraduated: (...args: unknown[]) => floodFillGraduated(...args),
    readLayerPixelsForFill: (...args: unknown[]) => readLayerPixelsForFill(...args),
    magneticLassoBegin: vi.fn(),
    magneticLassoSnap: vi.fn(),
    magneticLassoSnapPoint: vi.fn(),
    magneticLassoEnd: vi.fn(),
  };
});

let engine: { __engine: string } | null = { __engine: 'mock' };
vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => engine,
}));

const DOC_W = 8;
const DOC_H = 8;

const editorState = {
  document: { width: DOC_W, height: DOC_H, layers: [] as unknown[] },
  selection: {
    active: false,
    mask: null as Uint8ClampedArray | null,
    bounds: null as { x: number; y: number; width: number; height: number } | null,
    maskWidth: 0,
    maskHeight: 0,
  },
  setSelection: vi.fn(),
  clearSelection: vi.fn(),
  notifyRender: vi.fn(),
  pushHistoryMetadata: vi.fn(),
};
vi.mock('../../app/editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

const uiState = {
  setTransform: vi.fn(),
};
vi.mock('../../app/ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

const ts = {
  settings: {
    marquee: { feather: 0 },
    wand: { tolerance: 40, contiguous: true, graduated: false },
  },
};
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => ts },
}));

import { wandStrategy } from './wand-strategy';
import { readSelectionMask, setSelectionMask } from '../../engine-wasm/wasm-bridge';
import type { InteractionContext } from '../../app/interactions/interaction-types';

function makeCtx(overrides: Partial<InteractionContext> = {}): InteractionContext {
  const layer = { id: 'layer-1', x: 0, y: 0, visible: true } as unknown as InteractionContext['activeLayer'];
  return {
    canvasPos: { x: 2.4, y: 2.6 },
    layerPos: { x: 2.4, y: 2.6 },
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

/** A wand result mask covering the 2x2 block at (2,2)..(3,3). */
function wandResultMask(): Uint8Array {
  const m = new Uint8Array(DOC_W * DOC_H);
  for (const [x, y] of [[2, 2], [3, 2], [2, 3], [3, 3]]) {
    m[y! * DOC_W + x!] = 255;
  }
  return m;
}

describe('wand strategy', () => {
  beforeEach(() => {
    floodFill.mockReset();
    floodFillGraduated.mockReset();
    readLayerPixelsForFill.mockReset();
    editorState.setSelection.mockClear();
    editorState.clearSelection.mockClear();
    editorState.pushHistoryMetadata.mockClear();
    uiState.setTransform.mockClear();
    engine = { __engine: 'mock' };
    editorState.selection = { active: false, mask: null, bounds: null, maskWidth: 0, maskHeight: 0 };
    ts.settings.wand = { tolerance: 40, contiguous: true, graduated: false };
    readLayerPixelsForFill.mockReturnValue(new Uint8Array(DOC_W * DOC_H * 4));
    floodFill.mockReturnValue(wandResultMask());
    floodFillGraduated.mockReturnValue(wandResultMask());
  });

  it('returns undefined without an engine and leaves the selection untouched', () => {
    engine = null;
    const result = wandStrategy.onDown(makeCtx(), 'wand');
    expect(result).toBeUndefined();
    expect(floodFill).not.toHaveBeenCalled();
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });

  it('flood-fills at the pixel under the click with the configured tolerance', () => {
    wandStrategy.onDown(makeCtx({ canvasPos: { x: 2.4, y: 2.6 } }), 'wand');
    expect(floodFill).toHaveBeenCalledTimes(1);
    const args = floodFill.mock.calls[0]!;
    // (pixels, docW, docH, cx, cy, r, g, b, a, tolerance, contiguous)
    expect(args[1]).toBe(DOC_W);
    expect(args[2]).toBe(DOC_H);
    expect(args[3]).toBe(2);
    expect(args[4]).toBe(2);
    expect(args[9]).toBe(40);
    expect(args[10]).toBe(true);
  });

  it('commits the wand mask as the selection with correct bounds', () => {
    wandStrategy.onDown(makeCtx(), 'wand');
    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    const [bounds, mask] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
    ];
    expect(bounds).toEqual({ x: 2, y: 2, width: 2, height: 2 });
    expect(mask[2 * DOC_W + 2]).toBe(255);
    expect(mask[0]).toBe(0);
    expect(uiState.setTransform).toHaveBeenCalledTimes(1);
  });

  it('uses the graduated flood fill when the setting is enabled', () => {
    ts.settings.wand.graduated = true;
    wandStrategy.onDown(makeCtx(), 'wand');
    expect(floodFillGraduated).toHaveBeenCalledTimes(1);
    expect(floodFill).not.toHaveBeenCalled();
  });

  it('shift-click adds the wand result to the existing selection', () => {
    const existing = new Uint8ClampedArray(DOC_W * DOC_H);
    existing[0] = 255; // pixel (0,0) already selected
    editorState.selection = {
      active: true,
      mask: existing,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      maskWidth: DOC_W,
      maskHeight: DOC_H,
    };
    wandStrategy.onDown(makeCtx({ shiftKey: true }), 'wand');
    const [bounds, mask] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
    ];
    expect(mask[0]).toBe(255); // old selection kept
    expect(mask[2 * DOC_W + 2]).toBe(255); // new region added
    expect(bounds).toEqual({ x: 0, y: 0, width: 4, height: 4 });
    expect(editorState.pushHistoryMetadata).toHaveBeenCalledWith('Add to Selection');
  });

  it('shift+alt-click intersects the wand result with the existing selection', () => {
    const existing = new Uint8ClampedArray(DOC_W * DOC_H);
    existing[0] = 255;
    existing[2 * DOC_W + 2] = 255;
    editorState.selection = {
      active: true,
      mask: existing,
      bounds: { x: 0, y: 0, width: 3, height: 3 },
      maskWidth: DOC_W,
      maskHeight: DOC_H,
    };
    wandStrategy.onDown(makeCtx({ shiftKey: true, altKey: true }), 'wand');
    const [bounds, mask] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
    ];
    expect(mask[0]).toBe(0); // outside the wand result
    expect(mask[2 * DOC_W + 2]).toBe(255); // in both
    expect(mask[3 * DOC_W + 3]).toBe(0); // wand result only
    expect(bounds).toEqual({ x: 2, y: 2, width: 1, height: 1 });
    expect(editorState.pushHistoryMetadata).toHaveBeenCalledWith('Intersect Selection');
  });

  it('feathers only the added region, not the selection it joins', () => {
    ts.settings.marquee.feather = 4;
    const feathered = new Uint8Array(8 + DOC_W * DOC_H);
    new DataView(feathered.buffer).setUint32(0, DOC_W, true);
    new DataView(feathered.buffer).setUint32(4, DOC_H, true);
    feathered[8 + 2 * DOC_W + 2] = 200;
    feathered[8 + 2 * DOC_W + 1] = 60;
    vi.mocked(readSelectionMask).mockReturnValue(feathered);
    const existing = new Uint8ClampedArray(DOC_W * DOC_H);
    existing[7 * DOC_W + 7] = 255;
    editorState.selection = {
      active: true,
      mask: existing,
      bounds: { x: 7, y: 7, width: 1, height: 1 },
      maskWidth: DOC_W,
      maskHeight: DOC_H,
    };
    try {
      wandStrategy.onDown(makeCtx({ shiftKey: true }), 'wand');
    } finally {
      ts.settings.marquee.feather = 0;
    }
    const [, mask] = editorState.setSelection.mock.calls[0]! as [unknown, Uint8ClampedArray];
    // The feathered wand region is added as-is…
    expect(mask[2 * DOC_W + 2]).toBe(200);
    expect(mask[2 * DOC_W + 1]).toBe(60);
    // …and the existing hard-edged pixel is not re-blurred.
    expect(mask[7 * DOC_W + 7]).toBe(255);
    // The GPU was handed the wand region alone to feather.
    const uploads = vi.mocked(setSelectionMask).mock.calls;
    const uploaded = uploads[uploads.length - 1]![1];
    expect(uploaded[7 * DOC_W + 7]).toBe(0);
    expect(uploaded[2 * DOC_W + 2]).toBe(255);
  });

  it('alt-click subtracts the wand result from the existing selection', () => {
    const existing = new Uint8ClampedArray(DOC_W * DOC_H).fill(255);
    editorState.selection = {
      active: true,
      mask: existing,
      bounds: { x: 0, y: 0, width: DOC_W, height: DOC_H },
      maskWidth: DOC_W,
      maskHeight: DOC_H,
    };
    wandStrategy.onDown(makeCtx({ altKey: true }), 'wand');
    const [, mask] = editorState.setSelection.mock.calls[0]! as [
      unknown,
      Uint8ClampedArray,
    ];
    expect(mask[2 * DOC_W + 2]).toBe(0); // subtracted
    expect(mask[0]).toBe(255); // rest preserved
  });

  it('replaces the existing selection when no modifier is held', () => {
    const existing = new Uint8ClampedArray(DOC_W * DOC_H);
    existing[0] = 255;
    editorState.selection = {
      active: true,
      mask: existing,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      maskWidth: DOC_W,
      maskHeight: DOC_H,
    };
    wandStrategy.onDown(makeCtx(), 'wand');
    const [bounds, mask] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
      Uint8ClampedArray,
    ];
    expect(mask[0]).toBe(0); // old selection replaced, not merged
    expect(bounds).toEqual({ x: 2, y: 2, width: 2, height: 2 });
  });

  it('ignores an existing mask whose dimensions do not match the document', () => {
    editorState.selection = {
      active: true,
      mask: new Uint8ClampedArray(4 * 4).fill(255),
      bounds: { x: 0, y: 0, width: 4, height: 4 },
      maskWidth: 4,
      maskHeight: 4,
    };
    wandStrategy.onDown(makeCtx({ shiftKey: true }), 'wand');
    const [bounds] = editorState.setSelection.mock.calls[0]! as [
      { x: number; y: number; width: number; height: number },
    ];
    // No combine happened — just the wand result.
    expect(bounds).toEqual({ x: 2, y: 2, width: 2, height: 2 });
    expect(editorState.pushHistoryMetadata).not.toHaveBeenCalled();
  });

  it('clears the selection when the wand finds nothing', () => {
    floodFill.mockReturnValue(new Uint8Array(DOC_W * DOC_H));
    wandStrategy.onDown(makeCtx(), 'wand');
    expect(editorState.clearSelection).toHaveBeenCalledTimes(1);
    expect(editorState.setSelection).not.toHaveBeenCalled();
  });
});
