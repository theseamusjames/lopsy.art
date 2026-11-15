import { describe, it, expect, vi, beforeEach } from 'vitest';

const DOC_W = 16;
const DOC_H = 16;

interface Bounds { x: number; y: number; width: number; height: number }

const editorState = {
  document: { width: DOC_W, height: DOC_H, activeLayerId: null as string | null },
  selection: {
    active: true,
    mask: null as Uint8ClampedArray | null,
    bounds: null as Bounds | null,
    maskWidth: DOC_W,
    maskHeight: DOC_H,
  },
  setSelection: vi.fn((bounds: Bounds, mask: Uint8ClampedArray) => {
    editorState.selection = { ...editorState.selection, bounds, mask };
  }),
  setSelectionBounds: vi.fn((bounds: Bounds) => {
    editorState.selection = { ...editorState.selection, bounds };
  }),
  notifyRender: vi.fn(),
};

vi.mock('../editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

vi.mock('../ui-store', () => ({
  useUIStore: { getState: () => ({ setTransform: vi.fn(), transform: null }) },
}));

vi.mock('../store/clear-js-pixel-data', () => ({ clearJsPixelData: vi.fn() }));

vi.mock('../../engine-wasm/engine-state', () => ({ getEngine: () => ({}) }));

vi.mock('../../engine-wasm/engine-sync', () => ({ syncSelection: vi.fn() }));

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  beginQuickMaskMove: vi.fn(() => true),
  translateQuickMask: vi.fn(),
  endQuickMaskMove: vi.fn(),
  hasFloat: vi.fn(() => false),
  dropFloat: vi.fn(),
  setSelectionMask: vi.fn(),
}));

vi.mock('./prefloat', () => ({
  cancelPrefloat: vi.fn(),
  commitUnmovedPrefloat: vi.fn(),
}));

vi.mock('./layer-transform', () => ({
  commitLayerTransform: vi.fn(),
  forgetLayerTransform: vi.fn(),
}));

import { nudgeHeldSelection } from './selection-nudge';
import { flushNudgeMask, forgetLiveFloat } from './live-float';
import * as bridge from '../../engine-wasm/wasm-bridge';
import { syncSelection } from '../../engine-wasm/engine-sync';

function squareMask(): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(DOC_W * DOC_H);
  for (let y = 2; y < 6; y++) {
    for (let x = 2; x < 6; x++) mask[y * DOC_W + x] = 255;
  }
  return mask;
}

function at(mask: Uint8ClampedArray, x: number, y: number): number {
  return mask[y * DOC_W + x] ?? 0;
}

beforeEach(() => {
  forgetLiveFloat();
  vi.clearAllMocks();
  editorState.selection = {
    active: true,
    mask: squareMask(),
    bounds: { x: 2, y: 2, width: 4, height: 4 },
    maskWidth: DOC_W,
    maskHeight: DOC_H,
  };
});

describe('nudgeHeldSelection (selection tool, #1480)', () => {
  it('moves only the bounds while the key is held and writes the mask once at the end', () => {
    const original = editorState.selection.mask;
    for (let i = 0; i < 30; i++) nudgeHeldSelection('selection', 1, 0);

    expect(editorState.setSelection).not.toHaveBeenCalled();
    expect(editorState.selection.mask).toBe(original);
    expect(editorState.selection.bounds).toEqual({ x: 32, y: 2, width: 4, height: 4 });
    expect(editorState.setSelectionBounds).toHaveBeenCalledTimes(30);

    flushNudgeMask();

    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    expect(editorState.selection.bounds).toEqual({ x: 32, y: 2, width: 4, height: 4 });
  });

  it('writes the mask translated by the whole hold', () => {
    nudgeHeldSelection('selection', 1, 0);
    nudgeHeldSelection('selection', 1, 1);
    flushNudgeMask();

    const mask = editorState.selection.mask!;
    expect(at(mask, 4, 3)).toBe(255);
    expect(at(mask, 7, 6)).toBe(255);
    expect(at(mask, 3, 3)).toBe(0);
    expect(at(mask, 8, 3)).toBe(0);
  });

  it('starts a fresh hold from the selection on screen after a flush', () => {
    nudgeHeldSelection('selection', 2, 0);
    flushNudgeMask();
    nudgeHeldSelection('selection', 0, 3);
    flushNudgeMask();

    expect(editorState.selection.bounds).toEqual({ x: 4, y: 5, width: 4, height: 4 });
    expect(at(editorState.selection.mask!, 4, 5)).toBe(255);
    expect(at(editorState.selection.mask!, 3, 5)).toBe(0);
  });

  it('drops the held offset when the selection is replaced mid-hold', () => {
    nudgeHeldSelection('selection', 2, 0);
    const replaced = squareMask();
    editorState.setSelection({ x: 2, y: 2, width: 4, height: 4 }, replaced);
    editorState.setSelection.mockClear();

    flushNudgeMask();

    expect(editorState.setSelection).not.toHaveBeenCalled();
    expect(editorState.selection.mask).toBe(replaced);
  });

  it('never touches the quick mask', () => {
    nudgeHeldSelection('selection', 1, 0);
    flushNudgeMask();
    expect(bridge.beginQuickMaskMove).not.toHaveBeenCalled();
    expect(bridge.translateQuickMask).not.toHaveBeenCalled();
  });
});

describe('nudgeHeldSelection (quick mask, #1482)', () => {
  it('snapshots the quick mask on the GPU once per hold and redraws from it with the total offset', () => {
    for (let i = 0; i < 30; i++) nudgeHeldSelection('quickMask', 1, 0);

    expect(syncSelection).toHaveBeenCalledTimes(1);
    expect(bridge.beginQuickMaskMove).toHaveBeenCalledTimes(1);
    expect(bridge.translateQuickMask).toHaveBeenCalledTimes(30);
    expect(bridge.translateQuickMask).toHaveBeenLastCalledWith(expect.anything(), 30, 0);
    expect(editorState.setSelection).not.toHaveBeenCalled();
    expect(bridge.endQuickMaskMove).not.toHaveBeenCalled();

    flushNudgeMask();

    expect(bridge.endQuickMaskMove).toHaveBeenCalledTimes(1);
    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    expect(editorState.selection.bounds).toEqual({ x: 32, y: 2, width: 4, height: 4 });
  });

  it('releases the GPU copies when undo forgets the hold', () => {
    nudgeHeldSelection('quickMask', 1, 0);
    forgetLiveFloat();
    expect(bridge.endQuickMaskMove).toHaveBeenCalledTimes(1);
  });

  it('still moves the marquee when there is no quick mask to carry', () => {
    vi.mocked(bridge.beginQuickMaskMove).mockReturnValueOnce(false);
    nudgeHeldSelection('quickMask', 3, 0);
    flushNudgeMask();

    expect(bridge.translateQuickMask).not.toHaveBeenCalled();
    expect(bridge.endQuickMaskMove).not.toHaveBeenCalled();
    expect(editorState.selection.bounds).toEqual({ x: 5, y: 2, width: 4, height: 4 });
  });
});
