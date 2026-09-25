/**
 * Keeps `layer.mask.data` (the JS copy of a layer mask) eventually
 * consistent with the GPU mask texture, which is the source of truth
 * while a mask is being edited.
 *
 * Mask paint, fill and gradient write the GPU texture directly. The JS
 * bytes are only needed for the mask thumbnail, project save, PSD export
 * and duplicating a masked layer, so they are refreshed lazily through
 * the quiescence queue in `mask-read-queue.ts` instead of on the
 * gesture boundary. Undo does not need them either: history snapshots
 * hold GPU mask handles (`snapshotMaskGpu`), not the JS bytes (#780).
 *
 * A layer id is "stale" from the moment its GPU mask is written until a
 * readback lands. Callers that must have current bytes on the JS side
 * call `materializeMaskData` / `materializeAllMaskData`, which pay the
 * synchronous readback only for stale masks and only at moments that
 * are not on the paint hot path (save, export, duplicate, remove mask).
 */

import { useEditorStore } from './editor-store';
import { getEngine } from '../engine-wasm/engine-state';
import { readMaskTexture } from '../engine-wasm/wasm-bridge';
import { seedMaskDataRef } from '../engine-wasm/sync-state';
import { requestMaskRead, cancelMaskRead } from './mask-read-queue';

const staleIds = new Set<string>();

function readMask(layerId: string): Uint8ClampedArray | null {
  const engine = getEngine();
  if (!engine) return null;
  const bytes = readMaskTexture(engine, layerId);
  return bytes ? new Uint8ClampedArray(bytes) : null;
}

function applyReadback(layerId: string, data: Uint8ClampedArray): void {
  staleIds.delete(layerId);
  const editor = useEditorStore.getState();
  const layer = editor.document.layers.find((l) => l.id === layerId);
  if (!layer?.mask) return;
  if (data.length !== layer.mask.width * layer.mask.height) return;
  editor.updateLayerMaskData(layerId, data);
  const engine = getEngine();
  // These bytes just came *from* the GPU — record them as the tracked
  // upload so the next syncLayers doesn't echo them straight back (#734).
  if (engine) seedMaskDataRef(engine, layerId, data);
}

/**
 * The GPU mask is about to be written (stroke start). Drop any queued
 * readback — the stroke's own end will queue a fresh one — so a read
 * can't fire mid-stroke and stall on the dab backlog.
 */
export function markMaskDataStale(layerId: string): void {
  staleIds.add(layerId);
  cancelMaskRead(layerId);
}

/** The GPU mask has been written; refresh the JS bytes once the GPU is idle. */
export function scheduleMaskDataRefresh(layerId: string): void {
  staleIds.add(layerId);
  requestMaskRead(layerId, () => readMask(layerId), (data) => applyReadback(layerId, data));
}

/** The JS bytes are known to match the GPU (e.g. they were just uploaded). */
export function markMaskDataFresh(layerId: string): void {
  staleIds.delete(layerId);
  cancelMaskRead(layerId);
}

export function isMaskDataStale(layerId: string): boolean {
  return staleIds.has(layerId);
}

/** Synchronously bring one layer's `mask.data` up to date with the GPU. */
export function materializeMaskData(layerId: string): void {
  if (!staleIds.has(layerId)) return;
  cancelMaskRead(layerId);
  let data: Uint8ClampedArray | null = null;
  try {
    data = readMask(layerId);
  } catch (e) {
    console.error('[Lopsy] mask readback failed:', e);
  }
  if (data) {
    applyReadback(layerId, data);
  } else {
    // No GPU mask to read — the JS bytes are the best copy there is.
    staleIds.delete(layerId);
  }
}

/** Synchronously bring every stale `mask.data` up to date with the GPU. */
export function materializeAllMaskData(): void {
  for (const id of [...staleIds]) materializeMaskData(id);
}

/** Test-only: forget all staleness without reading anything. */
export function __resetMaskDataSyncForTest(): void {
  for (const id of staleIds) cancelMaskRead(id);
  staleIds.clear();
}
