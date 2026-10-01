import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MutableRefObject } from 'react';
import type { FloatingSelection, PersistentTransform } from './interaction-types';
import { createTransformState, type TransformState } from '../../tools/transform/transform';
import type { Rect } from '../../types';

const bridge = vi.hoisted(() => {
  const state = { isFloating: false };
  return {
    state,
    hasFloat: vi.fn(() => state.isFloating),
    dropFloat: vi.fn(() => { state.isFloating = false; }),
    setSelectionMask: vi.fn(),
  };
});

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  hasFloat: bridge.hasFloat,
  dropFloat: bridge.dropFloat,
  setSelectionMask: bridge.setSelectionMask,
}));
vi.mock('../../engine-wasm/engine-state', () => ({ getEngine: () => ({ __engine: 'mock' }) }));
vi.mock('../store/clear-js-pixel-data', () => ({ clearJsPixelData: vi.fn() }));
vi.mock('../reconcile-layer-bounds', () => ({ reconcileLayerBoundsWithEngine: vi.fn() }));
vi.mock('./prefloat', () => ({ cancelPrefloat: vi.fn(), commitUnmovedPrefloat: vi.fn() }));

interface MockSelection {
  active: boolean;
  bounds: Rect | null;
  mask: Uint8ClampedArray | null;
  maskWidth: number;
  maskHeight: number;
}

const editor = vi.hoisted(() => {
  const state = {
    document: { activeLayerId: 'layer-1' as string | null },
    selection: {
      active: false,
      bounds: null,
      mask: null,
      maskWidth: 20,
      maskHeight: 20,
    } as MockSelection,
    setSelection: vi.fn((bounds: Rect, mask: Uint8ClampedArray, maskWidth: number, maskHeight: number) => {
      state.selection = { active: true, bounds, mask, maskWidth, maskHeight };
    }),
    notifyRender: vi.fn(),
  };
  return state;
});
vi.mock('../editor-store', () => ({ useEditorStore: { getState: () => editor } }));

const ui = vi.hoisted(() => {
  const state = {
    transform: null as TransformState | null,
    setTransform: vi.fn((t: TransformState | null) => { state.transform = t; }),
  };
  return state;
});
vi.mock('../ui-store', () => ({ useUIStore: { getState: () => ui } }));

import {
  registerFloatSession,
  claimLiveFloat,
  commitLiveFloat,
  commitLiveFloatBeforeEdit,
  forgetLiveFloat,
  withLiveFloatKept,
} from './live-float';

const BOX: Rect = { x: 5, y: 5, width: 4, height: 4 };

function rectMask(r: Rect): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(20 * 20);
  for (let y = r.y; y < r.y + r.height; y++) {
    for (let x = r.x; x < r.x + r.width; x++) mask[y * 20 + x] = 255;
  }
  return mask;
}

function selectBox(r: Rect): Uint8ClampedArray {
  const mask = rectMask(r);
  editor.selection = { active: true, bounds: r, mask, maskWidth: 20, maskHeight: 20 };
  return mask;
}

let floating: MutableRefObject<FloatingSelection | null>;
let persistent: MutableRefObject<PersistentTransform | null>;
let unregister: (() => void) | null = null;

/** A Move drag left its float live over `mask` on layer-1. */
function liveMoveFloat(mask: Uint8ClampedArray): void {
  bridge.state.isFloating = true;
  floating.current = { offsetX: 0, offsetY: 0, originalMask: mask, originalBounds: BOX, gpuResident: true };
  claimLiveFloat('layer-1', mask);
}

/** A handle drag left its float live with `transform` pending. */
function liveTransformFloat(mask: Uint8ClampedArray, transform: TransformState): void {
  bridge.state.isFloating = true;
  persistent.current = { originalMask: new Uint8ClampedArray(mask), maskWidth: 20, maskHeight: 20 };
  claimLiveFloat('layer-1', mask);
  ui.transform = transform;
}

describe('live Move float', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unregister?.();
    forgetLiveFloat();
    bridge.state.isFloating = false;
    editor.document.activeLayerId = 'layer-1';
    ui.transform = null;
    floating = { current: null };
    persistent = { current: null };
    unregister = registerFloatSession(floating, persistent);
  });

  it('bakes a moved float before an edit and keeps the moved selection', () => {
    const mask = selectBox(BOX);
    liveMoveFloat(mask);

    commitLiveFloatBeforeEdit();

    expect(bridge.dropFloat).toHaveBeenCalledTimes(1);
    expect(floating.current).toBeNull();
    expect(editor.selection.mask).toBe(mask);
    expect(editor.setSelection).not.toHaveBeenCalled();
  });

  it("leaves the float alone for the Move tool's own history push", () => {
    const mask = selectBox(BOX);
    liveMoveFloat(mask);

    withLiveFloatKept(() => commitLiveFloatBeforeEdit());

    expect(bridge.dropFloat).not.toHaveBeenCalled();
    expect(floating.current).not.toBeNull();
  });

  it('carries a pending rotation into the selection when it bakes', () => {
    const mask = selectBox(BOX);
    liveTransformFloat(mask, { ...createTransformState(BOX), rotation: Math.PI / 2, translateX: 6 });

    commitLiveFloat();

    expect(bridge.dropFloat).toHaveBeenCalledTimes(1);
    expect(persistent.current).toBeNull();
    // A 4 x 4 square turned 90 degrees about (7, 7) and moved 6 right.
    expect(editor.selection.bounds).toEqual({ x: 11, y: 5, width: 4, height: 4 });
    expect(ui.transform?.originalBounds).toEqual({ x: 11, y: 5, width: 4, height: 4 });
    expect(ui.transform?.rotation).toBe(0);
  });

  it('never bakes an old transform into a selection that replaced it', () => {
    const mask = selectBox(BOX);
    liveTransformFloat(mask, { ...createTransformState(BOX), scaleX: 2, scaleY: 2 });
    const replaced = selectBox({ x: 0, y: 0, width: 20, height: 20 });

    commitLiveFloat();

    expect(bridge.dropFloat).toHaveBeenCalledTimes(1);
    expect(editor.selection.mask).toBe(replaced);
    expect(editor.setSelection).not.toHaveBeenCalled();
  });
});
