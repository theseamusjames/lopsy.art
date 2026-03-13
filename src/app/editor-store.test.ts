// @vitest-environment jsdom
import '../test/canvas-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editor-store';

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

  it('redo restores undone state', () => {
    const state = useEditorStore.getState();
    const layerId = state.document.activeLayerId!;

    state.pushHistory();
    const modified = new ImageData(10, 10);
    modified.data[0] = 200;
    state.updateLayerPixelData(layerId, modified);
    state.pushHistory();

    useEditorStore.getState().undo();
    useEditorStore.getState().redo();
    const final = useEditorStore.getState().getOrCreateLayerPixelData(layerId);
    expect(final.data[0]).toBe(200);
  });

  it('structural sharing: unchanged layers share references in snapshots', () => {
    const state = useEditorStore.getState();
    const layerId = state.document.activeLayerId!;

    // Add a second layer (so we can test unchanged layers)
    state.addLayer();
    const layer2Id = useEditorStore.getState().document.activeLayerId!;

    // Push history, then modify only layer 2
    useEditorStore.getState().pushHistory();
    const modified = new ImageData(10, 10);
    modified.data[0] = 42;
    useEditorStore.getState().updateLayerPixelData(layer2Id, modified);

    // Push another snapshot
    useEditorStore.getState().pushHistory();

    // The two snapshots should share the reference for layer 1 (unchanged)
    const undoStack = useEditorStore.getState().undoStack;
    const snapshot1 = undoStack[undoStack.length - 2]!;
    const snapshot2 = undoStack[undoStack.length - 1]!;

    // Layer 1 was not modified between pushes — should be same reference
    expect(snapshot2.layerPixelData.get(layerId)).toBe(
      snapshot1.layerPixelData.get(layerId),
    );

    // Layer 2 WAS modified — should be different references
    expect(snapshot2.layerPixelData.get(layer2Id)).not.toBe(
      snapshot1.layerPixelData.get(layer2Id),
    );
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
