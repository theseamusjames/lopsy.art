import type { Layer } from '../../../../types';
import { getEngine } from '../../../../engine-wasm/engine-state';

type Engine = NonNullable<ReturnType<typeof getEngine>>;

interface LayerTransformHandlers {
  onText: (layer: Layer) => Layer;
  onRaster: (layer: Layer, engine: Engine | null) => Layer;
}

/**
 * Iterates document layers and dispatches by type. Text and raster
 * layers are handled by the provided callbacks; groups and other
 * non-raster types pass through unchanged.
 */
export function mapLayersForTransform(
  layers: readonly Layer[],
  handlers: LayerTransformHandlers,
): Layer[] {
  const engine = getEngine();
  const result: Layer[] = [];

  for (const layer of layers) {
    if (layer.type === 'text') {
      result.push(handlers.onText(layer));
    } else if (layer.type === 'raster') {
      result.push(handlers.onRaster(layer, engine));
    } else {
      result.push(layer);
    }
  }

  return result;
}
