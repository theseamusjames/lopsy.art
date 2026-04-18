import type { DocumentState } from '../../../types';
import type { ActionResult } from '../types';
import { findParentGroup, removeFromParentGroup, addToGroup, isGroupLayer } from '../../../layers/group-utils';

export function computeMoveLayer(
  doc: DocumentState,
  renderVersion: number,
  fromIndex: number,
  toIndex: number,
): ActionResult | undefined {
  let layers = [...doc.layers];
  const order = [...doc.layerOrder];
  const [movedLayer] = layers.splice(fromIndex, 1);
  const [movedOrder] = order.splice(fromIndex, 1);
  if (movedLayer === undefined || movedOrder === undefined) return undefined;
  layers.splice(toIndex, 0, movedLayer);
  order.splice(toIndex, 0, movedOrder);

  // After the flat reorder, check if the layer's neighbor has a different
  // parent group. If so, re-parent the moved layer to match its new neighbor.
  const movedId = movedLayer.id;
  const currentParent = findParentGroup(layers, movedId);
  const neighborIdx = toIndex > 0 ? toIndex - 1 : toIndex + 1;
  const neighbor = layers[neighborIdx];
  if (neighbor && !isGroupLayer(movedLayer)) {
    const neighborParent = findParentGroup(layers, neighbor.id);
    if (neighborParent && currentParent && neighborParent.id !== currentParent.id) {
      layers = removeFromParentGroup(layers, movedId);
      layers = addToGroup(layers, movedId, neighborParent.id);
    }
  }

  return {
    document: { ...doc, layers, layerOrder: order },
    renderVersion: renderVersion + 1,
  };
}
