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

  it('undo restores the selection to its pre-edit position', () => {
    const state = useEditorStore.getState();

    // Active selection at the original position (mirrors selecting content
    // before a move).
    const maskA = new Uint8ClampedArray(10 * 10);
    maskA[0] = 255;
    state.setSelection({ x: 0, y: 0, width: 1, height: 1 }, maskA, 10, 10);

    // Snapshot, then move the selection (as the move tool does on mouse-up).
    state.pushHistory('Move');
    const maskB = new Uint8ClampedArray(10 * 10);
    maskB[5 * 10 + 5] = 255;
    useEditorStore.getState().setSelection({ x: 5, y: 5, width: 1, height: 1 }, maskB, 10, 10);
    expect(useEditorStore.getState().selection.bounds).toEqual({ x: 5, y: 5, width: 1, height: 1 });

    // Undo must move the marquee back to where it started.
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().selection.bounds).toEqual({ x: 0, y: 0, width: 1, height: 1 });

    // Redo restores the moved selection.
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().selection.bounds).toEqual({ x: 5, y: 5, width: 1, height: 1 });
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
    expect(snapshot1.kind).toBe('pixels');
    expect(snapshot2.kind).toBe('pixels');
    if (snapshot1.kind !== 'pixels' || snapshot2.kind !== 'pixels') return;
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

describe('adjustment node actions — dynamic AdjustmentNode list on groups', () => {
  beforeEach(() => {
    useEditorStore.getState().createDocument(10, 10, false);
  });

  it('addAdjustmentNode appends a new enabled node with defaults', () => {
    const state = useEditorStore.getState();
    state.addGroup('Test Group');
    const groupId = useEditorStore.getState().document.layers.find((l) => l.type === 'group' && l.name === 'Test Group')!.id;

    state.addAdjustmentNode(groupId, 'exposure');
    state.addAdjustmentNode(groupId, 'contrast');

    const group = useEditorStore.getState().document.layers.find((l) => l.id === groupId);
    if (!group || group.type !== 'group') throw new Error('group missing');
    expect(group.adjustments.length).toBe(2);
    const expNode = group.adjustments[0];
    expect(expNode?.type).toBe('exposure');
    expect(expNode?.enabled).toBe(true);
    const conNode = group.adjustments[1];
    expect(conNode?.type).toBe('contrast');
  });

  it('updateAdjustmentNode changes node params without affecting other nodes', () => {
    const state = useEditorStore.getState();
    state.addGroup('Test Group');
    const groupId = useEditorStore.getState().document.layers.find((l) => l.type === 'group' && l.name === 'Test Group')!.id;

    state.addAdjustmentNode(groupId, 'exposure');
    state.addAdjustmentNode(groupId, 'saturation');

    const midGroup = useEditorStore.getState().document.layers.find((l) => l.id === groupId);
    if (!midGroup || midGroup.type !== 'group') throw new Error('group missing');
    const nodeId = midGroup.adjustments[0]!.id;

    state.updateAdjustmentNode(groupId, nodeId, { exposure: 0.5 });

    const group = useEditorStore.getState().document.layers.find((l) => l.id === groupId);
    if (!group || group.type !== 'group') throw new Error('group missing');
    const expNode = group.adjustments.find((n) => n.type === 'exposure');
    if (!expNode || expNode.type !== 'exposure') throw new Error('exposure node missing');
    expect(expNode.exposure).toBe(0.5);
    // Other nodes are untouched.
    expect(group.adjustments.find((n) => n.type === 'saturation')).toBeDefined();
  });

  it('removeAdjustmentNode removes only the specified node', () => {
    const state = useEditorStore.getState();
    state.addGroup('Test Group');
    const groupId = useEditorStore.getState().document.layers.find((l) => l.type === 'group' && l.name === 'Test Group')!.id;

    state.addAdjustmentNode(groupId, 'exposure');
    state.addAdjustmentNode(groupId, 'vignette');

    const midGroup = useEditorStore.getState().document.layers.find((l) => l.id === groupId);
    if (!midGroup || midGroup.type !== 'group') throw new Error('group missing');
    const nodeId = midGroup.adjustments[0]!.id;
    state.removeAdjustmentNode(groupId, nodeId);

    const group = useEditorStore.getState().document.layers.find((l) => l.id === groupId);
    if (!group || group.type !== 'group') throw new Error('group missing');
    expect(group.adjustments.length).toBe(1);
    expect(group.adjustments[0]?.type).toBe('vignette');
  });

  it('toggleAdjustmentNode flips the enabled field', () => {
    const state = useEditorStore.getState();
    state.addGroup('Test Group');
    const groupId = useEditorStore.getState().document.layers.find((l) => l.type === 'group' && l.name === 'Test Group')!.id;

    state.addAdjustmentNode(groupId, 'exposure');
    const midGroup = useEditorStore.getState().document.layers.find((l) => l.id === groupId);
    if (!midGroup || midGroup.type !== 'group') throw new Error('group missing');
    const nodeId = midGroup.adjustments[0]!.id;

    state.toggleAdjustmentNode(groupId, nodeId);
    const group = useEditorStore.getState().document.layers.find((l) => l.id === groupId);
    if (!group || group.type !== 'group') throw new Error('group missing');
    expect(group.adjustments[0]?.enabled).toBe(false);

    state.toggleAdjustmentNode(groupId, nodeId);
    const group2 = useEditorStore.getState().document.layers.find((l) => l.id === groupId);
    if (!group2 || group2.type !== 'group') throw new Error('group missing');
    expect(group2.adjustments[0]?.enabled).toBe(true);
  });

  it('reorderAdjustmentNodes reorders nodes to the requested sequence', () => {
    const state = useEditorStore.getState();
    state.addGroup('Test Group');
    const groupId = useEditorStore.getState().document.layers.find((l) => l.type === 'group' && l.name === 'Test Group')!.id;

    state.addAdjustmentNode(groupId, 'exposure');
    state.addAdjustmentNode(groupId, 'contrast');
    state.addAdjustmentNode(groupId, 'vignette');

    const beforeGroup = useEditorStore.getState().document.layers.find((l) => l.id === groupId);
    if (!beforeGroup || beforeGroup.type !== 'group') throw new Error('group missing');
    const [expId, conId, vigId] = beforeGroup.adjustments.map((n) => n.id);

    // Reverse the order
    state.reorderAdjustmentNodes(groupId, [vigId!, conId!, expId!]);

    const afterGroup = useEditorStore.getState().document.layers.find((l) => l.id === groupId);
    if (!afterGroup || afterGroup.type !== 'group') throw new Error('group missing');
    expect(afterGroup.adjustments[0]?.type).toBe('vignette');
    expect(afterGroup.adjustments[1]?.type).toBe('contrast');
    expect(afterGroup.adjustments[2]?.type).toBe('exposure');
  });
});
