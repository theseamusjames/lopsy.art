import type { DocumentState, Layer } from '../../../types';
import type { ActionResult } from '../types';
import { computeFit } from '../../../tools/move/move';
import { getEngine } from '../../../engine-wasm/engine-state';
import { scaleLayerTexture } from '../../../engine-wasm/wasm-bridge';

/**
 * Scale and center the active raster layer so it fits within the canvas
 * (longest side = canvas side, aspect-preserving). Used when a paste or drop
 * produced a layer that overflows the canvas.
 */
export function computeFitLayer(
  doc: DocumentState,
  renderVersion: number,
): ActionResult | undefined {
  const activeId = doc.activeLayerId;
  if (!activeId) return undefined;
  const layer = doc.layers.find((l) => l.id === activeId);
  if (!layer || layer.type !== 'raster') return undefined;

  const fit = computeFit(layer.width, layer.height, doc.width, doc.height);
  if (fit.width === layer.width && fit.height === layer.height && fit.x === layer.x && fit.y === layer.y) {
    return undefined;
  }

  const engine = getEngine();
  if (engine) {
    scaleLayerTexture(engine, activeId, fit.width, fit.height);
  }

  return {
    document: {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === activeId
          ? ({ ...l, x: fit.x, y: fit.y, width: fit.width, height: fit.height } as Layer)
          : l,
      ),
    },
    renderVersion: renderVersion + 1,
  };
}
