import type { DocumentState, Layer } from '../../../types';
import type { ActionResult } from '../types';
import { getLayerEngineBounds, resizeCanvasTexture } from '../../../engine-wasm/wasm-bridge';
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
        // The layer's GPU texture may be smaller than the document — an
        // inactive layer is cropped to its content bounds (#902) — so the
        // "old size" for the copy must be the texture's actual dimensions,
        // not the document's. `getLayerEngineBounds` reads that straight
        // from `texture_pool`, which never lags the store.
        const [ex = 0, ey = 0, ew = 0, eh = 0] = getLayerEngineBounds(engine, layer.id);
        const hasValidBounds = ew > 0 && eh > 0;
        const srcX = hasValidBounds ? ex : layer.x;
        const srcY = hasValidBounds ? ey : layer.y;
        const srcW = hasValidBounds ? ew : oldW;
        const srcH = hasValidBounds ? eh : oldH;
        resizeCanvasTexture(
          engine, layer.id,
          srcX, srcY, srcW, srcH,
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
