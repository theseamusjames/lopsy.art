import type { DocumentState, Layer } from '../../../types';
import type { ActionResult } from '../types';
import {
  duplicateLayer as duplicateLayerModel,
  duplicateOffsetForLayer,
} from '../../../layers/layer-model';
import { findParentGroup, addToGroup, isGroupLayer, getDescendantIds } from '../../../layers/group-utils';
import { getEngine } from '../../../engine-wasm/engine-state';
import { duplicateLayerTexture } from '../../../engine-wasm/wasm-bridge';

function shiftLayer(layer: Layer, dx: number, dy: number): Layer {
  if (dx === 0 && dy === 0) return layer;
  return { ...layer, x: layer.x + dx, y: layer.y + dy } as Layer;
}

/**
 * Duplicate the active layer (or a group and all descendants) on the GPU.
 *
 * The duplicate is a texture-only clone: `duplicateLayerTexture` copies
 * the source layer's GPU texture into a new texture owned by the new
 * layer id. No JS-side pixel buffer is read or produced (#746) — the
 * caller does not need to `resolveAllPixelData` before, and does not
 * need to `syncPixelDataToGpu` after.
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

    const { dx, dy } = duplicateOffsetForLayer(layer, doc.width, doc.height);

    for (const id of allIds) {
      const orig = doc.layers.find((l) => l.id === id);
      if (!orig) continue;
      const dup = shiftLayer(duplicateLayerModel(orig), dx, dy);
      idMap.set(id, dup.id);
      newLayers.push(dup);
      const orderIdx = newOrder.indexOf(id);
      newOrder.splice(orderIdx + 1, 0, dup.id);
      if (engine && !isGroupLayer(orig)) {
        duplicateLayerTexture(engine, id, dup.id);
      }
    }

    // Remap children references in duplicated groups
    for (const [, dupId] of idMap) {
      const dupLayer = newLayers.find((l) => l.id === dupId);
      if (dupLayer && isGroupLayer(dupLayer)) {
        const remappedChildren = dupLayer.children.map((c) => idMap.get(c) ?? c);
        const idx = newLayers.indexOf(dupLayer);
        newLayers[idx] = { ...dupLayer, children: remappedChildren };
      }
    }

    // Add duplicated group to parent
    const parentGroup = findParentGroup(doc.layers, activeId);
    const dupRootId = idMap.get(activeId)!;
    if (parentGroup) {
      const parentIdx = newLayers.findIndex((l) => l.id === parentGroup.id);
      if (parentIdx >= 0 && isGroupLayer(newLayers[parentIdx]!)) {
        const p = newLayers[parentIdx]!;
        if (isGroupLayer(p)) {
          newLayers[parentIdx] = { ...p, children: [...p.children, dupRootId] };
        }
      }
    }

    return {
      document: { ...doc, layers: newLayers, layerOrder: newOrder, activeLayerId: dupRootId },
    };
  }

  // Simple layer duplication
  const { dx, dy } = duplicateOffsetForLayer(layer, doc.width, doc.height);
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
    layers = addToGroup(layers, newId, parentGroup.id);
  }

  return {
    document: { ...doc, layers, layerOrder: newOrder, activeLayerId: newId },
  };
}
