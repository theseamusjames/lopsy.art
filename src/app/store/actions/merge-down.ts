import type { DocumentState } from '../../../types';
import type { ActionResult } from '../types';
import { getEngine } from '../../../engine-wasm/engine-state';
import { mergeLayers, rasterizeLayerEffects, updateLayer, uploadLayerPixels } from '../../../engine-wasm/wasm-bridge';
import { layerToDescJson } from '../../../engine-wasm/sync-layers';
import { DEFAULT_EFFECTS, hasEnabledEffects } from '../../../layers/layer-model';
import { findParentGroup, removeFromParentGroup } from '../../../layers/group-utils';
import { pixelDataManager } from '../../../engine/pixel-data-manager';
import { invalidateBitmapCache } from '../../../engine/bitmap-cache';

/**
 * Whether Merge Down can run for the document's current active layer.
 *
 * Two things make the layer below the active one an invalid target:
 *
 * - It's a group. Groups have no raster texture to composite into, so
 *   `mergeLayers` against one would be a no-op on the GPU while the
 *   active layer still gets dropped from `layerOrder` as if the merge
 *   had succeeded, silently destroying its pixels (#879).
 * - It doesn't share the active layer's parent (#920). `layerOrder` is
 *   a flat stack across every group's subtree, so the immediate
 *   neighbor below a group's bottom child is whatever sits below the
 *   group itself, outside it. Merging into that layer would pull the
 *   active layer out of its group, silently discarding the group's
 *   visibility/opacity/blend-mode/adjustments.
 *
 * Shared by `computeMergeDown`'s own guard and by the Layer menu /
 * keyboard shortcut's disabled state so both agree on when merging is
 * valid.
 */
export function canMergeDown(doc: DocumentState): boolean {
  const activeId = doc.activeLayerId;
  if (!activeId) return false;
  const orderIdx = doc.layerOrder.indexOf(activeId);
  if (orderIdx <= 0) return false;
  const belowId = doc.layerOrder[orderIdx - 1];
  if (!belowId) return false;
  const belowLayer = doc.layers.find((l) => l.id === belowId);
  if (!belowLayer) return false;
  if (belowLayer.type === 'group') return false;

  const activeParentId = findParentGroup(doc.layers, activeId)?.id ?? null;
  const belowParentId = findParentGroup(doc.layers, belowId)?.id ?? null;
  return activeParentId === belowParentId;
}

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
  if (!canMergeDown(doc)) return undefined;

  const activeId = doc.activeLayerId;
  const orderIdx = activeId ? doc.layerOrder.indexOf(activeId) : -1;
  const belowId = orderIdx > 0 ? doc.layerOrder[orderIdx - 1] : undefined;
  const topLayer = activeId ? doc.layers.find((l) => l.id === activeId) : undefined;
  const bottomLayer = belowId ? doc.layers.find((l) => l.id === belowId) : undefined;
  // canMergeDown already guarantees all of these resolve; the checks above
  // are just to satisfy strict null checks without non-null assertions.
  if (!activeId || !belowId || !topLayer || !bottomLayer) return undefined;

  // #879: refuse rather than merge onto a group — a group has no raster
  // texture, so `mergeLayers` would composite into nothing while the code
  // below still dropped the active layer, silently destroying its pixels.
  if (bottomLayer.type === 'group') return undefined;

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
  //
  // #859: the merged pixels are a raster composite, but a text layer's
  // renderer re-typesets from `text`/`fontFamily`/etc. on every edit and
  // ignores whatever is in its GPU texture — so if either merged layer was
  // 'text', the result must become a plain raster layer (mirroring
  // rasterizeTextLayer's explicit field whitelist) or a later text-tool
  // edit would erase the merge.
  layers = layers.map((l) => {
    if (l.id !== belowId) return l;
    if (l.type === 'text' || topLayer.type === 'text') {
      return {
        id: l.id,
        name: l.name,
        type: 'raster' as const,
        visible: l.visible,
        locked: l.locked,
        opacity: 1,
        blendMode: 'normal' as const,
        x: 0,
        y: 0,
        clipToBelow: l.clipToBelow,
        effects: DEFAULT_EFFECTS,
        mask: l.mask,
        width: doc.width,
        height: doc.height,
      };
    }
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
