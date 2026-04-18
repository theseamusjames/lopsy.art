import type { DocumentState, Layer } from '../../../types';
import type { ActionResult } from '../types';
import { getEngine } from '../../../engine-wasm/engine-state';
import { scaleLayerTexture } from '../../../engine-wasm/wasm-bridge';

export function computeResizeImage(
  doc: DocumentState,
  _layerPixelData: Map<string, ImageData>,
  renderVersion: number,
  newWidth: number,
  newHeight: number,
): ActionResult {
  const oldW = doc.width;
  const oldH = doc.height;
  const scaleX = newWidth / oldW;
  const scaleY = newHeight / oldH;

  const engine = getEngine();
  const newLayers: Layer[] = [];

  for (const layer of doc.layers) {
    if (layer.type !== 'raster') {
      newLayers.push(layer);
      continue;
    }

    // GPU-side scale
    if (engine) {
      scaleLayerTexture(engine, layer.id, newWidth, newHeight);
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
    layerPixelData: new Map(),
    renderVersion: renderVersion + 1,
  };
}
