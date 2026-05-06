import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock wasm-bridge so we can assert lifecycle calls without spinning up GL.
const renderLinearGradient = vi.fn();
const renderRadialGradient = vi.fn();
const saveGradientPreview = vi.fn();
const endGradientPreview = vi.fn();

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  renderLinearGradient: (...args: unknown[]) => renderLinearGradient(...args),
  renderRadialGradient: (...args: unknown[]) => renderRadialGradient(...args),
  saveGradientPreview: (...args: unknown[]) => saveGradientPreview(...args),
  endGradientPreview: (...args: unknown[]) => endGradientPreview(...args),
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

const uiStateValues: { gradientPreview: unknown } = { gradientPreview: null };
const uiState = {
  setGradientPreview: vi.fn((p: unknown) => { uiStateValues.gradientPreview = p; }),
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
    editorState.pushHistory.mockClear();
    uiState.setGradientPreview.mockClear();
    uiStateValues.gradientPreview = null;
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
