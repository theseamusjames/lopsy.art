import type { DocumentState } from '../../../types';
import type { SparseLayerEntry, ActionResult } from '../types';
import { findParentGroup, getDescendantIds, isGroupLayer, removeFromParentGroup } from '../../../layers/group-utils';

export function computeRemoveLayer(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
  sparseLayerData: Map<string, SparseLayerEntry>,
  id: string,
): ActionResult | undefined {
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

  // #819 — pick the deleted layer's sibling as the next active layer,
  // so the panel selection stays where the user was working. Read the
  // pre-remove parent so its child list still contains the deleted id.
  const activeWasRemoved = idsToRemove.has(doc.activeLayerId ?? '');
  const activeLayerId = activeWasRemoved
    ? findNeighbourActiveId(doc, id, idsToRemove)
    : doc.activeLayerId;

  // Remove from parent group's children
  let layers = removeFromParentGroup(doc.layers, id);

  // Filter out all removed IDs
  layers = layers.filter((l) => !idsToRemove.has(l.id));
  const layerOrder = doc.layerOrder.filter((lid) => !idsToRemove.has(lid));

  const pixelData = new Map(layerPixelData);
  const sparse = new Map(sparseLayerData);
  for (const rid of idsToRemove) {
    pixelData.delete(rid);
    sparse.delete(rid);
  }

  // Remove deleted IDs from selection, ensure active layer remains selected
  const selectedLayerIds = (doc.selectedLayerIds ?? [doc.activeLayerId]).filter(
    (sid): sid is string => sid !== null && !idsToRemove.has(sid),
  );
  const finalSelectedIds = activeLayerId && !selectedLayerIds.includes(activeLayerId)
    ? [activeLayerId, ...selectedLayerIds]
    : selectedLayerIds;

  return {
    document: { ...doc, layers, layerOrder, activeLayerId, selectedLayerIds: finalSelectedIds },
    layerPixelData: pixelData,
    sparseLayerData: sparse,
    removedLayerIds: Array.from(idsToRemove),
  };
}

function findNeighbourActiveId(
  doc: DocumentState,
  removedId: string,
  idsToRemove: ReadonlySet<string>,
): string | null {
  const parent = findParentGroup(doc.layers, removedId);
  if (parent) {
    const siblings = parent.children;
    const idx = siblings.indexOf(removedId);
    if (idx !== -1) {
      for (let i = idx - 1; i >= 0; i--) {
        const s = siblings[i];
        if (s && !idsToRemove.has(s) && !isGroupOf(doc, s)) return s;
      }
      for (let i = idx + 1; i < siblings.length; i++) {
        const s = siblings[i];
        if (s && !idsToRemove.has(s) && !isGroupOf(doc, s)) return s;
      }
    }
    if (!idsToRemove.has(parent.id) && parent.id !== doc.rootGroupId) {
      return parent.id;
    }
  }
  const remaining = doc.layerOrder.filter((lid) => !idsToRemove.has(lid));
  const removedIdx = doc.layerOrder.indexOf(removedId);
  if (removedIdx !== -1) {
    for (let i = removedIdx - 1; i >= 0; i--) {
      const lid = doc.layerOrder[i];
      if (lid && !idsToRemove.has(lid) && !isGroupOf(doc, lid)) return lid;
    }
    for (let i = removedIdx + 1; i < doc.layerOrder.length; i++) {
      const lid = doc.layerOrder[i];
      if (lid && !idsToRemove.has(lid) && !isGroupOf(doc, lid)) return lid;
    }
  }
  return (
    remaining.find((lid) => !isGroupOf(doc, lid)) ??
    remaining[remaining.length - 1] ??
    null
  );
}

function isGroupOf(doc: DocumentState, id: string): boolean {
  const l = doc.layers.find((x) => x.id === id);
  return !!l && isGroupLayer(l);
}
