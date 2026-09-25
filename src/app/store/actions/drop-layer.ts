import type { DocumentState, Layer } from '../../../types';
import type { ActionResult } from '../types';
import { findParentGroup, getDescendantIds, isAncestorOf, isGroupLayer } from '../../../layers/group-utils';

/**
 * A position in the layer tree, expressed in panel terms.
 *
 * `parentId` is the group the dropped layer ends up in. `belowId` is the
 * direct child of that group that sits immediately ABOVE the dropped
 * layer in the panel (top→bottom); the dropped layer goes directly under
 * that sibling's whole subtree. `null` means "top of the group" — right
 * under the group's own row.
 */
export interface LayerDropTarget {
  parentId: string;
  belowId: string | null;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function reparent(
  layers: readonly Layer[],
  layerId: string,
  parentId: string,
  layerOrder: readonly string[],
): Layer[] {
  const rank = new Map(layerOrder.map((id, i) => [id, i]));
  const byOrder = (a: string, b: string) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0);
  return layers.map((l) => {
    if (!isGroupLayer(l)) return l;
    const hadChild = l.children.includes(layerId);
    if (l.id === parentId) {
      const children = hadChild ? [...l.children] : [...l.children, layerId];
      children.sort(byOrder);
      return { ...l, children };
    }
    if (hadChild) {
      return { ...l, children: l.children.filter((c) => c !== layerId) };
    }
    return l;
  });
}

/**
 * Move `layerId` (and, for a group, its whole subtree as one contiguous
 * block) to `target`. Both the tree (`children`) and `layerOrder` are
 * updated from the same target so the panel, the compositor and the drop
 * indicator can never disagree about where the layer went.
 *
 * Returns undefined when the target is invalid or the move would leave
 * the document unchanged — callers use that to skip recording history.
 */
export function computeDropLayer(
  doc: DocumentState,
  renderVersion: number,
  layerId: string,
  target: LayerDropTarget,
): ActionResult | undefined {
  const { layers, layerOrder } = doc;
  if (layerId === doc.rootGroupId) return undefined;
  if (layerId === target.parentId || layerId === target.belowId) return undefined;
  if (!layerOrder.includes(layerId)) return undefined;

  const parent = layers.find((l) => l.id === target.parentId);
  if (!parent || !isGroupLayer(parent)) return undefined;
  if (isAncestorOf(layers, layerId, target.parentId)) return undefined;
  if (target.belowId !== null && !parent.children.includes(target.belowId)) return undefined;

  const moved = layers.find((l) => l.id === layerId);
  if (!moved) return undefined;
  const blockIds = new Set([layerId]);
  if (isGroupLayer(moved)) {
    for (const id of getDescendantIds(layers, layerId)) blockIds.add(id);
  }

  const block = layerOrder.filter((id) => blockIds.has(id));
  const rest = layerOrder.filter((id) => !blockIds.has(id));

  let insertAt: number;
  if (target.belowId === null) {
    insertAt = rest.indexOf(target.parentId);
  } else {
    const siblingBlock = new Set([target.belowId, ...getDescendantIds(layers, target.belowId)]);
    insertAt = rest.findIndex((id) => siblingBlock.has(id));
  }
  if (insertAt < 0) return undefined;

  const newOrder = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
  const oldParentId = findParentGroup(layers, layerId)?.id ?? null;
  if (oldParentId === target.parentId && sameOrder(newOrder, layerOrder)) return undefined;

  const reparented = reparent(layers, layerId, target.parentId, newOrder);
  const layerMap = new Map(reparented.map((l) => [l.id, l]));
  const newLayers = newOrder
    .map((id) => layerMap.get(id))
    .filter((l): l is Layer => l !== undefined);

  return {
    document: { ...doc, layers: newLayers, layerOrder: newOrder },
    renderVersion: renderVersion + 1,
  };
}
