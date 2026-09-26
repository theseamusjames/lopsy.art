// @vitest-environment jsdom
import '../../test/canvas-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => null };
});

const { useEditorStore } = await import('../editor-store');
const { useUIStore } = await import('../ui-store');
const { createRectSelection, selectionBounds } = await import('../../selection/selection');
const { createTransformState } = await import('../../tools/transform/transform');

function get() {
  return useEditorStore.getState();
}

/**
 * Mirrors what the Move tool does on a selection drag: moves the selection
 * bounds/mask and re-anchors the transform-handle overlay at the new
 * position with an identity transform (see move-handlers.ts's
 * `handleMoveUp`).
 */
function moveSelectionTo(x: number, y: number, width: number, height: number, docW: number, docH: number): void {
  const bounds = { x, y, width, height };
  const mask = createRectSelection(bounds, docW, docH);
  get().setSelection(bounds, mask, docW, docH);
  useUIStore.getState().setTransform(createTransformState(bounds));
}

describe('undo/redo resyncs the transform-handle overlay with the restored selection (#871)', () => {
  beforeEach(() => {
    get().createDocument(400, 300, true);
    useUIStore.getState().setTransform(null);
  });

  it('moves transform.originalBounds back with the selection on undo', () => {
    const { width: docW, height: docH } = get().document;
    const original = { x: 60, y: 60, width: 80, height: 60 };
    const originalMask = createRectSelection(original, docW, docH);
    get().setSelection(original, originalMask, docW, docH);
    useUIStore.getState().setTransform(createTransformState(original));

    get().pushHistory('Move');
    moveSelectionTo(160, 120, 80, 60, docW, docH);

    expect(useUIStore.getState().transform?.originalBounds).toEqual({ x: 160, y: 120, width: 80, height: 60 });

    get().undo();

    const restoredSelectionBounds = get().selection.bounds;
    expect(restoredSelectionBounds).toEqual(original);
    // Pre-fix: the handle box stayed at the moved-to position even though
    // the selection (and pixels) reverted to `original`.
    expect(useUIStore.getState().transform?.originalBounds).toEqual(original);
    // Undoing a plain move must not leave a stale scale/rotation pending.
    expect(useUIStore.getState().transform?.scaleX).toBe(1);
    expect(useUIStore.getState().transform?.rotation).toBe(0);
  });

  it('restores the moved bounds on redo', () => {
    const { width: docW, height: docH } = get().document;
    const original = { x: 60, y: 60, width: 80, height: 60 };
    const originalMask = createRectSelection(original, docW, docH);
    get().setSelection(original, originalMask, docW, docH);
    useUIStore.getState().setTransform(createTransformState(original));

    get().pushHistory('Move');
    moveSelectionTo(160, 120, 80, 60, docW, docH);
    get().undo();
    get().redo();

    expect(useUIStore.getState().transform?.originalBounds).toEqual({ x: 160, y: 120, width: 80, height: 60 });
  });

  it('clears a stale transform when undo restores an inactive selection', () => {
    const { width: docW, height: docH } = get().document;
    get().pushHistoryMetadata('Before select');

    const bounds = { x: 60, y: 60, width: 80, height: 60 };
    const mask = createRectSelection(bounds, docW, docH);
    get().setSelection(bounds, mask, docW, docH);
    useUIStore.getState().setTransform(createTransformState(bounds));

    get().undo();

    expect(get().selection.active).toBe(false);
    expect(useUIStore.getState().transform).toBeNull();
  });

  it('leaves transform untouched when the overlay was never shown', () => {
    const { width: docW, height: docH } = get().document;
    const bounds = { x: 60, y: 60, width: 80, height: 60 };
    const mask = createRectSelection(bounds, docW, docH);
    get().setSelection(bounds, mask, docW, docH);

    get().pushHistory('Fill');
    get().setSelection({ x: 10, y: 10, width: 20, height: 20 }, createRectSelection({ x: 10, y: 10, width: 20, height: 20 }, docW, docH), docW, docH);

    expect(useUIStore.getState().transform).toBeNull();
    get().undo();
    expect(useUIStore.getState().transform).toBeNull();
  });
});

describe('sanity: selectionBounds helper used by the test setup', () => {
  it('computes bounds from a rect mask', () => {
    const bounds = { x: 60, y: 60, width: 80, height: 60 };
    const mask = createRectSelection(bounds, 400, 300);
    expect(selectionBounds(mask, 400, 300)).toEqual(bounds);
  });
});
