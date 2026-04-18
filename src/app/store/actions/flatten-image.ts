import type { DocumentState } from '../../../types';
import type { ActionResult } from '../types';
import type { Layer } from '../../../types';
import { createRasterLayer, createGroupLayer } from '../../../layers/layer-model';
import { getEngine } from '../../../engine-wasm/engine-state';
import { compositeForExport, uploadLayerPixels, addLayer } from '../../../engine-wasm/wasm-bridge';

export function computeFlattenImage(
  doc: DocumentState,
  _layerPixelData: Map<string, ImageData>,
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
    const descJson = JSON.stringify({
      id: flatLayer.id,
      name: flatLayer.name,
      layer_type: 'Raster',
      visible: true,
      locked: false,
      opacity: 1.0,
      blend_mode: 'Normal',
      x: 0,
      y: 0,
      width,
      height,
      clip_to_below: false,
      effects: {},
      mask: null,
    });
    addLayer(engine, descJson);

    if (composited && composited.length > 0) {
      uploadLayerPixels(engine, flatLayer.id, composited, width, height, 0, 0);
    }
  }

  const pixelData = new Map<string, ImageData>();

  const rootGroup = createGroupLayer({ name: 'Project', children: [flatLayer.id] });

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
