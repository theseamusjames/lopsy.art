// @vitest-environment jsdom
import '../../test/canvas-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import type { PathAnchor } from '../../tools/path/path';
import { nextPathName } from './paths-slice';

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

function anchor(x: number, y: number): PathAnchor {
  return { point: { x, y }, handleIn: null, handleOut: null };
}

const TRIANGLE = [anchor(10, 10), anchor(90, 10), anchor(50, 80)];

function addPathWithHistory(): string {
  state().pushHistoryMetadata('Add Path');
  state().addPath(TRIANGLE, true);
  const id = state().selectedPathId;
  if (!id) throw new Error('addPath did not select the new path');
  return id;
}

describe('paths slice history (#1179)', () => {
  beforeEach(() => {
    state().createDocument(200, 150, true);
  });

  it('Delete Path pushes a history entry so undo restores the path', () => {
    const id = addPathWithHistory();
    const depth = state().undoStack.length;

    state().removePath(id);

    expect(state().paths).toHaveLength(0);
    expect(state().undoStack).toHaveLength(depth + 1);
    expect(state().undoStack[state().undoStack.length - 1]?.label).toBe('Delete Path');

    state().undo();
    expect(state().paths.map((p) => p.id)).toEqual([id]);
    expect(state().selectedPathId).toBe(id);

    state().redo();
    expect(state().paths).toHaveLength(0);
  });

  it('undoing a Delete Path does not also undo the edit before it', () => {
    const id = addPathWithHistory();
    state().pushHistoryMetadata('Rename Layer');
    const layerId = state().document.activeLayerId;
    if (!layerId) throw new Error('no active layer');
    state().updateLayerOpacity(layerId, 0.4);

    state().removePath(id);
    state().undo();

    expect(state().paths.map((p) => p.id)).toEqual([id]);
    const layer = state().document.layers.find((l) => l.id === layerId);
    expect(layer?.opacity).toBe(0.4);
  });

  it('skipHistory removes without recording an entry', () => {
    const id = addPathWithHistory();
    const depth = state().undoStack.length;
    state().removePath(id, true);
    expect(state().paths).toHaveLength(0);
    expect(state().undoStack).toHaveLength(depth);
  });

  it('removing an unknown path records nothing', () => {
    addPathWithHistory();
    const depth = state().undoStack.length;
    state().removePath('missing');
    expect(state().undoStack).toHaveLength(depth);
    expect(state().paths).toHaveLength(1);
  });

  it('Rename Path pushes a history entry so undo restores the old name', () => {
    const id = addPathWithHistory();
    const oldName = state().paths[0]?.name;
    state().renamePath(id, 'Outline');
    expect(state().paths[0]?.name).toBe('Outline');
    expect(state().undoStack[state().undoStack.length - 1]?.label).toBe('Rename Path');
    state().undo();
    expect(state().paths[0]?.name).toBe(oldName);
  });
});

describe('nextPathName (#1086)', () => {
  it('starts at Path 1 in a document with no paths', () => {
    expect(nextPathName([])).toBe('Path 1');
  });

  it('numbers past the highest loaded default name', () => {
    expect(nextPathName([{ name: 'Path 1' }, { name: 'Path 2' }])).toBe('Path 3');
    expect(nextPathName([{ name: 'Path 10' }, { name: 'Path 2' }])).toBe('Path 11');
  });

  it('ignores renamed paths and names that only resemble the default', () => {
    expect(nextPathName([{ name: 'Mic handle' }, { name: 'Path 4 copy' }, { name: 'My Path 9' }])).toBe('Path 1');
    expect(nextPathName([{ name: 'Outline' }, { name: 'Path 3' }])).toBe('Path 4');
  });
});
