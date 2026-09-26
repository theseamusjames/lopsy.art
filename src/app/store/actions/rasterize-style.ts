import type { DocumentState, Layer } from '../../../types';
import type { ActionResult } from '../types';
import { hasEnabledEffects, DEFAULT_EFFECTS } from '../../../layers/layer-model';
import { getEngine } from '../../../engine-wasm/engine-state';
import { rasterizeLayerEffects, uploadLayerPixels } from '../../../engine-wasm/wasm-bridge';
import { pixelDataManager } from '../../../engine/pixel-data-manager';
import { invalidateBitmapCache } from '../../../engine/bitmap-cache';

/**
 * Whether the active layer has anything for `computeRasterizeStyle` to bake.
 * Pure metadata check — no GPU mutation. Callers use this to decide whether
 * to push a history entry *before* calling `computeRasterizeStyle`, since
 * that function bakes pixels to the GPU as a side effect (#903).
 */
export function canRasterizeLayerStyle(doc: DocumentState): boolean {
  const activeId = doc.activeLayerId;
  if (!activeId) return false;
  const layer = doc.layers.find((l) => l.id === activeId);
  if (!layer || !hasEnabledEffects(layer.effects)) return false;
  return getEngine() !== null;
}

/**
 * Rasterize the active layer's effects into its own texture.
 *
 * The read + upload happens entirely GPU-side via
 * `rasterizeLayerEffects` + `uploadLayerPixels`; no JS-side pixel
 * buffer is threaded through (#746). The caller does not need to
 * `resolveAllPixelData` beforehand or `syncPixelDataToGpu` afterward.
 *
 * This mutates the GPU texture directly, so the caller must call
 * `pushHistory` beforehand — see `canRasterizeLayerStyle` (#903).
 */
export function computeRasterizeStyle(
  doc: DocumentState,
): ActionResult | undefined {
  if (!canRasterizeLayerStyle(doc)) return undefined;
  const activeId = doc.activeLayerId as string;

  const engine = getEngine();
  if (!engine) return undefined;

  // GPU-side: render layer with effects, then replace layer texture
  const pixels = rasterizeLayerEffects(engine, activeId);
  if (!pixels || pixels.length === 0) return undefined;

  // Upload rasterized result back to the layer's GPU texture
  uploadLayerPixels(engine, activeId, pixels, doc.width, doc.height, 0, 0);

  // GPU is source of truth for the active layer — drop stale JS pixel
  // data and bitmap cache.
  pixelDataManager.remove(activeId);
  invalidateBitmapCache(activeId);

  return {
    document: {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === activeId
          ? {
              ...l,
              x: 0,
              y: 0,
              effects: DEFAULT_EFFECTS,
              ...(l.type === 'raster' || l.type === 'text' ? { type: 'raster' as const, width: doc.width, height: doc.height } : {}),
            } as Layer
          : l,
      ),
    },
  };
}
