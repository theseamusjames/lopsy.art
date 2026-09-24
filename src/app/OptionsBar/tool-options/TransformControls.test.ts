import { describe, it, expect, vi, beforeEach } from 'vitest';

// wasm-bridge mocks — capture call args so we can assert what the
// engine was told to do.
const floatSelection = vi.fn(() => new Int32Array());
const compositeFloatAffine = vi.fn();
const dropFloat = vi.fn();
const hasFloat = vi.fn(() => false);

vi.mock('../../../engine-wasm/wasm-bridge', () => ({
  floatSelection: (...args: unknown[]): Int32Array => floatSelection.apply(null, args as []),
  compositeFloatAffine: (...args: unknown[]): void => compositeFloatAffine.apply(null, args as []),
  dropFloat: (...args: unknown[]): void => dropFloat.apply(null, args as []),
  hasFloat: (...args: unknown[]): boolean => hasFloat.apply(null, args as []),
}));

const engine: { __mock: true } | null = { __mock: true };
vi.mock('../../../engine-wasm/engine-state', () => ({
  getEngine: () => engine,
}));

const selectLayerAlpha = vi.fn();
vi.mock('../../../panels/LayerPanel/layer-selection', () => ({
  selectLayerAlpha: (...args: unknown[]) => selectLayerAlpha(...args),
}));

const editorState = {
  selection: {
    active: true,
    mask: new Uint8ClampedArray(4),
    bounds: { x: 10, y: 10, width: 20, height: 20 },
  },
  document: {
    activeLayerId: 'layer-1',
    layers: [
      { id: 'layer-1', type: 'raster', x: 10, y: 10, width: 20, height: 20 },
    ],
  },
  pushHistory: vi.fn(),
  notifyRender: vi.fn(),
};
vi.mock('../../editor-store', () => ({
  useEditorStore: {
    getState: () => editorState,
    setState: () => {},
  },
}));

const uiState: {
  transform: {
    originalBounds: { x: number; y: number; width: number; height: number };
    scaleX: number;
    scaleY: number;
    rotation: number;
    translateX: number;
    translateY: number;
    skewX: number;
    skewY: number;
    mode: 'free' | 'skew' | 'distort' | 'perspective';
    corners: { x: number; y: number }[];
  } | null;
  setTransform: ReturnType<typeof vi.fn>;
} = {
  transform: null,
  setTransform: vi.fn(),
};
vi.mock('../../ui-store', () => ({
  useUIStore: {
    getState: () => uiState,
  },
}));

import { applyGpuTransform } from './TransformControls';

const identityFlip = new Float32Array([-1, 0, 0, 0, 1, 0, 0, 0, 1]);

beforeEach(() => {
  floatSelection.mockClear();
  compositeFloatAffine.mockClear();
  dropFloat.mockClear();
  hasFloat.mockReset();
  editorState.pushHistory.mockClear();
  selectLayerAlpha.mockClear();
  uiState.setTransform.mockClear();
  uiState.transform = null;
});

// #800 — clicking Flip Horizontal / Vertical during a live Move-tool
// scale/rotate transform used to throw the scale + rotation away. The
// float was re-rendered with only the flip matrix, ignoring the
// pending UI transform. Now the flip composes into the pending
// transform state (Photoshop behaviour) and the float stays live so
// the user can keep transforming or commit.
describe('applyGpuTransform (#800)', () => {
  it('with no pending transform, commits the flip immediately (float dropped, layer re-selected)', () => {
    hasFloat.mockReturnValue(false);
    uiState.transform = null;
    applyGpuTransform(identityFlip, 'horizontal');
    expect(editorState.pushHistory).toHaveBeenCalledWith('Transform');
    expect(compositeFloatAffine).toHaveBeenCalled();
    expect(dropFloat).toHaveBeenCalled();
    expect(selectLayerAlpha).toHaveBeenCalledWith('layer-1');
  });

  it('with an identity UI transform + no float, still commits immediately', () => {
    hasFloat.mockReturnValue(false);
    uiState.transform = {
      originalBounds: { x: 10, y: 10, width: 20, height: 20 },
      scaleX: 1, scaleY: 1, rotation: 0,
      translateX: 0, translateY: 0,
      skewX: 0, skewY: 0,
      mode: 'free',
      corners: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    };
    applyGpuTransform(identityFlip, 'horizontal');
    expect(dropFloat).toHaveBeenCalled();
    expect(selectLayerAlpha).toHaveBeenCalled();
  });

  it('with a pending non-identity transform + live float, COMPOSES into the transform without dropping', () => {
    hasFloat.mockReturnValue(true);
    uiState.transform = {
      originalBounds: { x: 10, y: 10, width: 20, height: 20 },
      scaleX: 0.5, scaleY: 0.5, rotation: 0,
      translateX: 0, translateY: 0,
      skewX: 0, skewY: 0,
      mode: 'free',
      corners: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    };
    applyGpuTransform(identityFlip, 'horizontal');

    // Composing path: no history push (still part of the same
    // in-progress Transform), no float drop, no re-select.
    expect(editorState.pushHistory).not.toHaveBeenCalled();
    expect(dropFloat).not.toHaveBeenCalled();
    expect(selectLayerAlpha).not.toHaveBeenCalled();
    // The composed transform is applied via compositeFloatAffine and
    // the UI transform now carries the flipped scaleX.
    expect(compositeFloatAffine).toHaveBeenCalled();
    expect(uiState.setTransform).toHaveBeenCalled();
    const calls = uiState.setTransform.mock.calls;
    const next = calls[calls.length - 1]![0];
    expect(next.scaleX).toBeCloseTo(-0.5, 6);
    expect(next.scaleY).toBeCloseTo(0.5, 6);
  });

  it('Flip Vertical composes into scaleY when there is a pending transform', () => {
    hasFloat.mockReturnValue(true);
    uiState.transform = {
      originalBounds: { x: 10, y: 10, width: 20, height: 20 },
      scaleX: 1, scaleY: 1, rotation: Math.PI / 4,
      translateX: 5, translateY: 5,
      skewX: 0, skewY: 0,
      mode: 'free',
      corners: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    };
    const flipV = new Float32Array([1, 0, 0, 0, -1, 0, 0, 0, 1]);
    applyGpuTransform(flipV, 'vertical');
    const calls = uiState.setTransform.mock.calls;
    const next = calls[calls.length - 1]![0];
    expect(next.scaleY).toBeCloseTo(-1, 6);
    expect(next.scaleX).toBeCloseTo(1, 6);
    expect(next.rotation).toBeCloseTo(Math.PI / 4, 6);
    expect(next.translateX).toBe(5);
    expect(next.translateY).toBe(5);
    expect(dropFloat).not.toHaveBeenCalled();
  });
});
