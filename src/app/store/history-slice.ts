import type { HistorySnapshot, SliceCreator } from './types';
import type { Layer } from '../../types';
import { getEngine } from '../../engine-wasm/engine-state';
import { endStroke, getLayerTextureDimensions, uploadLayerPixels } from '../../engine-wasm/wasm-bridge';
import { readLayerCompressed, uploadCompressed } from '../../engine-wasm/gpu-pixel-access';
import { resetTrackedState, flushLayerSync, syncLayers } from '../../engine-wasm/engine-sync';
import { pixelDataManager } from '../../engine/pixel-data-manager';
import { finalizePendingStrokeGlobal } from '../interactions/pending-stroke';

export interface HistorySlice {
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
  isDirty: boolean;
  undo: () => void;
  redo: () => void;
  pushHistory: (label?: string) => void;
  pushHistoryMetadata: (label: string) => void;
  markClean: () => void;
}

// Sentinel value for layers that had no GPU texture at snapshot time.
// On restore, these layers get their texture cleared to transparent.
const EMPTY_LAYER_SENTINEL = new Uint8Array(0);

// After a restore (undo/redo), the GPU pixels are identical to the restored
// snapshot's blobs. Track this so sequential undo/redo can reuse blobs
// instead of re-reading from GPU.
let lastRestoredSnapshot: HistorySnapshot | null = null;

// Pre-cached GPU snapshots for layers that were just modified by a GPU-side
// operation (brush stroke, etc.). Populated by cacheLayerSnapshot() right
// after finalizePendingStroke so the subsequent pushHistory() can use the
// cached blob instead of blocking on a fresh GPU readback.
const preSnapshotCache = new Map<string, Uint8Array>();

export function cacheLayerSnapshot(layerId: string): void {
  const compressed = readLayerCompressed(layerId);
  if (compressed) {
    preSnapshotCache.set(layerId, compressed);
  }
}

export function clearSnapshotCache(): void {
  preSnapshotCache.clear();
}

/**
 * Snapshot GPU textures as cropped blobs.
 * GPU is the single source of truth for pixel data.
 * Caller MUST flush pending JS data to the GPU before calling this
 * (via flushLayerSync) to ensure the GPU has current data.
 */
function snapshotGpuLayers(
  layers: readonly Layer[],
  layerOrder: readonly string[],
  dirtyIds: Set<string>,
  previous: HistorySnapshot | undefined,
): Map<string, Uint8Array> {
  const engine = getEngine();
  const gpuSnapshots = new Map<string, Uint8Array>();

  for (const layerId of layerOrder) {
    // Reuse previous snapshot blob only when the layer's pixels haven't
    // changed AND its document-space position is the same. GPU-side
    // crop/expand (active-layer transitions) changes the texture size and
    // layer x/y without touching dirtyLayerIds, so a position mismatch
    // means the blob's texture dimensions no longer match the current GPU
    // state and must be re-read.
    if (!dirtyIds.has(layerId) && previous?.kind === 'pixels' && previous.gpuSnapshots.has(layerId)) {
      const curLayer = layers.find((l) => l.id === layerId);
      const prevLayer = previous.document.layers.find((l) => l.id === layerId);
      const posMatch = curLayer && prevLayer && curLayer.x === prevLayer.x && curLayer.y === prevLayer.y;
      const dimsChanged = curLayer?.type === 'raster' && prevLayer?.type === 'raster' &&
        (curLayer.width !== prevLayer.width || curLayer.height !== prevLayer.height);
      if (posMatch && !dimsChanged) {
        gpuSnapshots.set(layerId, previous.gpuSnapshots.get(layerId)!);
        continue;
      }
    }

    // Use pre-cached snapshot from finalizePendingStroke if available.
    // This avoids a blocking GPU readback at stroke start.
    const cached = preSnapshotCache.get(layerId);
    if (cached) {
      gpuSnapshots.set(layerId, cached);
      preSnapshotCache.delete(layerId);
      continue;
    }

    if (!engine) {
      gpuSnapshots.set(layerId, EMPTY_LAYER_SENTINEL);
      continue;
    }

    const dims = getLayerTextureDimensions(engine, layerId);
    if (!dims || dims[0] === 0 || dims[1] === 0) {
      gpuSnapshots.set(layerId, EMPTY_LAYER_SENTINEL);
      continue;
    }

    const compressed = readLayerCompressed(layerId);
    if (compressed) {
      gpuSnapshots.set(layerId, compressed);
    } else {
      gpuSnapshots.set(layerId, EMPTY_LAYER_SENTINEL);
    }
  }

  return gpuSnapshots;
}

/**
 * Restore GPU textures from a snapshot's compressed blobs.
 * Empty sentinels clear the layer's texture to transparent.
 */
function restoreGpuFromSnapshot(snapshot: HistorySnapshot): void {
  if (snapshot.kind === 'metadata') return;

  const engine = getEngine();
  for (const [layerId, blob] of snapshot.gpuSnapshots) {
    if (blob.length === 0) {
      // Empty sentinel — clear GPU texture to transparent 1x1
      if (engine) {
        uploadLayerPixels(engine, layerId, new Uint8Array(4), 1, 1, 0, 0);
      }
    } else {
      uploadCompressed(layerId, blob);
    }
  }
}

export const createHistorySlice: SliceCreator<HistorySlice> = (set, get) => ({
  undoStack: [],
  redoStack: [],
  isDirty: false,

  undo: () => {
    finalizePendingStrokeGlobal();

    const state = get();
    if (state.undoStack.length === 0) return;
    const previous = state.undoStack[state.undoStack.length - 1];
    if (!previous) return;

    let currentSnapshot: HistorySnapshot;
    if (previous.kind === 'metadata') {
      currentSnapshot = {
        kind: 'metadata',
        document: state.document,
        label: previous.label,
      };
    } else if (lastRestoredSnapshot && lastRestoredSnapshot.kind === 'pixels') {
      currentSnapshot = {
        kind: 'pixels',
        document: state.document,
        gpuSnapshots: lastRestoredSnapshot.gpuSnapshots,
        label: previous.label,
      };
    } else {
      const gpuSnapshots = snapshotGpuLayers(
        state.document.layers,
        state.document.layerOrder,
        state.dirtyLayerIds,
        previous,
      );
      currentSnapshot = {
        kind: 'pixels',
        document: state.document,
        gpuSnapshots,
        label: previous.label,
      };
    }

    restoreGpuFromSnapshot(previous);
    lastRestoredSnapshot = previous;
    const eng = getEngine();
    if (eng) resetTrackedState(eng);

    pixelDataManager.clearAll();
    set({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, currentSnapshot],
      document: previous.document,
      dirtyLayerIds: new Set(previous.document.layerOrder),
      renderVersion: state.renderVersion + 1,
    });
    // Sync layer descriptors to the engine immediately so the
    // render-frame crop/expand transition reads correct positions.
    // Without this, cropLayerToContent uses stale engine x/y from
    // the pre-undo state and corrupts the restored layer position.
    if (eng) {
      const restored = get();
      syncLayers(eng, restored.document.layers, restored.document.layerOrder, restored.dirtyLayerIds);
    }
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const next = state.redoStack[state.redoStack.length - 1];
    if (!next) return;

    let currentSnapshot: HistorySnapshot;
    if (next.kind === 'metadata') {
      currentSnapshot = {
        kind: 'metadata',
        document: state.document,
        label: next.label,
      };
    } else if (lastRestoredSnapshot && lastRestoredSnapshot.kind === 'pixels') {
      currentSnapshot = {
        kind: 'pixels',
        document: state.document,
        gpuSnapshots: lastRestoredSnapshot.gpuSnapshots,
        label: next.label,
      };
    } else {
      const gpuSnapshots = snapshotGpuLayers(
        state.document.layers,
        state.document.layerOrder,
        state.dirtyLayerIds,
        next,
      );
      currentSnapshot = {
        kind: 'pixels',
        document: state.document,
        gpuSnapshots,
        label: next.label,
      };
    }

    restoreGpuFromSnapshot(next);
    lastRestoredSnapshot = next;
    const eng = getEngine();
    if (eng) resetTrackedState(eng);

    pixelDataManager.clearAll();
    set({
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, currentSnapshot],
      document: next.document,
      dirtyLayerIds: new Set(next.document.layerOrder),
      renderVersion: state.renderVersion + 1,
    });
    if (eng) {
      const restored = get();
      syncLayers(eng, restored.document.layers, restored.document.layerOrder, restored.dirtyLayerIds);
    }
  },

  pushHistory: (label = 'Edit') => {
    const state = get();
    lastRestoredSnapshot = null;

    // Finalize any in-progress GPU stroke so the layer texture includes
    // it before the snapshot. Without this, a stroke still in the stroke
    // texture would be invisible to the snapshot and to any subsequent
    // clipboardCut / clear operation.
    const engine = getEngine();
    if (engine && state.document.activeLayerId) {
      endStroke(engine, state.document.activeLayerId);
    }

    // Flush any pending JS pixel data to the GPU before snapshotting.
    // The GPU is the single source of truth — if JS has data that hasn't
    // been synced yet, the GPU snapshot would capture stale textures.
    flushLayerSync(state);

    const prevSnapshot = state.undoStack[state.undoStack.length - 1];
    const gpuSnapshots = snapshotGpuLayers(state.document.layers, state.document.layerOrder, state.dirtyLayerIds, prevSnapshot);

    const snapshot: HistorySnapshot = {
      kind: 'pixels',
      document: state.document,
      gpuSnapshots,
      label,
    };
    set({
      undoStack: [...state.undoStack.slice(-49), snapshot],
      redoStack: [],
      dirtyLayerIds: new Set(),
      isDirty: true,
      renderVersion: state.renderVersion + 1,
    });
  },

  pushHistoryMetadata: (label: string) => {
    const state = get();
    lastRestoredSnapshot = null;

    const snapshot: HistorySnapshot = {
      kind: 'metadata',
      document: state.document,
      label,
    };
    set({
      undoStack: [...state.undoStack.slice(-49), snapshot],
      redoStack: [],
      isDirty: true,
      renderVersion: state.renderVersion + 1,
    });
  },

  markClean: () => {
    set({ isDirty: false });
  },
});
