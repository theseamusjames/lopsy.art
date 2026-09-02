import type { DocumentState } from '../../../types';
import type { ActionResult } from '../types';
import type { Layer } from '../../../types';
import { createRasterLayer, createGroupLayer } from '../../../layers/layer-model';
import { createDefaultAdjustments } from '../../../filters/adjustment-node-utils';
import { getEngine } from '../../../engine-wasm/engine-state';
import { compositeForExport, uploadLayerPixels, addLayer } from '../../../engine-wasm/wasm-bridge';
import { layerToDescJson } from '../../../engine-wasm/sync-layers';

/**
 * Flatten the whole document into a single background raster.
 *
 * Compositing happens on the GPU via `compositeForExport`; no JS-side
 * pixel map is consumed (#746). The returned action clears the pixel
 * manager (empty `layerPixelData`) because every prior layer is now
 * garbage — its texture will be reclaimed engine-side and its JS cache
 * is no longer meaningful.
 */
export function computeFlattenImage(
  doc: DocumentState,
): ActionResult | undefined {
  if (doc.layers.length <= 1) return undefined;

  const { width, height } = doc;
  const flatLayer = createRasterLayer({ name: 'Background', width, height });

  const engine = getEngine();
  if (engine) {
    // GPU-side: composite all layers using the same pipeline as export
    const composited = compositeForExport(engine);

    // Register the new layer with the engine BEFORE uploading pixels.
    // This ensures addLayer sees that no texture exists yet and creates a placeholder,
    // then uploadLayerPixels replaces it with the correct-size texture.
    addLayer(engine, layerToDescJson(flatLayer, true));

    if (composited && composited.length > 0) {
      uploadLayerPixels(engine, flatLayer.id, composited, width, height, 0, 0);
    }
  }

  const pixelData = new Map<string, ImageData>();

  const rootGroup = createGroupLayer({ name: 'Project', children: [flatLayer.id], adjustments: createDefaultAdjustments() });

  return {
    document: {
      ...doc,
      layers: [flatLayer, rootGroup] as Layer[],
      layerOrder: [flatLayer.id, rootGroup.id],
      activeLayerId: flatLayer.id,
      rootGroupId: rootGroup.id,
    },
    layerPixelData: pixelData,
  };
}
