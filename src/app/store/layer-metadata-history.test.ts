// @vitest-environment jsdom
import '../../test/canvas-mock';
import { describe, it, expect, beforeEach } from 'vitest';

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

const { useEditorStore } = await import('../editor-store');

function state() {
  return useEditorStore.getState();
}

function layer(id: string) {
  const found = state().document.layers.find((l) => l.id === id);
  if (!found) throw new Error(`layer ${id} missing`);
  return found;
}

function topLabel(): string | undefined {
  return state().undoStack[state().undoStack.length - 1]?.label;
}

/**
 * #1014 — rename, lock and colour tag used to skip history, so undoing the
 * step before them restored the older snapshot's metadata and reverted them.
 */
describe('layer metadata edits are their own history steps (#1014)', () => {
  let id = '';

  beforeEach(() => {
    state().createDocument(40, 30, true);
    state().addLayer();
    id = state().document.activeLayerId ?? '';
    state().pushHistory('Fill');
  });

  it('rename pushes a metadata entry that undo and redo step through', () => {
    const original = layer(id).name;
    const depth = state().undoStack.length;

    state().renameLayer(id, 'Red Box');

    expect(state().undoStack.length).toBe(depth + 1);
    expect(topLabel()).toBe('Rename Layer');
    expect(state().undoStack[depth]?.kind).toBe('metadata');

    state().undo();
    expect(layer(id).name).toBe(original);
    expect(topLabel()).toBe('Fill');

    state().redo();
    expect(layer(id).name).toBe('Red Box');
  });

  it('renaming to the current name pushes nothing', () => {
    const depth = state().undoStack.length;
    state().renameLayer(id, layer(id).name);
    expect(state().undoStack.length).toBe(depth);
  });

  it('lock toggles are undoable steps', () => {
    const depth = state().undoStack.length;
    state().toggleLayerLock(id);
    expect(layer(id).locked).toBe(true);
    expect(topLabel()).toBe('Lock Layer');

    state().toggleLayerLock(id);
    expect(topLabel()).toBe('Unlock Layer');
    expect(state().undoStack.length).toBe(depth + 2);

    state().undo();
    expect(layer(id).locked).toBe(true);
    state().undo();
    expect(layer(id).locked).toBe(false);
  });

  it('colour tags are undoable steps and re-setting the same tag pushes nothing', () => {
    const depth = state().undoStack.length;
    state().setLayerColorTag(id, 'red');
    expect(topLabel()).toBe('Set Color Tag');
    state().setLayerColorTag(id, 'red');
    expect(state().undoStack.length).toBe(depth + 1);

    state().setLayerColorTag(id, null);
    expect(topLabel()).toBe('Clear Color Tag');

    state().undo();
    expect(layer(id).colorTag).toBe('red');
    state().undo();
    expect(layer(id).colorTag ?? null).toBeNull();
  });

  it('clearing a tag that was never set pushes nothing', () => {
    const depth = state().undoStack.length;
    state().setLayerColorTag(id, null);
    expect(state().undoStack.length).toBe(depth);
  });
});
