import type { DocumentState } from '../../../types';
import type { EditorState, SparseLayerEntry } from '../types';

export function computeRemoveLayer(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
  sparseLayerData: Map<string, SparseLayerEntry>,
  id: string,
): Partial<EditorState> | undefined {
  if (doc.layers.length <= 1) return undefined;

  const layers = doc.layers.filter((l) => l.id !== id);
  const layerOrder = doc.layerOrder.filter((lid) => lid !== id);
  const activeLayerId =
    doc.activeLayerId === id
      ? (layerOrder[layerOrder.length - 1] ?? null)
      : doc.activeLayerId;

  const pixelData = new Map(layerPixelData);
  pixelData.delete(id);

  const sparse = new Map(sparseLayerData);
  sparse.delete(id);

  return {
    document: { ...doc, layers, layerOrder, activeLayerId },
    layerPixelData: pixelData,
    sparseLayerData: sparse,
  };
}
