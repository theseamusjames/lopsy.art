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
 * Issue #761 — batched undo/redo.
 *
 * The old HistoryPanel jump ran `undo()` in a loop and each call did a
 * `resetTrackedState` + `syncLayers` pass, so masks and selection re-
 * uploaded once per intermediate step. `undoBy(N)` / `redoBy(N)` collapse
 * that into one restore + sync while preserving stack invariants.
 */
describe('undoBy / redoBy — batched history jumps (#761)', () => {
  beforeEach(() => {
    get().createDocument(10, 10, false);
  });

  it('undoBy(N) matches N consecutive undo() calls for stack length', () => {
    for (let i = 0; i < 4; i++) get().addLayer();
    const countBefore = get().document.layers.length;
    const undoLen = get().undoStack.length;

    get().undoBy(3);

    expect(get().undoStack.length).toBe(undoLen - 3);
    expect(get().redoStack.length).toBe(3);
    // Three undos of Add Layer put us back three layers.
    expect(get().document.layers.length).toBe(countBefore - 3);
  });

  it('undoBy(N) matches N sequential undo() calls for final document state', () => {
    for (let i = 0; i < 4; i++) get().addLayer();
    const namesBefore = get().document.layers.map((l) => l.name);

    // Reset and re-play — first path: N calls to undo().
    get().createDocument(10, 10, false);
    for (let i = 0; i < 4; i++) get().addLayer();
    for (let i = 0; i < 3; i++) get().undo();
    const namesAfterLoop = get().document.layers.map((l) => l.name);

    // Reset and re-play — second path: one undoBy(3).
    get().createDocument(10, 10, false);
    for (let i = 0; i < 4; i++) get().addLayer();
    get().undoBy(3);
    const namesAfterBatch = get().document.layers.map((l) => l.name);

    expect(namesAfterBatch).toEqual(namesAfterLoop);
    expect(namesBefore.length).toBeGreaterThan(namesAfterBatch.length);
  });

  it('undoBy then redoBy round-trips through the same intermediate states', () => {
    for (let i = 0; i < 4; i++) get().addLayer();
    const finalNames = get().document.layers.map((l) => l.name);

    get().undoBy(3);
    get().redoBy(3);

    expect(get().document.layers.map((l) => l.name)).toEqual(finalNames);
    expect(get().redoStack.length).toBe(0);
  });

  it('undoBy(N) followed by single redo() steps returns through the intermediate states', () => {
    for (let i = 0; i < 3; i++) get().addLayer();
    const namesAtEach: string[][] = [];
    // Capture the state after each addLayer for comparison.
    // We can reconstruct these by walking the undoStack: undoStack[i].document
    // == state right before edit i+1.
    const undoDocs = get().undoStack.map((s) => s.document.layers.map((l) => l.name));

    get().undoBy(3);
    // After batch: we should be at the state right before the first addLayer.
    expect(get().document.layers.map((l) => l.name)).toEqual(undoDocs[0]);

    get().redo();
    namesAtEach.push(get().document.layers.map((l) => l.name));
    get().redo();
    namesAtEach.push(get().document.layers.map((l) => l.name));
    get().redo();
    namesAtEach.push(get().document.layers.map((l) => l.name));

    // Each individual redo should end at the same layer set the corresponding
    // addLayer left. undoDocs[i+1] captures the state after edit i (before edit
    // i+1); the last one is captured only after the final layer name matches.
    expect(namesAtEach[0]).toEqual(undoDocs[1]);
    expect(namesAtEach[1]).toEqual(undoDocs[2]);
    // Third redo brings us back to the original 3-add state.
    expect(namesAtEach[2]?.length).toBe(undoDocs[2]!.length + 1);
  });

  it('undoBy(N) with N > stack size just undoes the whole stack', () => {
    get().addLayer();
    const startNames = get().document.layers.map((l) => l.name);

    get().undoBy(999);

    expect(get().undoStack.length).toBe(0);
    // Redo stack length equals what we could actually undo.
    expect(get().redoStack.length).toBeGreaterThan(0);
    expect(get().document.layers.map((l) => l.name)).not.toEqual(startNames);
  });

  it('undoBy(0) is a no-op', () => {
    get().addLayer();
    const before = {
      undoLen: get().undoStack.length,
      redoLen: get().redoStack.length,
      names: get().document.layers.map((l) => l.name),
    };

    get().undoBy(0);
    get().undoBy(-1);

    expect(get().undoStack.length).toBe(before.undoLen);
    expect(get().redoStack.length).toBe(before.redoLen);
    expect(get().document.layers.map((l) => l.name)).toEqual(before.names);
  });

  it('redoBy is a no-op when redoStack is empty', () => {
    get().addLayer();
    const before = {
      undoLen: get().undoStack.length,
      redoLen: get().redoStack.length,
    };

    get().redoBy(3);

    expect(get().undoStack.length).toBe(before.undoLen);
    expect(get().redoStack.length).toBe(before.redoLen);
  });

  it('undo() still works via the batched implementation', () => {
    get().addLayer();
    get().addLayer();
    const before = get().document.layers.length;

    get().undo();

    expect(get().document.layers.length).toBe(before - 1);
    expect(get().redoStack.length).toBe(1);
  });
});
