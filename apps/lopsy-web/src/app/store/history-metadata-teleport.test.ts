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

/**
 * #783 — undoing / redoing a metadata edit (blend mode change, opacity
 * tweak, effect toggle, …) must not revert side-effect position changes
 * made by `transitionActiveLayer` between the snapshot and the undo.
 *
 * The trigger: while a layer is active it is expanded to the document
 * area; on activation of another layer it is cropped back to content.
 * A metadata snapshot captures whichever descriptor was live at the time.
 * Restoring the snapshot's descriptor (0,0,docW,docH) on top of an
 * engine texture that was later cropped to (200,150,100,80) misaligned
 * the two by exactly the layer's own (x, y) — (2x, 2y) after another
 * undo, (0, 0) after redoing back. The fix keeps positions from the
 * live document when the target snapshot is metadata-only.
 */
describe('metadata undo preserves current layer positions (#783)', () => {
  beforeEach(() => {
    state().createDocument(400, 300, false);
  });

  it('undoing a blend-mode change does not shift the OTHER layer', () => {
    // Simulate two layers with different (x, y) so a "revert positions
    // from snapshot" bug would visibly move at least one of them.
    state().addLayer();
    const t = state().document.activeLayerId!;
    // Move T off-origin without pushing a Move history (direct API).
    state().updateLayerPosition(t, 30, 40);

    state().addLayer();
    const box = state().document.activeLayerId!;
    state().updateLayerPosition(box, 200, 150);

    // Change T's blend mode. Grab pre-change positions so we can assert
    // undo restores them but NOT any subsequent side-effect changes to
    // "the other" layer.
    state().setActiveLayer(t);
    state().pushHistoryMetadata('Change Blend Mode');
    state().updateLayerBlendMode(t, 'multiply');

    // Emulate what transitionActiveLayer does on a layer switch: shift
    // the previously-active layer's descriptor. If this shift is
    // reverted by the undo, the layer teleports (#783).
    state().updateLayerPosition(t, 0, 0);

    // Change Box's blend mode.
    state().setActiveLayer(box);
    state().pushHistoryMetadata('Change Blend Mode');
    state().updateLayerBlendMode(box, 'multiply');

    // Undo both metadata steps.
    state().undo();
    state().undo();

    // Both layers should keep whatever position was live when we undid
    // — updateLayerPosition wasn't undone, only the blend mode was.
    const layers = state().document.layers;
    const tAfter = layers.find((l) => l.id === t)!;
    const boxAfter = layers.find((l) => l.id === box)!;
    expect({ x: tAfter.x, y: tAfter.y }).toEqual({ x: 0, y: 0 });
    expect({ x: boxAfter.x, y: boxAfter.y }).toEqual({ x: 200, y: 150 });
    // The blend modes are back to normal (undone).
    expect(tAfter.blendMode).toBe('normal');
    expect(boxAfter.blendMode).toBe('normal');
  });

  it('redoing a metadata step also preserves live positions', () => {
    state().addLayer();
    const t = state().document.activeLayerId!;
    state().updateLayerPosition(t, 30, 40);

    state().pushHistoryMetadata('Change Blend Mode');
    state().updateLayerBlendMode(t, 'multiply');
    state().undo();
    // Move the layer AFTER the undo — this is the state redo has to
    // preserve.
    state().updateLayerPosition(t, 100, 100);
    state().redo();

    const layer = state().document.layers.find((l) => l.id === t)!;
    expect({ x: layer.x, y: layer.y }).toEqual({ x: 100, y: 100 });
    expect(layer.blendMode).toBe('multiply');
  });
});
