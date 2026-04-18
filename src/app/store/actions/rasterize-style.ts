import type { DocumentState, Layer } from '../../../types';
import type { ActionResult } from '../types';
import { hasEnabledEffects, DEFAULT_EFFECTS } from '../../../layers/layer-model';
import { getEngine } from '../../../engine-wasm/engine-state';
import { rasterizeLayerEffects, uploadLayerPixels } from '../../../engine-wasm/wasm-bridge';

export function computeRasterizeStyle(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
): ActionResult | undefined {
  const activeId = doc.activeLayerId;
  if (!activeId) return undefined;
  const layer = doc.layers.find((l) => l.id === activeId);
  if (!layer || !hasEnabledEffects(layer.effects)) return undefined;

  const engine = getEngine();
  if (!engine) return undefined;

  // GPU-side: render layer with effects, then replace layer texture
  const pixels = rasterizeLayerEffects(engine, activeId);
  if (!pixels || pixels.length === 0) return undefined;

  // Upload rasterized result back to the layer's GPU texture
  uploadLayerPixels(engine, activeId, pixels, doc.width, doc.height, 0, 0);

  // Clear stale JS pixel data
  const pixelData = new Map(layerPixelData);
  pixelData.delete(activeId);

  return {
    document: {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === activeId
          ? {
              ...l,
              x: 0,
              y: 0,
              effects: DEFAULT_EFFECTS,
              ...(l.type === 'raster' ? { width: doc.width, height: doc.height } : {}),
            } as Layer
          : l,
      ),
    },
    layerPixelData: pixelData,
  };
}
