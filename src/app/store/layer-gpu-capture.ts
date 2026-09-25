import type { Layer } from '../../types';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  snapshotLayerGpu, restoreFromGpuSnapshot, releaseGpuSnapshot, uploadLayerPixels,
} from '../../engine-wasm/wasm-bridge';

/**
 * A layer's state captured before an operation started mutating it: its model
 * descriptor plus a GPU texture copy from `captureLayerGpu`. Ownership of
 * `gpuHandle` passes to the history entry it is pushed with.
 */
export interface LayerHistoryBefore {
  layer: Layer;
  gpuHandle: number;
}

export const EMPTY_HANDLE = 0xFFFFFFFF;

/** Duplicate a layer's current GPU texture; EMPTY_HANDLE when it has none. */
export function captureLayerGpu(layerId: string): number {
  const engine = getEngine();
  if (!engine) return EMPTY_HANDLE;
  return snapshotLayerGpu(engine, layerId);
}

/** Blit a captured handle back into a layer texture (EMPTY_HANDLE clears it). */
export function restoreLayerGpu(layerId: string, handle: number): void {
  const engine = getEngine();
  if (!engine) return;
  if (handle === EMPTY_HANDLE) {
    uploadLayerPixels(engine, layerId, new Uint8Array(4), 1, 1, 0, 0);
  } else {
    restoreFromGpuSnapshot(engine, layerId, handle);
  }
}

/** Free a captured handle that will not be pushed to history. */
export function releaseLayerGpu(handle: number): void {
  if (handle === EMPTY_HANDLE) return;
  const engine = getEngine();
  if (engine) releaseGpuSnapshot(engine, handle);
}
