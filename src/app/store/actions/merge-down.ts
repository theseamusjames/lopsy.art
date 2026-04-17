import type { DocumentState } from '../../../types';
import type { ActionResult } from '../types';
import { getEngine } from '../../../engine-wasm/engine-state';
import { mergeLayers, rasterizeLayerEffects, uploadLayerPixels } from '../../../engine-wasm/wasm-bridge';
import { hasEnabledEffects } from '../../../layers/layer-model';
import { removeFromParentGroup } from '../../../layers/group-utils';

export function computeMergeDown(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
): ActionResult | undefined {
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

  // Remove merged layer from its parent group's children
  let layers = removeFromParentGroup(doc.layers, activeId);
  layers = layers.filter((l) => l.id !== activeId);

  return {
    document: {
      ...doc,
      layers,
      layerOrder: doc.layerOrder.filter((id) => id !== activeId),
      activeLayerId: belowId,
    },
    layerPixelData: pixelData,
  };
}
