import type { DocumentState, Layer } from '../../../types';
import type { RasterLayer } from '../../../types/layers';
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
      // Raster layers are stored cropped to their content bounds, so their
      // texture is layer.width x layer.height positioned at (x, y) — not
      // necessarily the full document. Scale the layer's own dimensions and
      // position by the document scale factor; substituting the document size
      // here would stretch a small layer to fill the whole canvas.
      const raster = layer as RasterLayer;
      const scaledWidth = Math.max(1, Math.round(raster.width * scaleX));
      const scaledHeight = Math.max(1, Math.round(raster.height * scaleY));
      if (engine) {
        scaleLayerTexture(engine, layer.id, scaledWidth, scaledHeight);
      }
      return {
        ...layer,
        x: Math.round(layer.x * scaleX),
        y: Math.round(layer.y * scaleY),
        width: scaledWidth,
        height: scaledHeight,
      } as Layer;
    },
  });

  return {
    document: { ...doc, width: newWidth, height: newHeight, layers: newLayers },
    layerPixelData: new Map(),
    renderVersion: renderVersion + 1,
  };
}
