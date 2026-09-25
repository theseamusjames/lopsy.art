import type { Rect } from '../../types';
import type { Engine } from '../../engine-wasm/wasm-bridge';
import { ensureFloatCovers } from '../../engine-wasm/wasm-bridge';
import { useEditorStore } from '../editor-store';
import { reconcileLayerBoundsWithEngine } from '../reconcile-layer-bounds';

/**
 * Grow the live float of a raster layer so its buffer holds `rect` (the
 * transformed content's document-space bounds) before the transform is
 * composited into it. Without this, pixels a rotate/scale carries past the
 * canvas-plus-content buffer were clipped at render time and lost for good
 * when the float was dropped (#818). The store follows the grown texture.
 */
export function growFloatToCover(engine: Engine, layerId: string, rect: Rect): void {
  const layer = useEditorStore.getState().document.layers.find((l) => l.id === layerId);
  if (!layer || layer.type !== 'raster') return;
  // One pixel of slack for the bilinear edge of the transformed content.
  const x = Math.floor(rect.x) - 1;
  const y = Math.floor(rect.y) - 1;
  const right = Math.ceil(rect.x + rect.width) + 1;
  const bottom = Math.ceil(rect.y + rect.height) + 1;
  const grown = ensureFloatCovers(engine, x, y, right - x, bottom - y);
  if (grown.length === 4) reconcileLayerBoundsWithEngine(engine, layerId);
}
