import type { DocumentState, Layer } from '../../../types';
import type { ActionResult } from '../types';
import { duplicateLayer as duplicateLayerModel } from '../../../layers/layer-model';
import { findParentGroup, addToGroup, isGroupLayer, getDescendantIds } from '../../../layers/group-utils';
import { getEngine } from '../../../engine-wasm/engine-state';
import {
  duplicateLayerTexture,
  snapshotMaskGpu,
  restoreMaskFromGpuSnapshot,
  releaseGpuSnapshot,
  type Engine,
} from '../../../engine-wasm/wasm-bridge';
import { seedMaskDataRef } from '../../../engine-wasm/sync-state';
import { isMaskDataStale, scheduleMaskDataRefresh } from '../../mask-data-sync';
import { EMPTY_MASK_HANDLE } from '../mask-history';

/**
 * Give `duplicate` its source's GPU mask when the source's JS bytes lag it
 * (a mask stroke whose lazy readback has not landed, #780). The copy then
 * shows the mask as painted without reading it back; its own bytes are
 * marked as already uploaded and refreshed by the read queue.
 */
function carryGpuMask(engine: Engine, source: Layer, duplicate: Layer): void {
  if (!source.mask || !duplicate.mask || !isMaskDataStale(source.id)) return;
  const copy = snapshotMaskGpu(engine, source.id);
  if (copy === EMPTY_MASK_HANDLE) return;
  try {
    restoreMaskFromGpuSnapshot(engine, duplicate.id, copy);
    seedMaskDataRef(engine, duplicate.id, duplicate.mask.data);
    scheduleMaskDataRefresh(duplicate.id);
  } catch (e) {
    console.error('[Lopsy] mask copy failed:', duplicate.id, e);
  } finally {
    // Never part of a history entry, so the ledger does not own it.
    releaseGpuSnapshot(engine, copy);
  }
}

/**
 * Duplicate the active layer (or a group and all descendants) on the GPU.
 *
 * The duplicate is a texture-only clone: `duplicateLayerTexture` copies
 * the source layer's GPU texture into a new texture owned by the new
 * layer id. No JS-side pixel buffer is read or produced (#746) — the
 * caller does not need to `resolveAllPixelData` before, and does not
 * need to `syncPixelDataToGpu` after.
 *
 * The copy lands exactly over its source, at the same `x` / `y`.
 *
 * The copy replaces the whole selection (#804): a source left in
 * `selectedLayerIds` would ride along as a multi-selected sibling on the
 * next nudge or Move drag.
 */
export function computeDuplicateLayer(
  doc: DocumentState,
): ActionResult | undefined {
  const activeId = doc.activeLayerId;
  if (!activeId) return undefined;
  const layer = doc.layers.find((l) => l.id === activeId);
  if (!layer) return undefined;

  const engine = getEngine();
  const newLayers = [...doc.layers];
  const newOrder = [...doc.layerOrder];

  // For groups, duplicate the group and all descendants recursively
  if (isGroupLayer(layer)) {
    const idMap = new Map<string, string>();
    const descIds = getDescendantIds(doc.layers, activeId);
    const allIds = [activeId, ...descIds];

    for (const id of allIds) {
      const orig = doc.layers.find((l) => l.id === id);
      if (!orig) continue;
      const dup = duplicateLayerModel(orig);
      idMap.set(id, dup.id);
      newLayers.push(dup);
      if (engine && !isGroupLayer(orig)) {
        duplicateLayerTexture(engine, id, dup.id);
      }
      if (engine) carryGpuMask(engine, orig, dup);
    }

    // The copy goes in as one contiguous block, in the source's own stacking
    // order, directly above the source subtree. Splicing each copy after its
    // own source interleaved the two groups in the panel and compositor (#805).
    const subtree = new Set(allIds);
    const copyBlock = doc.layerOrder.flatMap((id) => {
      const dupId = subtree.has(id) ? idMap.get(id) : undefined;
      return dupId ? [dupId] : [];
    });
    const sourceTop = doc.layerOrder.reduce((top, id, i) => (subtree.has(id) ? i : top), -1);
    newOrder.splice(sourceTop + 1, 0, ...copyBlock);

    // Remap children references in duplicated groups
    for (const [, dupId] of idMap) {
      const dupLayer = newLayers.find((l) => l.id === dupId);
      if (dupLayer && isGroupLayer(dupLayer)) {
        const remappedChildren = dupLayer.children.map((c) => idMap.get(c) ?? c);
        const idx = newLayers.indexOf(dupLayer);
        newLayers[idx] = { ...dupLayer, children: remappedChildren };
      }
    }

    const parentGroup = findParentGroup(doc.layers, activeId);
    const dupRootId = idMap.get(activeId)!;
    const layers = parentGroup
      ? addToGroup(newLayers, dupRootId, parentGroup.id, newOrder)
      : newLayers;

    return {
      document: {
        ...doc,
        layers,
        layerOrder: newOrder,
        activeLayerId: dupRootId,
        selectedLayerIds: [dupRootId],
      },
    };
  }

  // Simple layer duplication
  const newLayer = duplicateLayerModel(layer);
  const newId = newLayer.id;
  const orderIdx = doc.layerOrder.indexOf(activeId);
  newOrder.splice(orderIdx + 1, 0, newId);

  if (engine) {
    duplicateLayerTexture(engine, activeId, newId);
    carryGpuMask(engine, layer, newLayer);
  }

  let layers = [...doc.layers, newLayer];

  // Add to same parent group
  const parentGroup = findParentGroup(doc.layers, activeId);
  if (parentGroup) {
    layers = addToGroup(layers, newId, parentGroup.id, newOrder);
  }

  return {
    document: {
      ...doc,
      layers,
      layerOrder: newOrder,
      activeLayerId: newId,
      selectedLayerIds: [newId],
    },
  };
}
