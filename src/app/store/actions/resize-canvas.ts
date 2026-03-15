import type { DocumentState, Layer } from '../../../types';
import type { EditorState } from '../types';
import { resizeCanvasPixelData } from '../../../engine/canvas-ops';

export function computeResizeCanvas(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
  renderVersion: number,
  newWidth: number,
  newHeight: number,
  anchorX: number,
  anchorY: number,
): Partial<EditorState> {
  const oldW = doc.width;
  const oldH = doc.height;
  const offsetX = Math.round((newWidth - oldW) * anchorX);
  const offsetY = Math.round((newHeight - oldH) * anchorY);

  const pixelData = new Map<string, ImageData>();
  const newLayers: Layer[] = [];

  for (const layer of doc.layers) {
    if (layer.type !== 'raster') {
      newLayers.push(layer);
      continue;
    }
    const oldData = layerPixelData.get(layer.id);
    const newData = oldData
      ? resizeCanvasPixelData(oldData, layer.x, layer.y, newWidth, newHeight, offsetX, offsetY)
      : new ImageData(newWidth, newHeight);
    pixelData.set(layer.id, newData);
    newLayers.push({ ...layer, x: 0, y: 0, width: newWidth, height: newHeight } as Layer);
  }

  return {
    document: {
      ...doc,
      width: newWidth,
      height: newHeight,
      layers: newLayers,
    },
    layerPixelData: pixelData,
    renderVersion: renderVersion + 1,
  };
}
