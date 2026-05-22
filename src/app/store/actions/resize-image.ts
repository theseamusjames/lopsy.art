import type { DocumentState, Layer } from '../../../types';
import type { ActionResult } from '../types';
import { scaleLayerTexture } from '../../../engine-wasm/wasm-bridge';
import { mapLayersForTransform } from './_helpers/layer-transform';

export function computeResizeImage(
  doc: DocumentState,
  _layerPixelData: Map<string, ImageData>,
  renderVersion: number,
  newWidth: number,
  newHeight: number,
): ActionResult {
  const scaleX = newWidth / doc.width;
  const scaleY = newHeight / doc.height;

  const newLayers = mapLayersForTransform(doc.layers, {
    onText: (layer) => ({
      ...layer,
      x: Math.round(layer.x * scaleX),
      y: Math.round(layer.y * scaleY),
    }) as Layer,
    onRaster: (layer, engine) => {
      if (engine) {
        scaleLayerTexture(engine, layer.id, newWidth, newHeight);
      }
      return {
        ...layer,
        x: Math.round(layer.x * scaleX),
        y: Math.round(layer.y * scaleY),
        width: newWidth,
        height: newHeight,
      } as Layer;
    },
  });

  return {
    document: { ...doc, width: newWidth, height: newHeight, layers: newLayers },
    layerPixelData: new Map(),
    renderVersion: renderVersion + 1,
  };
}
