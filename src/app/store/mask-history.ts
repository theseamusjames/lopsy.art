/**
 * Layer-mask side of the undo system (#780).
 *
 * Masks are snapshotted the same way layer pixels are: a GPU→GPU blit
 * into a pooled snapshot texture (`snapshotMaskGpu`), referenced from the
 * history entry by an opaque handle. This is what lets `pushHistory` run
 * without first reading every mask back into `layer.mask.data` — the
 * synchronous readback that stalled the start of every mask stroke for
 * seconds on large documents while the previous stroke's GPU work drained.
 *
 * Because `layer.mask.data` can lag behind the GPU (the lazy readback in
 * `mask-data-sync.ts` has not landed yet), restoring a snapshot must never
 * let `syncLayers` re-upload those bytes over the restored GPU mask. The
 * restore therefore seeds the mask-upload gate with the restored layer's
 * `mask.data` reference and, when that copy is known to lag, schedules a
 * lazy readback instead.
 */

import type { Layer } from '../../types';
import type { HistorySnapshot, MaskSnapshotEntry } from './types';
import type { Engine } from '../../engine-wasm/wasm-bridge';
import { getEngine } from '../../engine-wasm/engine-state';
import { snapshotMaskGpu, restoreMaskFromGpuSnapshot } from '../../engine-wasm/wasm-bridge';
import { isMaskGpuDirty } from '../../engine-wasm/mask-gpu-dirty';
import { seedMaskDataRef, forgetMaskDataRef } from '../../engine-wasm/sync-state';
import { isMaskDataStale, markMaskDataFresh, scheduleMaskDataRefresh } from '../mask-data-sync';

export const EMPTY_MASK_HANDLE = 0xFFFFFFFF;

function takeMaskSnapshot(layerId: string): number {
  const engine = getEngine();
  if (!engine) return EMPTY_MASK_HANDLE;
  return snapshotMaskGpu(engine, layerId);
}

function reusableHandle(
  layer: Layer,
  previous: HistorySnapshot | undefined,
): number | null {
  if (!layer.mask || previous?.kind !== 'pixels') return null;
  if (isMaskGpuDirty(layer.id)) return null;
  const prevEntry = previous.maskSnapshots.get(layer.id);
  if (!prevEntry || prevEntry.handle === EMPTY_MASK_HANDLE) return null;
  const prevMask = previous.document.layers.find((l) => l.id === layer.id)?.mask;
  if (!prevMask) return null;
  if (prevMask.width !== layer.mask.width || prevMask.height !== layer.mask.height) return null;
  return prevEntry.handle;
}

/**
 * Snapshot every layer mask for a history entry. Masks nothing has written
 * to since `previous` was taken share its handle instead of blitting a
 * new copy — the mask counterpart of the `dirtyLayerIds` reuse in
 * `snapshotGpuLayers`.
 */
export function snapshotGpuMasks(
  layers: readonly Layer[],
  previous: HistorySnapshot | undefined,
): Map<string, MaskSnapshotEntry> {
  const out = new Map<string, MaskSnapshotEntry>();
  for (const layer of layers) {
    if (!layer.mask) continue;
    const handle = reusableHandle(layer, previous) ?? takeMaskSnapshot(layer.id);
    out.set(layer.id, { handle, isDataStale: isMaskDataStale(layer.id) });
  }
  return out;
}

/**
 * Snapshot every layer mask with a fresh handle. For snapshots whose
 * handles are released wholesale if they are discarded (the Move tool's
 * speculative pre-float), where sharing a handle with the undo stack
 * would free a texture the stack still references.
 */
export function snapshotAllMasksFresh(layers: readonly Layer[]): Map<string, MaskSnapshotEntry> {
  const out = new Map<string, MaskSnapshotEntry>();
  for (const layer of layers) {
    if (!layer.mask) continue;
    out.set(layer.id, { handle: takeMaskSnapshot(layer.id), isDataStale: isMaskDataStale(layer.id) });
  }
  return out;
}

/**
 * Reuse `entries`' handles for a snapshot of the *current* document,
 * re-deriving each entry's staleness from the current readback state.
 */
export function withCurrentMaskStaleness(
  entries: ReadonlyMap<string, MaskSnapshotEntry>,
): Map<string, MaskSnapshotEntry> {
  const out = new Map<string, MaskSnapshotEntry>();
  for (const [id, entry] of entries) {
    out.set(id, { handle: entry.handle, isDataStale: isMaskDataStale(id) });
  }
  return out;
}

function adoptGpuMask(engine: Engine, layer: Layer, isDataStale: boolean): void {
  if (!layer.mask) return;
  seedMaskDataRef(engine, layer.id, layer.mask.data);
  if (isDataStale) {
    scheduleMaskDataRefresh(layer.id);
  } else {
    markMaskDataFresh(layer.id);
  }
}

/**
 * Bring the engine's mask textures in line with `target` after an undo or
 * redo, and decide for each mask whether the GPU or `layer.mask.data` is
 * authoritative. Must run after the tracked-state reset and before the
 * restored document is synced.
 *
 * - Pixel snapshot with a mask handle: blit the handle back; the GPU is
 *   authoritative.
 * - Metadata snapshot, and the mask exists live: metadata undo does not
 *   touch pixels, so the live GPU mask stays; the GPU is authoritative.
 * - Otherwise (mask re-appears, or no usable handle): upload
 *   `layer.mask.data` through the normal sync.
 */
export function restoreMasksAfterUndo(
  engine: Engine,
  target: HistorySnapshot,
  liveLayers: readonly Layer[],
): void {
  for (const layer of target.document.layers) {
    if (!layer.mask) continue;

    const entry = target.kind === 'pixels' ? target.maskSnapshots.get(layer.id) : undefined;
    if (entry && entry.handle !== EMPTY_MASK_HANDLE) {
      try {
        restoreMaskFromGpuSnapshot(engine, layer.id, entry.handle);
        adoptGpuMask(engine, layer, entry.isDataStale);
        continue;
      } catch (e) {
        console.error('[Lopsy] mask snapshot restore failed:', layer.id, e);
      }
    }

    const liveMask = liveLayers.find((l) => l.id === layer.id)?.mask;
    if (target.kind === 'metadata' && liveMask) {
      const isDataStale = liveMask.data !== layer.mask.data || isMaskDataStale(layer.id);
      adoptGpuMask(engine, layer, isDataStale);
      continue;
    }

    forgetMaskDataRef(engine, layer.id);
    markMaskDataFresh(layer.id);
  }
}
