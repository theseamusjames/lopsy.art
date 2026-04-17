import type { DocumentState } from '../../../types';
import type { ActionResult } from '../types';
import { duplicateLayer as duplicateLayerModel } from '../../../layers/layer-model';
import { findParentGroup, addToGroup, isGroupLayer, getDescendantIds } from '../../../layers/group-utils';
import { getEngine } from '../../../engine-wasm/engine-state';
import { duplicateLayerTexture } from '../../../engine-wasm/wasm-bridge';

export function computeDuplicateLayer(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
): ActionResult | undefined {
  const activeId = doc.activeLayerId;
  if (!activeId) return undefined;
  const layer = doc.layers.find((l) => l.id === activeId);
  if (!layer) return undefined;

  const engine = getEngine();
  const pixelData = new Map(layerPixelData);
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
      layerPixelData: pixelData,
    };
  }

  // Simple layer duplication
  const newLayer = duplicateLayerModel(layer);
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
    layerPixelData: pixelData,
  };
}
