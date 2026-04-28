// @vitest-environment jsdom
import '../test/canvas-mock';
import { describe, it, expect, beforeEach } from 'vitest';

// jsdom doesn't implement matchMedia; ui-store reads it at module-init time.
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

const { useEditorStore } = await import('./editor-store');

describe('editor-store history', () => {
  beforeEach(() => {
    // Reset the store to a known state
    useEditorStore.getState().createDocument(10, 10, false);
  });

  it('pushHistory creates a snapshot', () => {
    const state = useEditorStore.getState();
    state.pushHistory();
    expect(useEditorStore.getState().undoStack.length).toBe(1);
  });

  it('undo restores previous state', () => {
    const state = useEditorStore.getState();
    const layerId = state.document.activeLayerId!;

    // Record current pixel state
    state.pushHistory();
    const originalData = state.getOrCreateLayerPixelData(layerId);
    const originalFirstPixel = originalData.data[0];

    // Modify pixel data
    const modified = new ImageData(10, 10);
    modified.data[0] = 123;
    state.updateLayerPixelData(layerId, modified);

    // Undo should restore original
    useEditorStore.getState().undo();
    const restored = useEditorStore.getState().getOrCreateLayerPixelData(layerId);
    expect(restored.data[0]).toBe(originalFirstPixel);
  });

  it('redo restores document state', () => {
    const state = useEditorStore.getState();
    const layerId = state.document.activeLayerId!;
    const originalName = state.document.layers.find((l) => l.id === layerId)!.name;

    // Save original state
    state.pushHistory();

    // Modify document metadata (layer name)
    const updatedLayers = useEditorStore.getState().document.layers.map((l) =>
      l.id === layerId ? { ...l, name: 'Modified' } : l,
    );
    useEditorStore.setState({
      document: { ...useEditorStore.getState().document, layers: updatedLayers },
    });

    // Undo should restore the original name
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().document.layers.find((l) => l.id === layerId)!.name).toBe(originalName);

    // Redo should bring back 'Modified'
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().document.layers.find((l) => l.id === layerId)!.name).toBe('Modified');
  });

  it('GPU snapshots share blobs for unchanged layers', () => {
    const state = useEditorStore.getState();

    // Add a second layer
    state.addLayer();

    // Push two snapshots without modifying anything between them
    useEditorStore.getState().pushHistory();
    useEditorStore.getState().pushHistory();

    const undoStack = useEditorStore.getState().undoStack;
    const snapshot1 = undoStack[undoStack.length - 2]!;
    const snapshot2 = undoStack[undoStack.length - 1]!;

    // Without a GPU engine, both snapshots use EMPTY_LAYER_SENTINEL blobs,
    // which are the same reference for each layer (structural sharing)
    for (const layerId of state.document.layerOrder) {
      const blob1 = snapshot1.gpuSnapshots.get(layerId);
      const blob2 = snapshot2.gpuSnapshots.get(layerId);
      expect(blob1).toBeDefined();
      expect(blob2).toBeDefined();
      expect(blob2).toBe(blob1);
    }
  });

  it('marks dirty layers when pixel data is updated', () => {
    const state = useEditorStore.getState();
    const layerId = state.document.activeLayerId!;

    const modified = new ImageData(10, 10);
    state.updateLayerPixelData(layerId, modified);

    expect(useEditorStore.getState().dirtyLayerIds.has(layerId)).toBe(true);
  });

  it('clears dirty set after pushHistory', () => {
    const state = useEditorStore.getState();
    const layerId = state.document.activeLayerId!;

    const modified = new ImageData(10, 10);
    state.updateLayerPixelData(layerId, modified);
    expect(useEditorStore.getState().dirtyLayerIds.size).toBeGreaterThan(0);

    useEditorStore.getState().pushHistory();
    expect(useEditorStore.getState().dirtyLayerIds.size).toBe(0);
  });

  it('caps undo stack at 50 entries', () => {
    for (let i = 0; i < 60; i++) {
      useEditorStore.getState().pushHistory();
    }
    expect(useEditorStore.getState().undoStack.length).toBeLessThanOrEqual(50);
  });
});

describe('setGroupAdjustments — issue #241 (partial object black screen)', () => {
  beforeEach(() => {
    useEditorStore.getState().createDocument(10, 10, false);
  });

  it('merges a partial adjustments object with defaults so missing fields stay 0', () => {
    const state = useEditorStore.getState();
    state.addGroup('Test Group');
    const groupId = useEditorStore.getState().document.layers.find((l) => l.type === 'group')!.id;

    state.setGroupAdjustments(groupId, { exposure: 0.15, contrast: 15, vignette: 40 });

    const group = useEditorStore.getState().document.layers.find((l) => l.id === groupId);
    if (!group || group.type !== 'group') throw new Error('group missing');
    expect(group.adjustments.exposure).toBe(0.15);
    expect(group.adjustments.contrast).toBe(15);
    expect(group.adjustments.vignette).toBe(40);
    // The fields the caller omitted must NOT be undefined — that's what
    // produces the all-black GPU output. They have to be 0 (from defaults).
    expect(group.adjustments.highlights).toBe(0);
    expect(group.adjustments.shadows).toBe(0);
    expect(group.adjustments.whites).toBe(0);
    expect(group.adjustments.blacks).toBe(0);
    expect(group.adjustments.saturation).toBe(0);
    expect(group.adjustments.vibrance).toBe(0);
  });

  it('preserves previously-set adjustment fields when called with a partial follow-up object', () => {
    const state = useEditorStore.getState();
    state.addGroup('Test Group');
    const groupId = useEditorStore.getState().document.layers.find((l) => l.type === 'group')!.id;

    state.setGroupAdjustments(groupId, { exposure: 0.5, saturation: 30 });
    state.setGroupAdjustments(groupId, { exposure: 0.25 });

    const group = useEditorStore.getState().document.layers.find((l) => l.id === groupId);
    if (!group || group.type !== 'group') throw new Error('group missing');
    expect(group.adjustments.exposure).toBe(0.25);
    // saturation from the first call must be preserved across the partial second call.
    expect(group.adjustments.saturation).toBe(30);
  });
});
