import type { DocumentState, Layer, Rect } from '../../../types';
import type { SelectionData, ActionResult } from '../types';
import { computeAlign, getContentBounds, type AlignEdge } from '../../../tools/move/move';
import { readLayerAsImageData } from '../../../engine-wasm/gpu-pixel-access';

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
