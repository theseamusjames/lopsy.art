import type { DocumentState, Layer, TextLayer } from '../../../types';
import { translateTextLayerForCanvas } from './translate-canvas-overlays';
import type { ActionResult } from '../types';
import { getLayerEngineBounds, resizeCanvasTexture } from '../../../engine-wasm/wasm-bridge';
import { mapLayersForTransform } from './_helpers/layer-transform';
import { remapDocumentMasks } from './_helpers/remap-layer-masks';
import { getEngine } from '../../../engine-wasm/engine-state';
import { translation } from '../../../layers/mask-remap';

export function computeResizeCanvas(
  doc: DocumentState,
  renderVersion: number,
  newWidth: number,
  newHeight: number,
  anchorX: number,
  anchorY: number,
): ActionResult {
  const offset = resizeCanvasOffset(doc, newWidth, newHeight, anchorX, anchorY);
  return computeResizeCanvasAtOffset(doc, renderVersion, newWidth, newHeight, offset.x, offset.y);
}

/** Where Canvas Size puts the old canvas's top-left corner for an anchor. */
export function resizeCanvasOffset(
  doc: Pick<DocumentState, 'width' | 'height'>,
  newWidth: number,
  newHeight: number,
  anchorX: number,
  anchorY: number,
): { x: number; y: number } {
  return {
    x: Math.round((newWidth - doc.width) * anchorX),
    y: Math.round((newHeight - doc.height) * anchorY),
  };
}

/** Resize the canvas, moving existing content by exactly (`offsetX`, `offsetY`). */
export function computeResizeCanvasAtOffset(
  doc: DocumentState,
  renderVersion: number,
  newWidth: number,
  newHeight: number,
  offsetX: number,
  offsetY: number,
): ActionResult {
  const oldW = doc.width;
  const oldH = doc.height;

  const movedLayers = mapLayersForTransform(doc.layers, {
    onText: (layer) => translateTextLayerForCanvas(layer as TextLayer, offsetX, offsetY),
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
  const newLayers = remapDocumentMasks(
    getEngine(), doc.layers, movedLayers, translation(offsetX, offsetY), newWidth, newHeight,
  );

  return {
    document: { ...doc, width: newWidth, height: newHeight, layers: newLayers },
    layerPixelData: new Map(),
    renderVersion: renderVersion + 1,
  };
}
