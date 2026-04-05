import type { DocumentState } from '../../../types';
import type { EditorState, SparseLayerEntry } from '../types';
import { getDescendantIds, isGroupLayer, removeFromParentGroup } from '../../../layers/group-utils';

export function computeRemoveLayer(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
  sparseLayerData: Map<string, SparseLayerEntry>,
  id: string,
): Partial<EditorState> | undefined {
  if (doc.layers.length <= 1) return undefined;

  // Protect root group from deletion
  if (id === doc.rootGroupId) return undefined;

  // Collect IDs to remove: the layer itself + all descendants if it's a group
  const layer = doc.layers.find((l) => l.id === id);
  const idsToRemove = new Set([id]);
  if (layer && isGroupLayer(layer)) {
    for (const descId of getDescendantIds(doc.layers, id)) {
      idsToRemove.add(descId);
    }
  }

  // Remove from parent group's children
  let layers = removeFromParentGroup(doc.layers, id);

  // Filter out all removed IDs
  layers = layers.filter((l) => !idsToRemove.has(l.id));
  const layerOrder = doc.layerOrder.filter((lid) => !idsToRemove.has(lid));

  const activeLayerId =
    idsToRemove.has(doc.activeLayerId ?? '')
      ? (layerOrder.find((lid) => !isGroupLayer(layers.find((l) => l.id === lid)!)) ?? layerOrder[layerOrder.length - 1] ?? null)
      : doc.activeLayerId;

  const pixelData = new Map(layerPixelData);
  const sparse = new Map(sparseLayerData);
  for (const rid of idsToRemove) {
    pixelData.delete(rid);
    sparse.delete(rid);
  }

  return {
    document: { ...doc, layers, layerOrder, activeLayerId },
    layerPixelData: pixelData,
    sparseLayerData: sparse,
  };
}
