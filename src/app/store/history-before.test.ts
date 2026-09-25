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

function get() {
  return useEditorStore.getState();
}

/**
 * #813 — pushHistory can substitute one layer's descriptor and GPU handle
 * with a copy captured before the operation began mutating it.
 */
describe('pushHistory with a captured "before" layer', () => {
  beforeEach(() => {
    get().createDocument(10, 10, false);
  });

  it('records the captured layer and handle instead of the live ones', () => {
    get().addLayer();
    const live = get().document.layers.find((l) => l.id === get().document.activeLayerId)!;
    const before = { ...live, x: 3, y: 4, name: 'pre-edit' };

    get().pushHistory('Text', { layer: before, gpuHandle: 42 });

    const top = get().undoStack[get().undoStack.length - 1]!;
    expect(top.kind).toBe('pixels');
    if (top.kind !== 'pixels') return;
    expect(top.label).toBe('Text');
    expect(top.document.layers.find((l) => l.id === live.id)).toBe(before);
    expect(top.gpuSnapshots.get(live.id)).toBe(42);
    expect(get().document.layers.find((l) => l.id === live.id)).toBe(live);
  });

  it('keeps the substituted layer dirty so the next snapshot copies its live texture', () => {
    get().addLayer();
    const live = get().document.layers.find((l) => l.id === get().document.activeLayerId)!;

    get().pushHistory('Text', { layer: live, gpuHandle: 42 });
    expect([...get().dirtyLayerIds]).toEqual([live.id]);

    get().pushHistory('Other');
    expect(get().dirtyLayerIds.size).toBe(0);
  });

  it('undo restores the captured descriptor', () => {
    get().addLayer();
    const live = get().document.layers.find((l) => l.id === get().document.activeLayerId)!;
    const before = { ...live, name: 'pre-edit' };

    get().pushHistory('Text', { layer: before, gpuHandle: 42 });
    get().renameLayer(live.id, 'post-edit');
    get().undo();

    expect(get().document.layers.find((l) => l.id === live.id)?.name).toBe('pre-edit');
  });
});
