import type { Layer } from '../../types';
import type { LayerDropTarget } from '../../app/store/actions/drop-layer';
import { findParentGroup } from '../../layers/group-utils';

/**
 * The slot the layer already occupies: its parent, and the sibling
 * directly above it in the panel (by layerOrder, not `children` order).
 */
export function currentDropTarget(
  layers: readonly Layer[],
  layerOrder: readonly string[],
  layerId: string,
): LayerDropTarget | null {
  const parent = findParentGroup(layers, layerId);
  if (!parent) return null;
  const rank = new Map(layerOrder.map((id, i) => [id, i]));
  const ownRank = rank.get(layerId) ?? -1;
  let belowId: string | null = null;
  let belowRank = Infinity;
  for (const childId of parent.children) {
    const r = rank.get(childId);
    if (r === undefined || r <= ownRank || r >= belowRank) continue;
    belowId = childId;
    belowRank = r;
  }
  return { parentId: parent.id, belowId };
}
