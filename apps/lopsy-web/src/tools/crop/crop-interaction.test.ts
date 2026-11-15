import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  uploadLayerPixels: vi.fn(),
}));

vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => null,
}));

vi.mock('../../engine-wasm/gpu-pixel-access', () => ({
  readLayerAsImageData: vi.fn(),
}));

interface CropRect { x: number; y: number; width: number; height: number }
interface Quad {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
}

const uiState = {
  cropRect: null as CropRect | null,
  setCropRect: vi.fn((r: CropRect | null) => { uiState.cropRect = r; }),
  perspectiveCropQuad: null as Quad | null,
  setPerspectiveCropQuad: vi.fn((q: Quad | null) => { uiState.perspectiveCropQuad = q; }),
  perspectiveCropDragging: null as number | null,
  setPerspectiveCropDragging: vi.fn((idx: number | null) => { uiState.perspectiveCropDragging = idx; }),
};
vi.mock('../../app/ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

const editorState = {
  document: { width: 200, height: 100, layers: [] as unknown[] },
  viewport: { zoom: 1 },
  cropCanvas: vi.fn(),
  notifyRender: vi.fn(),
  pushHistory: vi.fn(),
  fitToView: vi.fn(),
};
vi.mock('../../app/editor-store', () => ({
  useEditorStore: { getState: () => editorState, setState: vi.fn() },
}));

const ts = {
  settings: {
    crop: { mode: 'normal' as 'normal' | 'perspective' },
  },
  aspectRatioLocked: false,
  aspectRatioW: 1,
  aspectRatioH: 1,
};
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => ts },
}));

import { handleCropDown, handleCropMove, handleCropUp } from './crop-interaction';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';

function makeCtx(overrides: Partial<InteractionContext> = {}): InteractionContext {
  const layer = { id: 'layer-1', x: 0, y: 0, visible: true } as unknown as InteractionContext['activeLayer'];
  return {
    canvasPos: { x: 20, y: 30 },
    layerPos: { x: 20, y: 30 },
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
    lastPoint: { x: 20, y: 30 },
    layerId: 'layer-1',
    tool: 'crop',
    startPoint: { x: 20, y: 30 },
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    ...overrides,
  };
}

beforeEach(() => {
  uiState.cropRect = null;
  uiState.setCropRect.mockClear();
  uiState.perspectiveCropQuad = null;
  uiState.setPerspectiveCropQuad.mockClear();
  uiState.perspectiveCropDragging = null;
  uiState.setPerspectiveCropDragging.mockClear();
  editorState.cropCanvas.mockClear();
  editorState.notifyRender.mockClear();
  ts.settings.crop.mode = 'normal';
  ts.aspectRatioLocked = false;
});

describe('crop down', () => {
  it('clears any previous crop rect and anchors the drag at the click point', () => {
    const state = handleCropDown(makeCtx({ canvasPos: { x: 20, y: 30 } }));
    expect(uiState.setCropRect).toHaveBeenCalledWith(null);
    expect(state).toMatchObject({
      drawing: true,
      tool: 'crop',
      startPoint: { x: 20, y: 30 },
      layerStartX: 0,
      layerStartY: 0,
    });
  });

  it('delegates to the perspective handler in perspective mode', () => {
    ts.settings.crop.mode = 'perspective';
    const state = handleCropDown(makeCtx());
    // The perspective handler seeds the quad from the full document.
    expect(uiState.setPerspectiveCropQuad).toHaveBeenCalledWith({
      topLeft: { x: 0, y: 0 },
      topRight: { x: 200, y: 0 },
      bottomRight: { x: 200, y: 100 },
      bottomLeft: { x: 0, y: 100 },
    });
    expect(uiState.setCropRect).not.toHaveBeenCalled();
    expect(state.tool).toBe('crop');
  });
});

describe('crop move', () => {
  it('sets the crop rect from start to cursor', () => {
    handleCropMove(makeState({ startPoint: { x: 20, y: 30 } }), { x: 60, y: 70 });
    expect(uiState.setCropRect).toHaveBeenCalledWith({ x: 20, y: 30, width: 40, height: 40 });
    expect(editorState.notifyRender).toHaveBeenCalled();
  });

  it('normalizes a reversed drag', () => {
    handleCropMove(makeState({ startPoint: { x: 60, y: 70 } }), { x: 20, y: 30 });
    expect(uiState.setCropRect).toHaveBeenCalledWith({ x: 20, y: 30, width: 40, height: 40 });
  });

  it('clamps the rect to the document bounds', () => {
    handleCropMove(makeState({ startPoint: { x: 150, y: 50 } }), { x: 500, y: 500 });
    expect(uiState.setCropRect).toHaveBeenCalledWith({ x: 150, y: 50, width: 50, height: 50 });
  });

  it('clamps negative cursor coordinates to the canvas origin', () => {
    handleCropMove(makeState({ startPoint: { x: 30, y: 30 } }), { x: -50, y: -50 });
    expect(uiState.setCropRect).toHaveBeenCalledWith({ x: 0, y: 0, width: 30, height: 30 });
  });

  it('applies a locked aspect ratio (wide ratio shrinks the height)', () => {
    ts.aspectRatioLocked = true;
    ts.aspectRatioW = 2;
    ts.aspectRatioH = 1;
    handleCropMove(makeState({ startPoint: { x: 0, y: 0 } }), { x: 100, y: 100 });
    const calls = uiState.setCropRect.mock.calls;
    const rect = calls[calls.length - 1]![0] as CropRect;
    expect(rect.width / rect.height).toBeCloseTo(2);
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(50);
  });

  it('does not set a rect for a zero-size drag', () => {
    handleCropMove(makeState({ startPoint: { x: 20, y: 30 } }), { x: 20, y: 30 });
    expect(uiState.setCropRect).not.toHaveBeenCalled();
  });

  it('does nothing without a start point', () => {
    handleCropMove(makeState({ startPoint: null }), { x: 60, y: 70 });
    expect(uiState.setCropRect).not.toHaveBeenCalled();
  });

  it('routes to the perspective handler in perspective mode', () => {
    ts.settings.crop.mode = 'perspective';
    uiState.perspectiveCropQuad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 200, y: 0 },
      bottomRight: { x: 200, y: 100 },
      bottomLeft: { x: 0, y: 100 },
    };
    uiState.perspectiveCropDragging = 1;
    handleCropMove(makeState(), { x: 150, y: 20 });
    expect(uiState.setCropRect).not.toHaveBeenCalled();
    expect(uiState.setPerspectiveCropQuad).toHaveBeenCalledWith(
      expect.objectContaining({ topRight: { x: 150, y: 20 } }),
    );
  });
});

describe('crop up', () => {
  it('applies the crop and clears the rect', () => {
    uiState.cropRect = { x: 10, y: 10, width: 50, height: 40 };
    handleCropUp(makeState());
    expect(editorState.cropCanvas).toHaveBeenCalledWith({ x: 10, y: 10, width: 50, height: 40 });
    expect(uiState.setCropRect).toHaveBeenLastCalledWith(null);
  });

  it('discards a degenerate rect without cropping', () => {
    uiState.cropRect = { x: 10, y: 10, width: 1, height: 1 };
    handleCropUp(makeState());
    expect(editorState.cropCanvas).not.toHaveBeenCalled();
    expect(uiState.setCropRect).toHaveBeenLastCalledWith(null);
  });

  it('ignores up events from other tools', () => {
    uiState.cropRect = { x: 10, y: 10, width: 50, height: 40 };
    handleCropUp(makeState({ tool: 'brush' }));
    expect(editorState.cropCanvas).not.toHaveBeenCalled();
    expect(uiState.setCropRect).not.toHaveBeenCalled();
  });

  it('releases the perspective drag in perspective mode', () => {
    ts.settings.crop.mode = 'perspective';
    uiState.cropRect = { x: 10, y: 10, width: 50, height: 40 };
    handleCropUp(makeState());
    expect(uiState.setPerspectiveCropDragging).toHaveBeenCalledWith(null);
    expect(editorState.cropCanvas).not.toHaveBeenCalled();
  });
});
