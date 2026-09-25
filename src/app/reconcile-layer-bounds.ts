import type { Layer } from '../types';
import type { Engine } from '../engine-wasm/wasm-bridge';
import { getLayerEngineBounds } from '../engine-wasm/wasm-bridge';
import { useEditorStore } from './editor-store';
import { clearJsPixelData } from './store/clear-js-pixel-data';

export interface LayerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The store fields that must change for `layer` to describe a texture placed
 * at `engine` — or null when they already agree. Raster layers carry their
 * texture size in width/height; other layer types only track x/y.
 */
export function boundsPatchForEngine(layer: Layer, engine: LayerBounds): Partial<LayerBounds> | null {
  if (layer.type === 'group') return null;
  if (engine.width <= 0 || engine.height <= 0) return null;
  const patch: Partial<LayerBounds> = {};
  if (layer.x !== engine.x) patch.x = engine.x;
  if (layer.y !== engine.y) patch.y = engine.y;
  if (layer.type === 'raster') {
    if (layer.width !== engine.width) patch.width = engine.width;
    if (layer.height !== engine.height) patch.height = engine.height;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Copy the engine's placement of a layer's texture into the store.
 *
 * Several engine operations re-place a layer's texture on their own — a float
 * expands the layer to the document (union its content), a transform grows
 * the float past the canvas. The store's x/y/width/height must follow, or the
 * next full resync (every undo/redo resets tracked state) pushes the stale
 * store bounds back onto the resized texture and the content lands offset by
 * the layer's old position (#810), or a later operation reads a stale rect
 * (#822). Returns true when the store changed.
 */
export function reconcileLayerBoundsWithEngine(engine: Engine, layerId: string): boolean {
  const state = useEditorStore.getState();
  const layer = state.document.layers.find((l) => l.id === layerId);
  if (!layer) return false;
  const [x = 0, y = 0, width = 0, height = 0] = getLayerEngineBounds(engine, layerId);
  const patch = boundsPatchForEngine(layer, { x, y, width, height });
  if (!patch) return false;

  useEditorStore.setState((s) => ({
    document: {
      ...s.document,
      layers: s.document.layers.map((l) => (l.id === layerId ? ({ ...l, ...patch } as Layer) : l)),
    },
    renderVersion: s.renderVersion + 1,
  }));
  clearJsPixelData(layerId);
  return true;
}
