import { useEditorStore } from './editor-store';
import { getLayerTextureDimensions, type Engine } from '../engine-wasm/wasm-bridge';
import { pixelDataManager } from '../engine/pixel-data-manager';
import type { Layer } from '../types';

/**
 * After the WASM engine expands a layer texture to the union of the document
 * area and the existing content area (via `ensure_layer_full_size`, called
 * from `beginStroke` and `prewarmStroke`), the JS-side layer.x/y/w/h must be
 * updated to match — otherwise the next `syncLayers` push would clobber the
 * engine's expanded dimensions with the stale JS values.
 *
 * Returns the updated layer when a sync was needed, or null otherwise so
 * callers that depend on the post-sync position can refresh their local
 * state without re-reading the store.
 */
export function syncLayerAfterFullSize(engine: Engine, activeLayerId: string): Layer | null {
  const docState = useEditorStore.getState().document;
  const currentLayer = docState.layers.find((l) => l.id === activeLayerId);
  if (!currentLayer || currentLayer.type === 'group') return null;

  let layerW: number;
  let layerH: number;
  if (currentLayer.type === 'raster') {
    layerW = currentLayer.width;
    layerH = currentLayer.height;
  } else {
    const dims = getLayerTextureDimensions(engine, activeLayerId);
    layerW = dims?.[0] ?? docState.width;
    layerH = dims?.[1] ?? docState.height;
  }
  const newX = Math.min(0, currentLayer.x);
  const newY = Math.min(0, currentLayer.y);
  const newW = Math.max(docState.width, currentLayer.x + layerW) - newX;
  const newH = Math.max(docState.height, currentLayer.y + layerH) - newY;
  const needsSync = currentLayer.x !== newX || currentLayer.y !== newY
    || (currentLayer.type === 'raster' && (currentLayer.width !== newW || currentLayer.height !== newH));
  if (!needsSync) return null;

  const updatedLayers = docState.layers.map((l) => {
    if (l.id !== activeLayerId) return l;
    if (l.type === 'raster') {
      return { ...l, x: newX, y: newY, width: newW, height: newH } as Layer;
    }
    return { ...l, x: newX, y: newY } as Layer;
  });
  pixelDataManager.remove(activeLayerId);
  const dirtyIds = new Set(useEditorStore.getState().dirtyLayerIds);
  dirtyIds.add(activeLayerId);
  useEditorStore.setState({
    document: { ...docState, layers: updatedLayers },
    dirtyLayerIds: dirtyIds,
  });
  return updatedLayers.find((l) => l.id === activeLayerId) ?? null;
}
