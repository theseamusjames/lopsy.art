import type { DocumentState, Layer } from '../../../types';
import type { EditorState } from '../types';
import { scalePixelData } from '../../../engine/canvas-ops';
import { createImageData } from '../../../engine/color-space';

export function computeResizeImage(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
  renderVersion: number,
  newWidth: number,
  newHeight: number,
): Partial<EditorState> {
  const oldW = doc.width;
  const oldH = doc.height;
  const scaleX = newWidth / oldW;
  const scaleY = newHeight / oldH;

  const pixelData = new Map<string, ImageData>();
  const newLayers: Layer[] = [];

  for (const layer of doc.layers) {
    if (layer.type !== 'raster') {
      newLayers.push(layer);
      continue;
    }
    const oldData = layerPixelData.get(layer.id);
    if (oldData) {
      const scaled = scalePixelData(oldData, newWidth, newHeight);
      if (!scaled) continue;
      pixelData.set(layer.id, scaled);
    } else {
      pixelData.set(layer.id, createImageData(newWidth, newHeight));
    }
    newLayers.push({
      ...layer,
      x: Math.round(layer.x * scaleX),
      y: Math.round(layer.y * scaleY),
      width: newWidth,
      height: newHeight,
    } as Layer);
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
