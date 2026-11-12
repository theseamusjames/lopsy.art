// @vitest-environment jsdom
import '../../test/canvas-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import type { TextLayer } from '../../types';

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
const { createTextLayer } = await import('../../layers/layer-model');

function state() {
  return useEditorStore.getState();
}

function textLayer(id: string): TextLayer {
  return state().document.layers.find((l) => l.id === id) as TextLayer;
}

/**
 * #1423 — a path-bound text layer's x/y are laid out from its path, and
 * `x - pathAnchorX` is the user's offset from it. Metadata undo kept the
 * live x/y (#783) but restored the snapshot's anchor, so after undoing an
 * anchor move or Delete Path the gap read as an offset and the text floated
 * off the restored path.
 */
describe('metadata undo restores path-bound text position with its anchor (#1423)', () => {
  let layerId: string;
  let pathId: string;

  beforeEach(() => {
    state().createDocument(800, 600, false);
    state().addPath([
      { point: { x: 150, y: 400 }, handleIn: null, handleOut: null },
      { point: { x: 650, y: 400 }, handleIn: null, handleOut: null },
    ], false);
    pathId = state().paths[0]!.id;
    const layer = createTextLayer({ name: 'Arch', text: 'HELLO' });
    state().addTextLayer(layer);
    layerId = layer.id;
    state().updateTextLayerProperties(layerId, {
      pathId, x: 128, y: 248, pathAnchorX: 128, pathAnchorY: 248, prePathX: 98, prePathY: 68,
    });
  });

  it('undoing an edit that reflowed the text puts it back on the path', () => {
    state().pushHistoryMetadata('Move Path Anchor');
    // The reflow after the anchor move updates both together.
    state().updateTextLayerProperties(layerId, { x: 127, y: 148, pathAnchorX: 127, pathAnchorY: 148 });

    state().undo();

    const l = textLayer(layerId);
    expect({ x: l.x, y: l.y }).toEqual({ x: 128, y: 248 });
    expect({ x: l.pathAnchorX, y: l.pathAnchorY }).toEqual({ x: 128, y: 248 });
    expect(l.pathId).toBe(pathId);
  });

  it('undoing Delete Path restores the bound position, not the pre-bind one', () => {
    state().removePath(pathId);
    expect(textLayer(layerId).pathId).toBeUndefined();
    expect(textLayer(layerId).x).toBe(98);

    state().undo();

    const l = textLayer(layerId);
    expect(l.pathId).toBe(pathId);
    expect({ x: l.x, y: l.y }).toEqual({ x: 128, y: 248 });
    expect({ x: l.x - l.pathAnchorX!, y: l.y - l.pathAnchorY! }).toEqual({ x: 0, y: 0 });
  });

  it('keeps a deliberate offset from the path through undo', () => {
    state().updateTextLayerProperties(layerId, { x: 148, y: 258 });
    state().pushHistoryMetadata('Move Path Anchor');
    state().updateTextLayerProperties(layerId, { x: 147, y: 158, pathAnchorX: 127, pathAnchorY: 148 });

    state().undo();

    const l = textLayer(layerId);
    expect({ x: l.x - l.pathAnchorX!, y: l.y - l.pathAnchorY! }).toEqual({ x: 20, y: 10 });
  });
});
