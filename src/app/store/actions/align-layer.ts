import type { DocumentState, Layer, Rect } from '../../../types';
import type { SelectionData, ActionResult } from '../types';
import { computeAlign, getContentBounds, type AlignEdge } from '../../../tools/move/move';
import { readLayerAsImageData } from '../../../engine-wasm/gpu-pixel-access';
import { isGroupLayer, getDescendantIds } from '../../../layers/group-utils';

export function computeAlignLayer(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
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
    return alignGroup(doc, layerPixelData, renderVersion, edge, activeId);
  }

  // Try JS pixel data first, fall back to GPU readback
  const pixelData = layerPixelData.get(activeId) ?? readLayerAsImageData(activeId);
  if (!pixelData) return undefined;

  let bounds: Rect | null;
  if (selection.active && selection.bounds) {
    bounds = selection.bounds;
  } else {
    bounds = getContentBounds(pixelData, layer.x, layer.y);
  }
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
  layerPixelData: Map<string, ImageData>,
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
    const pixelData = layerPixelData.get(id) ?? readLayerAsImageData(id);
    if (!pixelData) continue;
    const b = getContentBounds(pixelData, child.x, child.y);
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
