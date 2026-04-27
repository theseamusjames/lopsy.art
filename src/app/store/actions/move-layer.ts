import type { DocumentState } from '../../../types';
import type { ActionResult } from '../types';
import { findParentGroup, removeFromParentGroup, addToGroup, isGroupLayer, getDescendantIds } from '../../../layers/group-utils';

export function computeMoveLayer(
  doc: DocumentState,
  renderVersion: number,
  fromIndex: number,
  toIndex: number,
): ActionResult | undefined {
  const order = [...doc.layerOrder];
  const movedId = order[fromIndex];
  if (!movedId) return undefined;

  const layerMap = new Map(doc.layers.map((l) => [l.id, l]));
  const movedLayer = layerMap.get(movedId);
  if (!movedLayer) return undefined;

  if (isGroupLayer(movedLayer)) {
    const descendantIds = new Set(getDescendantIds(doc.layers, movedId));
    const blockIds = new Set([movedId, ...descendantIds]);

    const blockEntries: string[] = [];
    const restEntries: string[] = [];
    for (const id of order) {
      (blockIds.has(id) ? blockEntries : restEntries).push(id);
    }

    const orderWithoutMoved = order.filter((id) => id !== movedId);
    let anchorId: string | undefined;
    for (let i = toIndex; i < orderWithoutMoved.length; i++) {
      const candidate = orderWithoutMoved[i];
      if (candidate !== undefined && !blockIds.has(candidate)) {
        anchorId = candidate;
        break;
      }
    }

    let insertAt: number;
    if (anchorId) {
      const idx = restEntries.indexOf(anchorId);
      insertAt = idx !== -1 ? idx : restEntries.length;
    } else {
      insertAt = restEntries.length;
    }

    // Ensure we don't insert inside a sibling group's block.
    // Find the moved group's parent, then check if both neighbors at the
    // insertion point belong to the same sibling group — if so, skip past it.
    if (insertAt > 0 && insertAt < restEntries.length) {
      const movedParentId = findParentGroup(doc.layers, movedId)?.id;
      const prevSibling = findContainingSiblingGroup(doc.layers, restEntries[insertAt - 1]!, movedParentId);
      const nextSibling = findContainingSiblingGroup(doc.layers, restEntries[insertAt]!, movedParentId);
      if (prevSibling && nextSibling && prevSibling === nextSibling) {
        const foreignIds = new Set([prevSibling, ...getDescendantIds(doc.layers, prevSibling)]);
        while (insertAt < restEntries.length && foreignIds.has(restEntries[insertAt]!)) {
          insertAt++;
        }
      }
    }

    restEntries.splice(insertAt, 0, ...blockEntries);
    const newLayers = restEntries.map((id) => layerMap.get(id)!);

    return {
      document: { ...doc, layers: newLayers, layerOrder: restEntries },
      renderVersion: renderVersion + 1,
    };
  }

  // Single item move
  order.splice(fromIndex, 1);
  order.splice(toIndex, 0, movedId);

  // After the flat reorder, check if the layer's neighbor has a different
  // parent group. If so, re-parent the moved layer to match its new neighbor.
  let layers = [...doc.layers];
  const currentParent = findParentGroup(layers, movedId);
  const neighborIdx = toIndex > 0 ? toIndex - 1 : toIndex + 1;
  const neighborId = order[neighborIdx];
  const neighbor = neighborId ? layerMap.get(neighborId) : undefined;
  if (neighbor) {
    const neighborParent = findParentGroup(layers, neighbor.id);
    if (neighborParent && currentParent && neighborParent.id !== currentParent.id) {
      layers = removeFromParentGroup(layers, movedId);
      layers = addToGroup(layers, movedId, neighborParent.id);
    }
  }

  const updatedMap = new Map(layers.map((l) => [l.id, l]));
  const newLayers = order.map((id) => updatedMap.get(id)!);

  return {
    document: { ...doc, layers: newLayers, layerOrder: order },
    renderVersion: renderVersion + 1,
  };
}

import type { Layer } from '../../../types/layers';

/**
 * Walk up from layerId to find which sibling group (a group that is a direct
 * child of parentGroupId) contains it. Returns the sibling group's ID, or
 * null if layerId is a direct non-group child of parentGroupId.
 */
function findContainingSiblingGroup(
  layers: readonly Layer[],
  layerId: string,
  parentGroupId: string | undefined,
): string | null {
  let current = layerId;
  for (;;) {
    const parent = findParentGroup(layers, current);
    if (!parent) return null;
    if (parent.id === parentGroupId) {
      const layer = layers.find((l) => l.id === current);
      return layer && isGroupLayer(layer) ? current : null;
    }
    current = parent.id;
  }
}
