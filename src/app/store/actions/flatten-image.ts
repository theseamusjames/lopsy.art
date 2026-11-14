import type { DocumentState } from '../../../types';
import type { ActionResult } from '../types';
import type { Layer } from '../../../types';
import { createRasterLayer, createGroupLayer } from '../../../layers/layer-model';
import { createDefaultAdjustments } from '../../../filters/adjustment-node-utils';
import { isAdjustmentAllowedInMode } from '../../../utils/color-mode-capabilities';
import { getEngine } from '../../../engine-wasm/engine-state';
import { flattenIntoLayer, addLayer } from '../../../engine-wasm/wasm-bridge';
import { layerToDescJson } from '../../../engine-wasm/sync-layers';

/**
 * Flatten the whole document into a single background raster.
 *
 * The engine composites the document straight into the new layer
 * (`flattenIntoLayer`); no pixels are read back or uploaded (#746), except
 * in a Lab document, whose composite the engine decodes on the CPU. The returned action clears the pixel
 * manager (empty `layerPixelData`) because every prior layer is now
 * garbage — its texture will be reclaimed engine-side and its JS cache
 * is no longer meaningful.
 */
export async function computeFlattenImage(
  doc: DocumentState,
): Promise<ActionResult | undefined> {
  if (doc.layers.length <= 1) return undefined;

  const { width, height } = doc;
  const flatLayer = createRasterLayer({ name: 'Background', width, height });

  const engine = getEngine();
  if (engine) {
    // Register the new layer first so the engine has a slot for it, then
    // have the engine composite the document straight into it. The pixels
    // stay on the GPU (#746).
    addLayer(engine, layerToDescJson(flatLayer, true, doc.colorMode));
    await flattenIntoLayer(engine, flatLayer.id);
  }

  const pixelData = new Map<string, ImageData>();

  const adjustments = createDefaultAdjustments().filter((n) =>
    isAdjustmentAllowedInMode(n.type, doc.colorMode),
  );
  const rootGroup = createGroupLayer({ name: 'Project', children: [flatLayer.id], adjustments });

  return {
    document: {
      ...doc,
      layers: [flatLayer, rootGroup] as Layer[],
      layerOrder: [flatLayer.id, rootGroup.id],
      activeLayerId: flatLayer.id,
      selectedLayerIds: [flatLayer.id],
      rootGroupId: rootGroup.id,
    },
    layerPixelData: pixelData,
  };
}
