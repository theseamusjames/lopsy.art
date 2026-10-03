import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { markMaskDataStale, scheduleMaskDataRefresh } from '../mask-data-sync';
import { syncLayerAfterFullSize } from '../sync-layer-after-full-size';
import {
  beginMaskFilterTarget,
  endMaskFilterTarget,
  type Engine,
} from '../../engine-wasm/wasm-bridge';
import { uploadLayerMaskIfChanged } from '../../engine-wasm/engine-sync';
import { guardPixelWrite } from '../../layers/paint-target';

/**
 * What a Filter menu command writes: the active layer's pixels or, in
 * layer-mask edit mode, its mask (#1150). The engine runs a mask filter by
 * swapping the mask into the layer's texture slot for the duration of the
 * call, so every filter works on a mask without a mask-specific variant;
 * the result is folded back to grey luminance.
 */
export interface FilterTarget {
  readonly layerId: string;
  readonly isMask: boolean;
}

/** True when Filter commands would write the active layer's mask. */
export function isFilteringMask(): boolean {
  if (useUIStore.getState().maskMode !== 'layerMask') return false;
  const { document: doc } = useEditorStore.getState();
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
  return Boolean(layer?.mask);
}

/**
 * The active filter target, or null when there is nothing to filter. A
 * layer target goes through `guardPixelWrite` (which may prompt to
 * rasterize); a mask can be filtered on any layer type.
 */
export function resolveFilterTarget(): FilterTarget | null {
  const { document: doc } = useEditorStore.getState();
  const layerId = doc.activeLayerId;
  if (!layerId) return null;
  if (isFilteringMask()) return { layerId, isMask: true };
  const layer = doc.layers.find((l) => l.id === layerId);
  if (!guardPixelWrite(layer)) return null;
  return { layerId, isMask: false };
}

/** Run engine filter calls (keyed by `target.layerId`) against the target. */
export function runOnFilterTarget(engine: Engine, target: FilterTarget, run: () => void): void {
  if (!target.isMask) {
    run();
    return;
  }
  const layer = useEditorStore.getState().document.layers.find((l) => l.id === target.layerId);
  if (!layer?.mask) return;
  // Skip the upload when the engine already holds this mask array: the GPU
  // copy is current or newer than `mask.data` (#780).
  uploadLayerMaskIfChanged(engine, target.layerId, layer.mask.data, layer.mask.width, layer.mask.height);
  if (!beginMaskFilterTarget(engine, target.layerId)) return;
  try {
    run();
  } finally {
    endMaskFilterTarget(engine, target.layerId);
  }
}

/**
 * Record that a filter wrote the target. `isSettled` is false for a live
 * preview: a mask's JS bytes are then only marked stale, and refreshed
 * once the preview is applied or cancelled.
 */
export function markFilterTargetWritten(engine: Engine, target: FilterTarget, isSettled: boolean): void {
  if (target.isMask) {
    if (isSettled) scheduleMaskDataRefresh(target.layerId);
    else markMaskDataStale(target.layerId);
    return;
  }
  if (isSettled) syncLayerAfterFullSize(engine, target.layerId);
  clearJsPixelData(target.layerId);
}
