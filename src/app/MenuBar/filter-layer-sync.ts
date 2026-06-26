import type { Engine } from '../../engine-wasm/wasm-bridge';
import { syncLayerAfterFullSize } from '../sync-layer-after-full-size';
import { clearJsPixelData } from '../store/clear-js-pixel-data';

/**
 * GPU filter/distort dispatches (blur, liquify, mesh warp, pattern fill, color
 * LUT, …) call `ensure_layer_full_size` on the engine, which expands a cropped
 * or offset layer — e.g. a freshly pasted selection sitting at x>0,y>0 — to
 * cover the document and repositions its origin to (<=0, <=0). The JS store
 * keeps the old bounds, so the stale position is later pushed back to the
 * engine and the layer "jumps" to a different spot on the canvas.
 *
 * Reconcile the JS layer bounds with the engine after such an op, mirroring the
 * GPU brush/smudge path. `syncLayerAfterFullSize` is idempotent: it returns
 * null (no-op) once the layer already covers the document.
 */
export function syncLayerBoundsAfterFilter(engine: Engine, layerId: string): void {
  syncLayerAfterFullSize(engine, layerId);
}

/**
 * `syncLayerBoundsAfterFilter` followed by dropping the now-stale JS pixel data
 * — the common tail of every "apply a GPU filter to the active layer" path.
 */
export function syncAndClearLayerAfterFilter(engine: Engine, layerId: string): void {
  syncLayerAfterFullSize(engine, layerId);
  clearJsPixelData(layerId);
}
