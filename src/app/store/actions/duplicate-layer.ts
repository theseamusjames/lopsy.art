import type { DocumentState, Layer } from '../../../types';
import type { ActionResult } from '../types';
import {
  duplicateLayer as duplicateLayerModel,
  duplicateOffsetForLayer,
} from '../../../layers/layer-model';
import { findParentGroup, addToGroup, isGroupLayer, getDescendantIds } from '../../../layers/group-utils';
import { getEngine } from '../../../engine-wasm/engine-state';
import { duplicateLayerTexture, getLayerContentBounds } from '../../../engine-wasm/wasm-bridge';

function shiftLayer(layer: Layer, dx: number, dy: number): Layer {
  if (dx === 0 && dy === 0) return layer;
  return { ...layer, x: layer.x + dx, y: layer.y + dy } as Layer;
}

/**
 * Return a layer descriptor with its content-cropped bounds patched in
 * over the store's transiently-expanded ones. Used only for the
 * duplicate-offset clamp so a raster whose texture was expanded to full
 * document size (crop-on-leave / expand-on-return lifecycle) still gets
 * the documented +10/+10 shift on Duplicate Layer (#835).
 */
function layerWithContentBounds(layer: Layer): Layer {
  if (layer.type !== 'raster') return layer;
  const engine = getEngine();
  if (!engine) return layer;
  const bounds = getLayerContentBounds(engine, layer.id);
  if (!bounds || bounds.length < 4) return layer;
  const cx = bounds[0]!;
  const cy = bounds[1]!;
  const cw = bounds[2]!;
  const ch = bounds[3]!;
  if (cw <= 0 || ch <= 0) return layer;
  return { ...layer, x: cx, y: cy, width: cw, height: ch };
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

    const { dx, dy } = duplicateOffsetForLayer(layerWithContentBounds(layer), doc.width, doc.height);

    for (const id of allIds) {
      const orig = doc.layers.find((l) => l.id === id);
      if (!orig) continue;
      const dup = shiftLayer(duplicateLayerModel(orig), dx, dy);
      idMap.set(id, dup.id);
      newLayers.push(dup);
      if (engine && !isGroupLayer(orig)) {
        duplicateLayerTexture(engine, id, dup.id);
      }
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
  const { dx, dy } = duplicateOffsetForLayer(layerWithContentBounds(layer), doc.width, doc.height);
  const newLayer = shiftLayer(duplicateLayerModel(layer), dx, dy);
  const newId = newLayer.id;
  const orderIdx = doc.layerOrder.indexOf(activeId);
  newOrder.splice(orderIdx + 1, 0, newId);

  if (engine) {
    duplicateLayerTexture(engine, activeId, newId);
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
