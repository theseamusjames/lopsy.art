import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { markMaskDataStale, scheduleMaskDataRefresh } from '../mask-data-sync';
import { syncLayerAfterFullSize } from '../sync-layer-after-full-size';
import {
  beginMaskFilterTarget,
  endMaskFilterTarget,
  snapshotLayerGpu,
  restoreFromGpuSnapshot,
  releaseGpuSnapshot,
  restoreFilterPreview,
  clearFilterPreview,
  type Engine,
} from '../../engine-wasm/wasm-bridge';
import { EMPTY_HANDLE } from '../store/layer-gpu-capture';
import { uploadLayerMaskIfChanged } from '../../engine-wasm/engine-sync';
import { canReceiveRasterPaint, guardPixelWrite } from '../../layers/paint-target';

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

/**
 * `resolveFilterTarget` without the toast, for the steps of a session that
 * already resolved its target once (preview updates, cancel, apply). A group
 * or text layer still yields null, so no step can expand it (#1395).
 */
export function peekFilterTarget(): FilterTarget | null {
  const { document: doc } = useEditorStore.getState();
  const layerId = doc.activeLayerId;
  if (!layerId) return null;
  if (isFilteringMask()) return { layerId, isMask: true };
  const layer = doc.layers.find((l) => l.id === layerId);
  if (!canReceiveRasterPaint(layer)) return null;
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

/** Put a kept preview back into the target. False when it could not be. */
function restoreKeptPreview(engine: Engine, layerId: string, preview: number): boolean {
  if (preview === EMPTY_HANDLE) return false;
  try {
    restoreFromGpuSnapshot(engine, layerId, preview);
    return true;
  } catch {
    return false;
  }
}

/**
 * Commit a live filter preview as one history step. The preview on screen
 * is kept in a GPU snapshot while the original comes back for history to
 * capture, then copied in again, so its pixels never leave the GPU.
 * `applyFresh` runs the filter again when the preview could not be kept.
 */
export function commitFilterPreview(
  engine: Engine,
  target: FilterTarget,
  label: string,
  applyFresh: () => void,
): void {
  let preview = EMPTY_HANDLE;
  runOnFilterTarget(engine, target, () => {
    preview = snapshotLayerGpu(engine, target.layerId);
    restoreFilterPreview(engine);
  });
  clearFilterPreview(engine);

  useEditorStore.getState().pushHistory(label);

  runOnFilterTarget(engine, target, () => {
    if (!restoreKeptPreview(engine, target.layerId, preview)) applyFresh();
  });
  // Never part of a history entry, so the ledger does not own it.
  if (preview !== EMPTY_HANDLE) releaseGpuSnapshot(engine, preview);
  markFilterTargetWritten(engine, target, true);
  useEditorStore.getState().notifyRender();
}

