import type { DocumentState } from '../../../types';
import type { EditorState } from '../types';
import { getEngine } from '../../../engine-wasm/engine-state';
import { mergeLayers, rasterizeLayerEffects, uploadLayerPixels } from '../../../engine-wasm/wasm-bridge';
import { hasEnabledEffects } from '../../../layers/layer-model';

export function computeMergeDown(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
): Partial<EditorState> | undefined {
  const activeId = doc.activeLayerId;
  if (!activeId) return undefined;
  const orderIdx = doc.layerOrder.indexOf(activeId);
  if (orderIdx <= 0) return undefined;
  const belowId = doc.layerOrder[orderIdx - 1];
  if (!belowId) return undefined;

  const topLayer = doc.layers.find((l) => l.id === activeId);
  const bottomLayer = doc.layers.find((l) => l.id === belowId);
  if (!topLayer || !bottomLayer) return undefined;

  const engine = getEngine();
  if (engine) {
    // If top layer has effects, rasterize them first
    if (hasEnabledEffects(topLayer.effects)) {
      const rasterized = rasterizeLayerEffects(engine, activeId);
      if (rasterized && rasterized.length > 0) {
        uploadLayerPixels(engine, activeId, rasterized, doc.width, doc.height, 0, 0);
      }
    }

    // GPU-side merge: composite top onto bottom
    mergeLayers(engine, activeId, belowId);
  }

  // Clear stale JS pixel data
  const pixelData = new Map(layerPixelData);
  pixelData.delete(activeId);
  pixelData.delete(belowId);

  return {
    document: {
      ...doc,
      layers: doc.layers.filter((l) => l.id !== activeId),
      layerOrder: doc.layerOrder.filter((id) => id !== activeId),
      activeLayerId: belowId,
    },
    layerPixelData: pixelData,
  };
}
