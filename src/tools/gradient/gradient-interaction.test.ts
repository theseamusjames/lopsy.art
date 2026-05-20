import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock wasm-bridge so we can assert lifecycle calls without spinning up GL.
const renderLinearGradient = vi.fn();
const renderRadialGradient = vi.fn();
const saveGradientPreview = vi.fn();
const endGradientPreview = vi.fn();
const renderMaskLinearGradient = vi.fn();
const renderMaskRadialGradient = vi.fn();
const renderQuickMaskLinearGradient = vi.fn();
const renderQuickMaskRadialGradient = vi.fn();
const uploadLayerMask = vi.fn();

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  renderLinearGradient: (...args: unknown[]) => renderLinearGradient(...args),
  renderRadialGradient: (...args: unknown[]) => renderRadialGradient(...args),
  saveGradientPreview: (...args: unknown[]) => saveGradientPreview(...args),
  endGradientPreview: (...args: unknown[]) => endGradientPreview(...args),
  renderMaskLinearGradient: (...args: unknown[]) => renderMaskLinearGradient(...args),
  renderMaskRadialGradient: (...args: unknown[]) => renderMaskRadialGradient(...args),
  renderQuickMaskLinearGradient: (...args: unknown[]) => renderQuickMaskLinearGradient(...args),
  renderQuickMaskRadialGradient: (...args: unknown[]) => renderQuickMaskRadialGradient(...args),
  uploadLayerMask: (...args: unknown[]) => uploadLayerMask(...args),
}));

vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => ({ __engine: 'mock' }),
}));

vi.mock('../../app/store/clear-js-pixel-data', () => ({
  clearJsPixelData: vi.fn(),
}));

const editorState = {
  pushHistory: vi.fn(),
  notifyRender: vi.fn(),
};
vi.mock('../../app/editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

const uiStateValues: { gradientPreview: unknown; isQuickMaskMode: boolean; maskEditMode: boolean } = {
  gradientPreview: null,
  isQuickMaskMode: false,
  maskEditMode: false,
};
const uiState = {
  setGradientPreview: vi.fn((p: unknown) => { uiStateValues.gradientPreview = p; }),
  get maskMode(): 'off' | 'layerMask' | 'quickMask' {
    if (uiStateValues.isQuickMaskMode) return 'quickMask';
    if (uiStateValues.maskEditMode) return 'layerMask';
    return 'off';
  },
};
vi.mock('../../app/ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

const ts = {
  gradientType: 'linear' as 'linear' | 'radial',
  gradientStops: [
    { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 255, g: 255, b: 255, a: 0 } },
  ],
  gradientReverse: false,
  foregroundColor: { r: 0, g: 0, b: 0, a: 1 },
  backgroundColor: { r: 255, g: 255, b: 255, a: 0 },
  addRecentColor: vi.fn(),
};
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => ts },
}));

import {
  handleGradientDown,
  handleGradientMove,
  handleGradientUp,
} from './gradient-interaction';
import type { InteractionContext } from '../../app/interactions/interaction-types';

function makeCtx(): InteractionContext {
  const layer = { id: 'layer-1', x: 0, y: 0, visible: true } as unknown as InteractionContext['activeLayer'];
  return {
    canvasPos: { x: 10, y: 10 },
    layerPos: { x: 10, y: 10 },
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
  };
}

describe('gradient drag lifecycle (issue #338)', () => {
  beforeEach(() => {
    saveGradientPreview.mockClear();
    endGradientPreview.mockClear();
    renderLinearGradient.mockClear();
    renderRadialGradient.mockClear();
    renderMaskLinearGradient.mockClear();
    renderMaskRadialGradient.mockClear();
    renderQuickMaskLinearGradient.mockClear();
    renderQuickMaskRadialGradient.mockClear();
    editorState.pushHistory.mockClear();
    uiState.setGradientPreview.mockClear();
    uiStateValues.gradientPreview = null;
    uiStateValues.isQuickMaskMode = false;
    uiStateValues.maskEditMode = false;
    ts.gradientType = 'linear';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('snapshots layer on down so subsequent renders restore from pre-drag state', () => {
    handleGradientDown(makeCtx());
    expect(saveGradientPreview).toHaveBeenCalledTimes(1);
    expect(saveGradientPreview).toHaveBeenCalledWith(expect.anything(), 'layer-1');
  });

  it('does not snapshot on each move (only on down)', () => {
    const state = handleGradientDown(makeCtx());
    saveGradientPreview.mockClear();
    handleGradientMove(state, { x: 50, y: 50 });
    handleGradientMove(state, { x: 60, y: 60 });
    handleGradientMove(state, { x: 70, y: 70 });
    expect(saveGradientPreview).not.toHaveBeenCalled();
    expect(renderLinearGradient).toHaveBeenCalledTimes(3);
  });

  it('releases snapshot on up so the layer is no longer pinned to the pre-drag state', () => {
    const state = handleGradientDown(makeCtx());
    handleGradientUp(state);
    expect(endGradientPreview).toHaveBeenCalledTimes(1);
  });

  it('clears the gradient preview line on up', () => {
    const state = handleGradientDown(makeCtx());
    handleGradientMove(state, { x: 50, y: 50 });
    expect(uiState.setGradientPreview).toHaveBeenCalled();
    handleGradientUp(state);
    expect(uiState.setGradientPreview).toHaveBeenLastCalledWith(null);
  });
});

// Issue #329 — last open bullet: "Same with quick mask -- I need fill,
// gradient, etc." Quick mask gradient must route to the quick-mask GPU op,
// never to the layer or the layer-mask path.
describe('gradient on quick mask (issue #329)', () => {
  beforeEach(() => {
    saveGradientPreview.mockClear();
    endGradientPreview.mockClear();
    renderLinearGradient.mockClear();
    renderRadialGradient.mockClear();
    renderMaskLinearGradient.mockClear();
    renderMaskRadialGradient.mockClear();
    renderQuickMaskLinearGradient.mockClear();
    renderQuickMaskRadialGradient.mockClear();
    editorState.pushHistory.mockClear();
    uiState.setGradientPreview.mockClear();
    uiStateValues.gradientPreview = null;
    uiStateValues.isQuickMaskMode = false;
    uiStateValues.maskEditMode = false;
    ts.gradientType = 'linear';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures isQuickMaskMode into the interaction state on down', () => {
    uiStateValues.isQuickMaskMode = true;
    const state = handleGradientDown(makeCtx());
    expect(state.quickMaskMode).toBe(true);
  });

  it('does not snapshot the layer preview in quick-mask mode', () => {
    uiStateValues.isQuickMaskMode = true;
    handleGradientDown(makeCtx());
    expect(saveGradientPreview).not.toHaveBeenCalled();
  });

  it('routes linear gradient to renderQuickMaskLinearGradient in quick-mask mode', () => {
    uiStateValues.isQuickMaskMode = true;
    ts.gradientType = 'linear';
    const state = handleGradientDown(makeCtx());
    handleGradientMove(state, { x: 50, y: 80 });
    expect(renderQuickMaskLinearGradient).toHaveBeenCalledTimes(1);
    expect(renderLinearGradient).not.toHaveBeenCalled();
    expect(renderMaskLinearGradient).not.toHaveBeenCalled();
  });

  it('routes radial gradient to renderQuickMaskRadialGradient in quick-mask mode', () => {
    uiStateValues.isQuickMaskMode = true;
    ts.gradientType = 'radial';
    const state = handleGradientDown(makeCtx());
    handleGradientMove(state, { x: 50, y: 80 });
    expect(renderQuickMaskRadialGradient).toHaveBeenCalledTimes(1);
    expect(renderRadialGradient).not.toHaveBeenCalled();
    expect(renderMaskRadialGradient).not.toHaveBeenCalled();
  });

  it('passes canvas-space coordinates (start + layerOffset) to quick-mask gradient', () => {
    uiStateValues.isQuickMaskMode = true;
    const ctx = makeCtx();
    // Pretend the active layer is offset at (100, 200) — the quick-mask
    // texture is document-sized, so the gradient must still see canvas
    // coordinates, not layer-local ones.
    (ctx.activeLayer as unknown as { x: number; y: number }).x = 100;
    (ctx.activeLayer as unknown as { x: number; y: number }).y = 200;
    ctx.layerPos = { x: 10, y: 10 };
    const state = handleGradientDown(ctx);
    handleGradientMove(state, { x: 50, y: 80 });
    expect(renderQuickMaskLinearGradient).toHaveBeenCalledTimes(1);
    const call = renderQuickMaskLinearGradient.mock.calls[0]!;
    // Args: (engine, startX, startY, endX, endY, stopsJson)
    expect(call[1]).toBe(110); // 10 + 100
    expect(call[2]).toBe(210); // 10 + 200
    expect(call[3]).toBe(150); // 50 + 100
    expect(call[4]).toBe(280); // 80 + 200
  });

  it('records a quick-mask history label on down', () => {
    uiStateValues.isQuickMaskMode = true;
    ts.gradientType = 'linear';
    handleGradientDown(makeCtx());
    expect(editorState.pushHistory).toHaveBeenCalledWith('Quick Mask Linear Gradient');

    editorState.pushHistory.mockClear();
    ts.gradientType = 'radial';
    handleGradientDown(makeCtx());
    expect(editorState.pushHistory).toHaveBeenCalledWith('Quick Mask Radial Gradient');
  });

  it('quick-mask mode takes precedence over layer mask edit mode', () => {
    // Even if maskEditMode is somehow on, isQuickMaskMode should win — the
    // two modes are mutually exclusive in the UI but the state guard must
    // be robust either way.
    uiStateValues.isQuickMaskMode = true;
    uiStateValues.maskEditMode = true;
    const ctx = makeCtx();
    (ctx.activeLayer as unknown as { mask: { data: Uint8ClampedArray; width: number; height: number } }).mask = {
      data: new Uint8ClampedArray(4),
      width: 2,
      height: 2,
    };
    const state = handleGradientDown(ctx);
    handleGradientMove(state, { x: 50, y: 80 });
    expect(renderQuickMaskLinearGradient).toHaveBeenCalledTimes(1);
    expect(renderMaskLinearGradient).not.toHaveBeenCalled();
  });
});
