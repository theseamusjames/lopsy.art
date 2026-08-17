// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Rect } from '../../../types';

// Issue #721: Cmd+A after a paste-triggered alpha selection left the
// transform-overlay handles pinned to the pre-Cmd+A bounds, because
// `selectAll` (and `invertSelectionAction`) called `setSelection` without
// the paired `setTransform(createTransformState(bounds))` that every other
// selection-mutating site uses. These tests lock that pairing.

// A sentinel object stands in for the selection mask so the test can
// assert reference identity through the mock chain without allocating a
// real pixel buffer (the pixel-debt lint bans that in non-allowlisted
// files, and this test doesn't need one).
const MASK_SENTINEL = { __mask: true } as unknown as Uint8ClampedArray;

const editorState = {
  document: { width: 400, height: 300 },
  selection: {
    active: false,
    bounds: null as Rect | null,
    mask: null as Uint8ClampedArray | null,
    maskWidth: 0,
    maskHeight: 0,
  },
  setSelection: vi.fn(),
};
vi.mock('../../editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

const uiState = { setTransform: vi.fn() };
vi.mock('../../ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

// Neither of the touched code paths reaches createRectSelection's math in a
// way the test needs to introspect — a stub keeps the fixture minimal.
vi.mock('../../../selection/selection', () => ({
  createRectSelection: () => MASK_SENTINEL,
  invertSelection: (mask: Uint8ClampedArray) => mask,
}));

// selection-to-path is only used by selectionToPathAction; stub it so the
// import graph resolves under jsdom.
vi.mock('../../../selection/selection-to-path', () => ({
  selectionToPath: () => [],
}));

// createTransformState wraps its arg in a TransformState; we only need the
// bounds to flow through, so surface them for assertions.
vi.mock('../../../tools/transform/transform', () => ({
  createTransformState: (bounds: Rect) => ({ __bounds: bounds }),
}));

import { selectAll, invertSelectionAction } from './select-menu';

describe('selectAll / invertSelectionAction — transform state stays in sync', () => {
  beforeEach(() => {
    editorState.setSelection.mockClear();
    uiState.setTransform.mockClear();
    editorState.selection = {
      active: false,
      bounds: null,
      mask: null,
      maskWidth: 0,
      maskHeight: 0,
    };
  });

  it('selectAll refreshes the transform overlay with the full-canvas rect', () => {
    selectAll();
    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    expect(uiState.setTransform).toHaveBeenCalledTimes(1);
    const arg = uiState.setTransform.mock.calls[0]?.[0] as { __bounds: Rect };
    expect(arg.__bounds).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });

  it('invertSelectionAction refreshes the transform overlay with the full-canvas rect', () => {
    editorState.selection = {
      active: true,
      bounds: { x: 10, y: 20, width: 30, height: 40 },
      mask: MASK_SENTINEL,
      maskWidth: 2,
      maskHeight: 2,
    };
    invertSelectionAction();
    expect(editorState.setSelection).toHaveBeenCalledTimes(1);
    expect(uiState.setTransform).toHaveBeenCalledTimes(1);
    const arg = uiState.setTransform.mock.calls[0]?.[0] as { __bounds: Rect };
    expect(arg.__bounds).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });

  it('invertSelectionAction is a no-op when nothing is selected — no transform refresh either', () => {
    invertSelectionAction();
    expect(editorState.setSelection).not.toHaveBeenCalled();
    expect(uiState.setTransform).not.toHaveBeenCalled();
  });
});
