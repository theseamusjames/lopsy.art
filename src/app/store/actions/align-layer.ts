import type { DocumentState, Layer, Rect } from '../../../types';
import type { SelectionData, ActionResult } from '../types';
import { computeAlign, type AlignEdge } from '../../../tools/move/move';
import { isGroupLayer, getDescendantIds } from '../../../layers/group-utils';

/** Document-space content bounds of a (non-group) layer, or null when it is empty. */
export type ContentBoundsLookup = (layer: Layer) => Rect | null;

/**
 * Align the active layer (or the active group's subtree) to a canvas edge or
 * centre. Only content bounds are needed, never pixels, so the caller supplies
 * them — the store reads them on the GPU instead of reading layers back (#1291).
 */
export function computeAlignLayer(
  doc: DocumentState,
  contentBoundsOf: ContentBoundsLookup,
  selection: SelectionData,
  renderVersion: number,
  edge: AlignEdge,
): ActionResult | undefined {
  const activeId = doc.activeLayerId;
  if (!activeId) return undefined;
  const layer = doc.layers.find((l) => l.id === activeId);
  if (!layer) return undefined;

  // Groups have no pixels of their own — align the combined content bounds of
  // their descendants and shift the whole subtree, mirroring how dragging a
  // group moves all its children together.
  if (isGroupLayer(layer)) {
    return alignGroup(doc, contentBoundsOf, renderVersion, edge, activeId);
  }

  const bounds = selection.active && selection.bounds ? selection.bounds : contentBoundsOf(layer);
  if (!bounds) return undefined;

  const pos = computeAlign(edge, bounds, doc.width, doc.height, layer.x, layer.y);
  return {
    document: {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === activeId ? ({ ...l, x: pos.x, y: pos.y } as Layer) : l,
      ),
    },
    renderVersion: renderVersion + 1,
  };
}

function alignGroup(
  doc: DocumentState,
  contentBoundsOf: ContentBoundsLookup,
  renderVersion: number,
  edge: AlignEdge,
  groupId: string,
): ActionResult | undefined {
  const descendantIds = getDescendantIds(doc.layers, groupId);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of descendantIds) {
    const child = doc.layers.find((l) => l.id === id);
    if (!child || isGroupLayer(child)) continue;
    const b = contentBoundsOf(child);
    if (!b) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (maxX < minX) return undefined;

  const bounds: Rect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  // Passing the union origin as the layer origin makes computeAlign return the
  // absolute target position of that origin; the delta moves the whole subtree.
  const pos = computeAlign(edge, bounds, doc.width, doc.height, minX, minY);
  const dx = pos.x - minX;
  const dy = pos.y - minY;
  if (dx === 0 && dy === 0) return undefined;

  const moveSet = new Set(descendantIds);
  moveSet.add(groupId);
  return {
    document: {
      ...doc,
      layers: doc.layers.map((l) =>
        moveSet.has(l.id) ? ({ ...l, x: l.x + dx, y: l.y + dy } as Layer) : l,
      ),
    },
    renderVersion: renderVersion + 1,
  };
}
