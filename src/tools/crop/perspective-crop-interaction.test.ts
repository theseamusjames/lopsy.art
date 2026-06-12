import { describe, it, expect, vi, beforeEach } from 'vitest';

const uploadLayerPixels = vi.fn();
vi.mock('../../engine-wasm/wasm-bridge', () => ({
  uploadLayerPixels: (...args: unknown[]) => uploadLayerPixels(...args),
}));

let engine: { __engine: string } | null = { __engine: 'mock' };
vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => engine,
}));

const readLayerAsImageData = vi.fn();
vi.mock('../../engine-wasm/gpu-pixel-access', () => ({
  readLayerAsImageData: (...args: unknown[]) => readLayerAsImageData(...args),
}));

import type { Quad } from './perspective-crop';

const uiState = {
  perspectiveCropQuad: null as Quad | null,
  setPerspectiveCropQuad: vi.fn((q: Quad | null) => { uiState.perspectiveCropQuad = q; }),
  perspectiveCropDragging: null as number | null,
  setPerspectiveCropDragging: vi.fn((idx: number | null) => { uiState.perspectiveCropDragging = idx; }),
};
vi.mock('../../app/ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

interface MockLayer {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

const editorState = {
  document: { width: 200, height: 100, layers: [] as MockLayer[] },
  viewport: { zoom: 1 },
  pushHistory: vi.fn(),
  notifyRender: vi.fn(),
  fitToView: vi.fn(),
  renderVersion: 0,
};
const setState = vi.fn((updater: unknown) => {
  const update = typeof updater === 'function'
    ? (updater as (s: typeof editorState) => Partial<typeof editorState>)(editorState)
    : updater as Partial<typeof editorState>;
  Object.assign(editorState, update);
});
vi.mock('../../app/editor-store', () => ({
  useEditorStore: {
    getState: () => editorState,
    setState: (updater: unknown) => setState(updater),
  },
}));

import {
  handlePerspectiveCropDown,
  handlePerspectiveCropMove,
  handlePerspectiveCropUp,
  commitPerspectiveCrop,
} from './perspective-crop-interaction';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';

function fullDocQuad(): Quad {
  return {
    topLeft: { x: 0, y: 0 },
    topRight: { x: 200, y: 0 },
    bottomRight: { x: 200, y: 100 },
    bottomLeft: { x: 0, y: 100 },
  };
}

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
    stampSourceRef: { current: null },
    stampOffsetRef: { current: null },
    lastPaintPointRef: { current: null },
    ...overrides,
  };
}

function makeState(overrides: Partial<InteractionState> = {}): InteractionState {
  return {
    drawing: true,
    lastPoint: { x: 50, y: 50 },
    layerId: 'layer-1',
    tool: 'crop',
    startPoint: { x: 50, y: 50 },
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    ...overrides,
  };
}

beforeEach(() => {
  engine = { __engine: 'mock' };
  uploadLayerPixels.mockClear();
  readLayerAsImageData.mockReset();
  uiState.perspectiveCropQuad = null;
  uiState.setPerspectiveCropQuad.mockClear();
  uiState.perspectiveCropDragging = null;
  uiState.setPerspectiveCropDragging.mockClear();
  editorState.document = { width: 200, height: 100, layers: [] };
  editorState.viewport = { zoom: 1 };
  editorState.pushHistory.mockClear();
  editorState.fitToView.mockClear();
  setState.mockClear();
});

describe('perspective crop down', () => {
  it('seeds the quad from the full document on first use', () => {
    const state = handlePerspectiveCropDown(makeCtx());
    expect(uiState.setPerspectiveCropQuad).toHaveBeenCalledWith(fullDocQuad());
    expect(state).toMatchObject({ drawing: true, tool: 'crop', startPoint: { x: 50, y: 50 } });
  });

  it('keeps an existing quad instead of reseeding', () => {
    const custom: Quad = {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 90, y: 10 },
      bottomRight: { x: 90, y: 60 },
      bottomLeft: { x: 10, y: 60 },
    };
    uiState.perspectiveCropQuad = custom;
    handlePerspectiveCropDown(makeCtx());
    expect(uiState.setPerspectiveCropQuad).not.toHaveBeenCalled();
    expect(uiState.perspectiveCropQuad).toEqual(custom);
  });

  it('grabs a corner handle when clicking within the hit radius', () => {
    uiState.perspectiveCropQuad = fullDocQuad();
    handlePerspectiveCropDown(makeCtx({ canvasPos: { x: 195, y: 4 } }));
    expect(uiState.setPerspectiveCropDragging).toHaveBeenCalledWith(1); // topRight
  });

  it('does not grab anything when clicking far from all corners', () => {
    uiState.perspectiveCropQuad = fullDocQuad();
    handlePerspectiveCropDown(makeCtx({ canvasPos: { x: 100, y: 50 } }));
    expect(uiState.setPerspectiveCropDragging).not.toHaveBeenCalled();
  });

  it('scales the hit radius with zoom (zoomed in shrinks the doc-space radius)', () => {
    uiState.perspectiveCropQuad = fullDocQuad();
    editorState.viewport = { zoom: 4 }; // radius becomes 2 doc px
    handlePerspectiveCropDown(makeCtx({ canvasPos: { x: 195, y: 4 } }));
    expect(uiState.setPerspectiveCropDragging).not.toHaveBeenCalled();

    editorState.viewport = { zoom: 0.5 }; // radius becomes 16 doc px
    handlePerspectiveCropDown(makeCtx({ canvasPos: { x: 188, y: 10 } }));
    expect(uiState.setPerspectiveCropDragging).toHaveBeenCalledWith(1);
  });
});

describe('perspective crop move', () => {
  it('moves only the dragged corner to the cursor', () => {
    uiState.perspectiveCropQuad = fullDocQuad();
    uiState.perspectiveCropDragging = 2; // bottomRight
    handlePerspectiveCropMove(makeState(), { x: 150, y: 80 });
    expect(uiState.perspectiveCropQuad).toEqual({
      ...fullDocQuad(),
      bottomRight: { x: 150, y: 80 },
    });
    expect(editorState.notifyRender).toHaveBeenCalled();
  });

  it('allows dragging a corner to negative coordinates', () => {
    uiState.perspectiveCropQuad = fullDocQuad();
    uiState.perspectiveCropDragging = 0; // topLeft
    handlePerspectiveCropMove(makeState(), { x: -20, y: -10 });
    expect(uiState.perspectiveCropQuad!.topLeft).toEqual({ x: -20, y: -10 });
  });

  it('does nothing when no corner is being dragged', () => {
    uiState.perspectiveCropQuad = fullDocQuad();
    handlePerspectiveCropMove(makeState(), { x: 150, y: 80 });
    expect(uiState.setPerspectiveCropQuad).not.toHaveBeenCalled();
  });

  it('does nothing when the gesture is not drawing', () => {
    uiState.perspectiveCropQuad = fullDocQuad();
    uiState.perspectiveCropDragging = 1;
    handlePerspectiveCropMove(makeState({ drawing: false }), { x: 150, y: 80 });
    expect(uiState.setPerspectiveCropQuad).not.toHaveBeenCalled();
  });
});

describe('perspective crop up', () => {
  it('releases the dragged corner', () => {
    uiState.perspectiveCropDragging = 3;
    handlePerspectiveCropUp(makeState());
    expect(uiState.setPerspectiveCropDragging).toHaveBeenCalledWith(null);
  });
});

describe('commitPerspectiveCrop', () => {
  function axisAlignedQuad(): Quad {
    return {
      topLeft: { x: 20, y: 10 },
      topRight: { x: 120, y: 10 },
      bottomRight: { x: 120, y: 60 },
      bottomLeft: { x: 20, y: 60 },
    };
  }

  function grayImage(w: number, h: number): ImageData {
    const img = new ImageData(w, h);
    img.data.fill(128);
    return img;
  }

  it('does nothing without a quad', () => {
    commitPerspectiveCrop();
    expect(editorState.pushHistory).not.toHaveBeenCalled();
    expect(setState).not.toHaveBeenCalled();
  });

  it('does nothing without an engine', () => {
    uiState.perspectiveCropQuad = axisAlignedQuad();
    engine = null;
    commitPerspectiveCrop();
    expect(editorState.pushHistory).not.toHaveBeenCalled();
  });

  it('warps raster layers, resizes the document, and resets the quad', () => {
    uiState.perspectiveCropQuad = axisAlignedQuad();
    editorState.document.layers = [
      { id: 'layer-1', type: 'raster', x: 0, y: 0, width: 200, height: 100 },
      { id: 'text-1', type: 'text', x: 5, y: 5 },
    ];
    readLayerAsImageData.mockReturnValue(grayImage(200, 100));

    commitPerspectiveCrop();

    expect(editorState.pushHistory).toHaveBeenCalledWith('Perspective Crop');
    // Only the raster layer is read back and re-uploaded.
    expect(readLayerAsImageData).toHaveBeenCalledTimes(1);
    expect(readLayerAsImageData).toHaveBeenCalledWith('layer-1');
    expect(uploadLayerPixels).toHaveBeenCalledTimes(1);
    const up = uploadLayerPixels.mock.calls[0]!;
    // (engine, layerId, bytes, width, height, x, y) — output rect is 100x50 at origin
    expect(up[1]).toBe('layer-1');
    expect(up[3]).toBe(100);
    expect(up[4]).toBe(50);
    expect(up[5]).toBe(0);
    expect(up[6]).toBe(0);
    // An interior sample of the axis-aligned warp preserves the source color.
    const bytes = up[2] as Uint8Array;
    const center = (25 * 100 + 50) * 4;
    expect(bytes[center]).toBe(128);

    // Document resized to the inferred output size.
    expect(editorState.document.width).toBe(100);
    expect(editorState.document.height).toBe(50);
    const raster = editorState.document.layers.find((l) => l.id === 'layer-1')!;
    expect(raster).toMatchObject({ x: 0, y: 0, width: 100, height: 50 });
    // Non-raster layer untouched.
    expect(editorState.document.layers.find((l) => l.id === 'text-1')).toMatchObject({ x: 5, y: 5 });

    expect(editorState.fitToView).toHaveBeenCalledTimes(1);
    expect(uiState.setPerspectiveCropQuad).toHaveBeenLastCalledWith(null);
    expect(uiState.setPerspectiveCropDragging).toHaveBeenLastCalledWith(null);
  });

  it('translates the quad into layer-local space for offset layers', () => {
    // Layer shifted by (20, 10): the same quad now starts at the layer origin,
    // so the warped output samples the layer's own top-left pixel.
    uiState.perspectiveCropQuad = axisAlignedQuad();
    editorState.document.layers = [
      { id: 'layer-1', type: 'raster', x: 20, y: 10, width: 100, height: 50 },
    ];
    const img = grayImage(100, 50);
    // Mark the layer-local origin pixel red.
    img.data[0] = 255;
    img.data[1] = 0;
    img.data[2] = 0;
    img.data[3] = 255;
    readLayerAsImageData.mockReturnValue(img);

    commitPerspectiveCrop();

    const bytes = uploadLayerPixels.mock.calls[0]![2] as Uint8Array;
    // Output pixel (0,0) maps to layer-local (0,0) — the red marker.
    expect(bytes[0]).toBe(255);
    expect(bytes[1]).toBe(0);
  });

  it('skips raster layers whose pixels cannot be read', () => {
    uiState.perspectiveCropQuad = axisAlignedQuad();
    editorState.document.layers = [
      { id: 'layer-1', type: 'raster', x: 0, y: 0, width: 200, height: 100 },
    ];
    readLayerAsImageData.mockReturnValue(null);
    commitPerspectiveCrop();
    expect(uploadLayerPixels).not.toHaveBeenCalled();
    // Document still resizes.
    expect(editorState.document.width).toBe(100);
    // Layer keeps its original geometry.
    expect(editorState.document.layers[0]).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
  });
});
