import type { Layer, GroupLayer } from '../types';

export interface LayerTreeNode {
  layer: Layer;
  depth: number;
  children: LayerTreeNode[];
}

export function isGroupLayer(layer: Layer): layer is GroupLayer {
  return layer.type === 'group';
}

export function findParentGroup(
  layers: readonly Layer[],
  layerId: string,
): GroupLayer | null {
  for (const layer of layers) {
    if (isGroupLayer(layer) && layer.children.includes(layerId)) {
      return layer;
    }
  }
  return null;
}

export function getLayerDepth(
  layers: readonly Layer[],
  layerId: string,
): number {
  let depth = 0;
  let current = layerId;
  for (;;) {
    const parent = findParentGroup(layers, current);
    if (!parent) break;
    depth++;
    current = parent.id;
  }
  return depth;
}

export function getDescendantIds(
  layers: readonly Layer[],
  groupId: string,
): string[] {
  const group = layers.find((l) => l.id === groupId);
  if (!group || !isGroupLayer(group)) return [];

  const result: string[] = [];
  for (const childId of group.children) {
    result.push(childId);
    result.push(...getDescendantIds(layers, childId));
  }
  return result;
}

export function isAncestorOf(
  layers: readonly Layer[],
  potentialAncestorId: string,
  layerId: string,
): boolean {
  let current = layerId;
  for (;;) {
    const parent = findParentGroup(layers, current);
    if (!parent) return false;
    if (parent.id === potentialAncestorId) return true;
    current = parent.id;
  }
}

export function canMoveToGroup(
  layers: readonly Layer[],
  layerId: string,
  targetGroupId: string,
): boolean {
  if (layerId === targetGroupId) return false;
  if (isAncestorOf(layers, layerId, targetGroupId)) return false;
  return true;
}

/**
 * Build a flat display list from the layer tree, with depth info.
 * Respects collapsed groups by skipping their children.
 * Returns layers in display order (top to bottom = reversed layerOrder).
 */
export function buildFlatDisplayList(
  layers: readonly Layer[],
  layerOrder: readonly string[],
): { layer: Layer; depth: number }[] {
  const layerMap = new Map(layers.map((l) => [l.id, l]));

  const result: { layer: Layer; depth: number }[] = [];

  // Walk layerOrder in reverse (top to bottom display)
  const reversed = [...layerOrder].reverse();
  for (const id of reversed) {
    const layer = layerMap.get(id);
    if (!layer) continue;

    const depth = getLayerDepth(layers, id);

    // Check if any ancestor is collapsed
    let hidden = false;
    let current = id;
    for (;;) {
      const parent = findParentGroup(layers, current);
      if (!parent) break;
      if (isGroupLayer(parent) && parent.collapsed) {
        hidden = true;
        break;
      }
      current = parent.id;
    }

    if (!hidden) {
      result.push({ layer, depth });
    }
  }

  return result;
}

/**
 * Move a layer into a group, updating all group children arrays.
 * Returns new layers array.
 */
export function moveLayerToGroup(
  layers: readonly Layer[],
  layerId: string,
  targetGroupId: string,
  insertIndex?: number,
): Layer[] {
  if (!canMoveToGroup(layers, layerId, targetGroupId)) return [...layers];

  return layers.map((l) => {
    if (isGroupLayer(l)) {
      // Remove from old parent
      if (l.children.includes(layerId)) {
        return { ...l, children: l.children.filter((c) => c !== layerId) };
      }
      // Add to new parent
      if (l.id === targetGroupId) {
        const newChildren = [...l.children];
        const idx = insertIndex !== undefined ? insertIndex : newChildren.length;
        newChildren.splice(idx, 0, layerId);
        return { ...l, children: newChildren };
      }
    }
    return l;
  });
}

/**
 * Remove a layer from its parent group's children.
 */
export function removeFromParentGroup(
  layers: readonly Layer[],
  layerId: string,
): Layer[] {
  return layers.map((l) => {
    if (isGroupLayer(l) && l.children.includes(layerId)) {
      return { ...l, children: l.children.filter((c) => c !== layerId) };
    }
    return l;
  });
}

/**
 * Determine the target group ID for inserting a new layer.
 * If the active layer is a group, insert into it.
 * If the active layer has a parent group, use that parent.
 * Otherwise fall back to the root group.
 * Always returns a group ID — never null (layers must live inside a group).
 */
export function getInsertionGroupId(
  layers: readonly Layer[],
  activeLayerId: string | null,
  rootGroupId: string | null | undefined,
): string | null {
  if (activeLayerId) {
    const activeLayer = layers.find((l) => l.id === activeLayerId);
    if (activeLayer && isGroupLayer(activeLayer)) {
      return activeLayer.id;
    }
    const parent = findParentGroup(layers, activeLayerId);
    if (parent) return parent.id;
  }
  return rootGroupId ?? null;
}

/**
 * Compute the layerOrder insertion index for a new layer.
 * Inserts just above the active layer in layerOrder.
 * If active layer is a group, inserts just before it (so the new layer
 * appears inside the group visually, above the group's existing children).
 */
export function getInsertionOrderIndex(
  layerOrder: readonly string[],
  activeLayerId: string | null,
): number {
  if (!activeLayerId) return layerOrder.length;
  const idx = layerOrder.indexOf(activeLayerId);
  if (idx === -1) return layerOrder.length;
  return idx + 1;
}

/**
 * Insert a new layer ID into a group's children array.
 * Returns updated layers array.
 */
export function addToGroup(
  layers: readonly Layer[],
  layerId: string,
  groupId: string,
): Layer[] {
  return layers.map((l) => {
    if (l.id === groupId && isGroupLayer(l)) {
      return { ...l, children: [...l.children, layerId] };
    }
    return l;
  });
}
