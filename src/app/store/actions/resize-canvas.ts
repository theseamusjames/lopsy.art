import type { DocumentState, Layer } from '../../../types';
import type { ActionResult } from '../types';
import { resizeCanvasTexture } from '../../../engine-wasm/wasm-bridge';
import { mapLayersForTransform } from './_helpers/layer-transform';

export function computeResizeCanvas(
  doc: DocumentState,
  renderVersion: number,
  newWidth: number,
  newHeight: number,
  anchorX: number,
  anchorY: number,
): ActionResult {
  const oldW = doc.width;
  const oldH = doc.height;
  const offsetX = Math.round((newWidth - oldW) * anchorX);
  const offsetY = Math.round((newHeight - oldH) * anchorY);

  const newLayers = mapLayersForTransform(doc.layers, {
    onText: (layer) => ({
      ...layer,
      x: Math.round(layer.x + offsetX),
      y: Math.round(layer.y + offsetY),
    }) as Layer,
    onRaster: (layer, engine) => {
      if (engine) {
        resizeCanvasTexture(
          engine, layer.id,
          layer.x, layer.y, oldW, oldH,
          newWidth, newHeight, offsetX, offsetY,
        );
      }
      return { ...layer, x: 0, y: 0, width: newWidth, height: newHeight } as Layer;
    },
  });

  return {
    document: { ...doc, width: newWidth, height: newHeight, layers: newLayers },
    layerPixelData: new Map(),
    renderVersion: renderVersion + 1,
  };
}
