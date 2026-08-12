import type { DocumentState, Layer, Rect } from '../../../types';
import type { ActionResult } from '../types';
import { cropLayerTexture } from '../../../engine-wasm/wasm-bridge';
import { mapLayersForTransform } from './_helpers/layer-transform';

export function computeCropCanvas(
  doc: DocumentState,
  renderVersion: number,
  rect: Rect,
): ActionResult | undefined {
  const docW = doc.width;
  const docH = doc.height;
  const x1 = Math.max(0, Math.round(rect.x));
  const y1 = Math.max(0, Math.round(rect.y));
  const x2 = Math.min(docW, Math.round(rect.x + rect.width));
  const y2 = Math.min(docH, Math.round(rect.y + rect.height));
  const cx = x1;
  const cy = y1;
  const cw = x2 - x1;
  const ch = y2 - y1;
  if (cw <= 0 || ch <= 0) return undefined;

  const newLayers = mapLayersForTransform(doc.layers, {
    onText: (layer) => ({
      ...layer,
      x: Math.round(layer.x - cx),
      y: Math.round(layer.y - cy),
    }) as Layer,
    onRaster: (layer, engine) => {
      if (engine) {
        cropLayerTexture(engine, layer.id, layer.x, layer.y, cx, cy, cw, ch);
      }
      return { ...layer, x: 0, y: 0, width: cw, height: ch } as Layer;
    },
  });

  return {
    document: { ...doc, width: cw, height: ch, layers: newLayers },
    layerPixelData: new Map(),
    renderVersion: renderVersion + 1,
  };
}
