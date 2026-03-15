import type { DocumentState } from '../../../types';
import type { EditorState } from '../types';
import { duplicateLayer as duplicateLayerModel } from '../../../layers/layer-model';
import { cloneImageData } from '../../../engine/canvas-ops';

export function computeDuplicateLayer(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
): Partial<EditorState> | undefined {
  const activeId = doc.activeLayerId;
  if (!activeId) return undefined;
  const layer = doc.layers.find((l) => l.id === activeId);
  if (!layer) return undefined;

  const newLayer = duplicateLayerModel(layer);
  const newId = newLayer.id;
  const pixelData = new Map(layerPixelData);
  const existingData = layerPixelData.get(activeId);
  if (existingData) {
    pixelData.set(newId, cloneImageData(existingData));
  }
  const orderIdx = doc.layerOrder.indexOf(activeId);
  const newOrder = [...doc.layerOrder];
  newOrder.splice(orderIdx + 1, 0, newId);

  return {
    document: {
      ...doc,
      layers: [...doc.layers, newLayer],
      layerOrder: newOrder,
      activeLayerId: newId,
    },
    layerPixelData: pixelData,
  };
}
