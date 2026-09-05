import type { DocumentState } from '../../../types';
import type { ActionResult } from '../types';
import { getEngine } from '../../../engine-wasm/engine-state';
import { mergeLayers, rasterizeLayerEffects, updateLayer, uploadLayerPixels } from '../../../engine-wasm/wasm-bridge';
import { layerToDescJson } from '../../../engine-wasm/sync-layers';
import { DEFAULT_EFFECTS, hasEnabledEffects } from '../../../layers/layer-model';
import { removeFromParentGroup } from '../../../layers/group-utils';
import { pixelDataManager } from '../../../engine/pixel-data-manager';
import { invalidateBitmapCache } from '../../../engine/bitmap-cache';

/**
 * Merge the active layer into the layer below it on the GPU.
 *
 * `mergeLayers` composites top onto bottom on the GPU — no pixel data
 * is read or produced on the JS side (#746). The caller does not need
 * to `resolveAllPixelData` beforehand, and does not need to
 * `syncPixelDataToGpu` afterward. Any stale JS-side pixel cache for
 * the two touched layers is invalidated here.
 */
export function computeMergeDown(
  doc: DocumentState,
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
    if (hasEnabledEffects(topLayer.effects)) {
      const rasterized = rasterizeLayerEffects(engine, activeId);
      if (rasterized && rasterized.length > 0) {
        uploadLayerPixels(engine, activeId, rasterized, doc.width, doc.height, 0, 0);
        const cleared = { ...topLayer, x: 0, y: 0, width: doc.width, height: doc.height, effects: DEFAULT_EFFECTS, mask: null };
        updateLayer(engine, layerToDescJson(cleared, topLayer.visible));
      }
    }

    if (hasEnabledEffects(bottomLayer.effects)) {
      const rasterized = rasterizeLayerEffects(engine, belowId);
      if (rasterized && rasterized.length > 0) {
        uploadLayerPixels(engine, belowId, rasterized, doc.width, doc.height, 0, 0);
        const cleared = { ...bottomLayer, x: 0, y: 0, width: doc.width, height: doc.height, effects: DEFAULT_EFFECTS, mask: null };
        updateLayer(engine, layerToDescJson(cleared, bottomLayer.visible));
      }
    }

    // GPU-side merge: composite top onto bottom.
    // mergeLayers calls ensure_layer_full_size on the bottom layer,
    // which may reposition it to (0, 0). The JS position update below
    // keeps the store in sync.
    mergeLayers(engine, activeId, belowId);
  }

  // GPU is source of truth for the two touched layers — drop stale JS
  // pixel data and bitmap caches so a subsequent read pulls from the
  // freshly-composited GPU texture.
  pixelDataManager.remove(activeId);
  pixelDataManager.remove(belowId);
  invalidateBitmapCache(activeId);
  invalidateBitmapCache(belowId);

  // Remove merged layer from its parent group's children
  let layers = removeFromParentGroup(doc.layers, activeId);
  layers = layers.filter((l) => l.id !== activeId);

  // mergeLayers bakes both layers' opacities and blend modes into the
  // merged content, so the result layer resets to opacity 1 / normal blend.
  layers = layers.map((l) => {
    if (l.id !== belowId) return l;
    return { ...l, effects: DEFAULT_EFFECTS, opacity: 1, blendMode: 'normal' as const, x: 0, y: 0, width: doc.width, height: doc.height } as typeof l;
  });

  return {
    document: {
      ...doc,
      layers,
      layerOrder: doc.layerOrder.filter((id) => id !== activeId),
      activeLayerId: belowId,
    },
  };
}
