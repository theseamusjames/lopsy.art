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

function getState() {
  return useEditorStore.getState();
}

function layerCount() {
  return getState().document.layers.length;
}

function layerNames() {
  return getState().document.layers.map((l) => l.name);
}

function undoLabels() {
  return getState().undoStack.map((s) => s.label);
}

describe('document-slice action orchestration', () => {
  beforeEach(() => {
    getState().createDocument(10, 10, false);
  });

  it('addLayer → undo → redo round-trips layer count', () => {
    const before = layerCount();
    getState().addLayer();
    expect(layerCount()).toBe(before + 1);
    expect(undoLabels()).toContain('Add Layer');

    getState().undo();
    expect(layerCount()).toBe(before);

    getState().redo();
    expect(layerCount()).toBe(before + 1);
  });

  it('addLayer → removeLayer → undo restores the layer', () => {
    getState().addLayer();
    const addedId = getState().document.activeLayerId!;
    const addedName = getState().document.layers.find((l) => l.id === addedId)!.name;

    getState().removeLayer(addedId);
    expect(getState().document.layers.find((l) => l.id === addedId)).toBeUndefined();

    getState().undo();
    const restored = getState().document.layers.find((l) => l.id === addedId);
    expect(restored).toBeDefined();
    expect(restored!.name).toBe(addedName);
  });

  it('duplicateLayer creates a copy with a different id', () => {
    const activeId = getState().document.activeLayerId!;
    getState().duplicateLayer();
    const newActive = getState().document.activeLayerId!;
    expect(newActive).not.toBe(activeId);
    expect(undoLabels()).toContain('Duplicate Layer');
  });

  it('duplicateLayer → undo removes the duplicate', () => {
    const before = layerCount();
    getState().duplicateLayer();
    expect(layerCount()).toBe(before + 1);

    getState().undo();
    expect(layerCount()).toBe(before);
  });

  it('addLayer → duplicateLayer → mergeDown → undo → undo → redo → redo', () => {
    const initial = layerCount();

    getState().addLayer();
    expect(layerCount()).toBe(initial + 1);

    getState().duplicateLayer();
    expect(layerCount()).toBe(initial + 2);

    getState().mergeDown();
    expect(layerCount()).toBe(initial + 1);

    getState().undo();
    expect(layerCount()).toBe(initial + 2);

    getState().undo();
    expect(layerCount()).toBe(initial + 1);

    getState().redo();
    expect(layerCount()).toBe(initial + 2);

    getState().redo();
    expect(layerCount()).toBe(initial + 1);
  });

  it('flattenImage + undo restores original layers', () => {
    getState().addLayer();
    getState().addLayer();
    const before = layerCount();
    const beforeNames = layerNames();
    expect(before).toBeGreaterThanOrEqual(4);

    getState().flattenImage();
    expect(layerCount()).toBe(2);
    expect(getState().document.layers[0]!.name).toBe('Background');

    getState().undo();
    expect(layerCount()).toBe(before);
    expect(layerNames()).toEqual(beforeNames);
  });

  it('toggleLayerVisibility + undo restores visibility', () => {
    const activeId = getState().document.activeLayerId!;
    const wasBefore = getState().document.layers.find((l) => l.id === activeId)!.visible;

    getState().toggleLayerVisibility(activeId);
    expect(getState().document.layers.find((l) => l.id === activeId)!.visible).toBe(!wasBefore);

    getState().undo();
    expect(getState().document.layers.find((l) => l.id === activeId)!.visible).toBe(wasBefore);
  });

  it('no orphaned history when addLayer returns undefined', () => {
    const state = getState();
    state.createDocument(10, 10, false);
    const undoBefore = getState().undoStack.length;

    getState().addLayer();
    expect(getState().undoStack.length).toBe(undoBefore + 1);
  });

  it('cropCanvas does not push history for zero-area rect', () => {
    const undoBefore = getState().undoStack.length;
    getState().cropCanvas({ x: 0, y: 0, width: 0, height: 0 });
    expect(getState().undoStack.length).toBe(undoBefore);
  });

  it('resizeCanvas changes document dimensions', () => {
    getState().resizeCanvas(20, 30, 0.5, 0.5);
    expect(getState().document.width).toBe(20);
    expect(getState().document.height).toBe(30);
    expect(undoLabels()).toContain('Resize Canvas');
  });

  it('resizeImage scales document', () => {
    getState().resizeImage(50, 50);
    expect(getState().document.width).toBe(50);
    expect(getState().document.height).toBe(50);
    expect(undoLabels()).toContain('Resize Image');
  });

  it('addLayerMask + removeLayerMask + undo restores the mask', () => {
    const activeId = getState().document.activeLayerId!;
    getState().addLayerMask(activeId);
    expect(getState().document.layers.find((l) => l.id === activeId)!.mask).not.toBeNull();

    getState().removeLayerMask(activeId);
    expect(getState().document.layers.find((l) => l.id === activeId)!.mask).toBeNull();

    getState().undo();
    expect(getState().document.layers.find((l) => l.id === activeId)!.mask).not.toBeNull();
  });

  it('history labels are not duplicated for sequential same-type actions', () => {
    getState().addLayer();
    getState().addLayer();
    const labels = undoLabels();
    expect(labels.filter((l) => l === 'Add Layer').length).toBe(2);
  });
});
