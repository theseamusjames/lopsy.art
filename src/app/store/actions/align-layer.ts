import type { DocumentState, Layer, Rect } from '../../../types';
import type { SelectionData, ActionResult } from '../types';
import { computeAlign, computeAlignToFrame, type AlignEdge } from '../../../tools/move/move';
import { isGroupLayer, getDescendantIds, isAncestorOf } from '../../../layers/group-utils';
import { unionRects } from '../../../tools/transform/multi-layer-transform';

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

  // Several layers picked in the Layers panel, no marquee: line them up with
  // each other, inside the box that frames them all (#1517).
  if (!selection.active && (doc.selectedLayerIds?.length ?? 0) >= 2) {
    return alignSelectedLayers(doc, contentBoundsOf, renderVersion, edge);
  }
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

function rasterBounds(
  doc: DocumentState,
  contentBoundsOf: ContentBoundsLookup,
  id: string,
): Rect | null {
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer || isGroupLayer(layer)) return null;
  return contentBoundsOf(layer);
}

/** The content a selected layer or group moves as one, and the ids that move with it. */
function alignItem(
  doc: DocumentState,
  contentBoundsOf: ContentBoundsLookup,
  id: string,
): { bounds: Rect; moveIds: string[] } | null {
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer) return null;
  if (!isGroupLayer(layer)) {
    const bounds = rasterBounds(doc, contentBoundsOf, id);
    return bounds ? { bounds, moveIds: [id] } : null;
  }
  const descendantIds = getDescendantIds(doc.layers, id);
  const rects = descendantIds
    .map((childId) => rasterBounds(doc, contentBoundsOf, childId))
    .filter((r): r is Rect => r !== null);
  const bounds = unionRects(rects);
  return bounds ? { bounds, moveIds: [id, ...descendantIds] } : null;
}

function shiftLayers(
  doc: DocumentState,
  renderVersion: number,
  deltas: ReadonlyMap<string, { dx: number; dy: number }>,
): ActionResult | undefined {
  if ([...deltas.values()].every((d) => d.dx === 0 && d.dy === 0)) return undefined;
  return {
    document: {
      ...doc,
      layers: doc.layers.map((l) => {
        const d = deltas.get(l.id);
        return d ? ({ ...l, x: l.x + d.dx, y: l.y + d.dy } as Layer) : l;
      }),
    },
    renderVersion: renderVersion + 1,
  };
}

function alignSelectedLayers(
  doc: DocumentState,
  contentBoundsOf: ContentBoundsLookup,
  renderVersion: number,
  edge: AlignEdge,
): ActionResult | undefined {
  const selected = doc.selectedLayerIds;
  // A layer inside a selected group already moves with that group; locked
  // layers stay put, as in a Move drag.
  const roots = selected.filter((id) => {
    const layer = doc.layers.find((l) => l.id === id);
    if (!layer || layer.locked) return false;
    return !selected.some((other) => other !== id && isAncestorOf(doc.layers, other, id));
  });
  const items = roots
    .map((id) => alignItem(doc, contentBoundsOf, id))
    .filter((item): item is { bounds: Rect; moveIds: string[] } => item !== null);
  if (items.length === 0) return undefined;
  const frame = unionRects(items.map((item) => item.bounds));
  if (!frame) return undefined;

  const deltas = new Map<string, { dx: number; dy: number }>();
  for (const item of items) {
    const delta = computeAlignToFrame(edge, item.bounds, frame);
    for (const id of item.moveIds) deltas.set(id, delta);
  }
  return shiftLayers(doc, renderVersion, deltas);
}

function alignGroup(
  doc: DocumentState,
  contentBoundsOf: ContentBoundsLookup,
  renderVersion: number,
  edge: AlignEdge,
  groupId: string,
): ActionResult | undefined {
  const item = alignItem(doc, contentBoundsOf, groupId);
  if (!item) return undefined;
  const { bounds } = item;
  // Passing the union origin as the layer origin makes computeAlign return the
  // absolute target position of that origin; the delta moves the whole subtree.
  const pos = computeAlign(edge, bounds, doc.width, doc.height, bounds.x, bounds.y);
  const delta = { dx: pos.x - bounds.x, dy: pos.y - bounds.y };
  return shiftLayers(doc, renderVersion, new Map(item.moveIds.map((id) => [id, delta])));
}
