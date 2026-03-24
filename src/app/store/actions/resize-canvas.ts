import type { DocumentState, Layer } from '../../../types';
import type { EditorState } from '../types';
import { getEngine } from '../../../engine-wasm/engine-state';
import { resizeCanvasTexture } from '../../../engine-wasm/wasm-bridge';

export function computeResizeCanvas(
  doc: DocumentState,
  _layerPixelData: Map<string, ImageData>,
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

  const engine = getEngine();
  const newLayers: Layer[] = [];

  for (const layer of doc.layers) {
    if (layer.type !== 'raster') {
      newLayers.push(layer);
      continue;
    }

    // GPU-side canvas resize: reposition pixels within new canvas
    if (engine) {
      resizeCanvasTexture(
        engine, layer.id,
        layer.x, layer.y, oldW, oldH,
        newWidth, newHeight, offsetX, offsetY,
      );
    }

    newLayers.push({ ...layer, x: 0, y: 0, width: newWidth, height: newHeight } as Layer);
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
