import type { HistorySnapshot, SliceCreator } from './types';
import { getEngine } from '../../engine-wasm/engine-state';
import { getLayerTextureDimensions, uploadLayerPixels } from '../../engine-wasm/wasm-bridge';
import { readLayerCompressed, uploadCompressed } from '../../engine-wasm/gpu-pixel-access';
import { resetTrackedState, flushLayerSync } from '../../engine-wasm/engine-sync';
import { finalizePendingStrokeGlobal } from '../interactions/pending-stroke';

export interface HistorySlice {
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
  isDirty: boolean;
  undo: () => void;
  redo: () => void;
  pushHistory: (label?: string) => void;
  markClean: () => void;
}

// Sentinel value for layers that had no GPU texture at snapshot time.
// On restore, these layers get their texture cleared to transparent.
const EMPTY_LAYER_SENTINEL = new Uint8Array(0);

/**
 * Snapshot GPU textures as cropped blobs.
 * GPU is the single source of truth for pixel data.
 * Caller MUST flush pending JS data to the GPU before calling this
 * (via flushLayerSync) to ensure the GPU has current data.
 */
function snapshotGpuLayers(
  layerOrder: readonly string[],
  dirtyIds: Set<string>,
  previous: HistorySnapshot | undefined,
): Map<string, Uint8Array> {
  const engine = getEngine();
  const gpuSnapshots = new Map<string, Uint8Array>();

  for (const layerId of layerOrder) {
    // Reuse previous snapshot blob for non-dirty layers
    if (!dirtyIds.has(layerId) && previous?.gpuSnapshots.has(layerId)) {
      gpuSnapshots.set(layerId, previous.gpuSnapshots.get(layerId)!);
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
  if (snapshot.metadataOnly) return;

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

/**
 * Snapshot the current live state for the undo/redo opposite stack.
 */
function snapshotCurrentState(
  state: {
    document: HistorySnapshot['document'];
    dirtyLayerIds: Set<string>;
  },
  label: string,
  metadataOnly: boolean,
  prevSnapshot: HistorySnapshot | undefined,
): HistorySnapshot {
  if (metadataOnly) {
    return {
      document: state.document,
      gpuSnapshots: new Map(),
      layerPixelData: new Map(),
      layerCropInfo: new Map(),
      sparseLayerData: new Map(),
      label,
      metadataOnly: true,
    };
  }

  // For the opposite stack, all layers are "dirty" since we need a full snapshot
  const allDirty = new Set(state.document.layerOrder);
  const gpuSnapshots = snapshotGpuLayers(state.document.layerOrder, allDirty, prevSnapshot);

  return {
    document: state.document,
    gpuSnapshots,
    layerPixelData: new Map(),
    layerCropInfo: new Map(),
    sparseLayerData: new Map(),
    label,
    metadataOnly: false,
  };
}

export const createHistorySlice: SliceCreator<HistorySlice> = (set, get) => ({
  undoStack: [],
  redoStack: [],
  isDirty: false,

  undo: () => {
    // Finalize any deferred GPU stroke so the snapshot captures it
    finalizePendingStrokeGlobal();

    const state = get();
    if (state.undoStack.length === 0) return;
    const previous = state.undoStack[state.undoStack.length - 1];
    if (!previous) return;

    // Save current state to redo — match the snapshot type
    const currentSnapshot = snapshotCurrentState(state, previous.label, previous.metadataOnly, undefined);

    // Restore GPU textures from the snapshot, then reset sync tracking
    // so syncLayers re-pushes all layer positions/dimensions to the engine.
    restoreGpuFromSnapshot(previous);
    resetTrackedState();

    set({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, currentSnapshot],
      document: previous.document,
      // Clear JS pixel data — GPU is source of truth
      layerPixelData: new Map(),
      sparseLayerData: new Map(),
      dirtyLayerIds: new Set(previous.document.layerOrder),
      renderVersion: state.renderVersion + 1,
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const next = state.redoStack[state.redoStack.length - 1];
    if (!next) return;

    const currentSnapshot = snapshotCurrentState(state, next.label, next.metadataOnly, undefined);

    // Restore GPU textures from the snapshot, then reset sync tracking
    restoreGpuFromSnapshot(next);
    resetTrackedState();

    set({
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, currentSnapshot],
      document: next.document,
      // Clear JS pixel data — GPU is source of truth
      layerPixelData: new Map(),
      sparseLayerData: new Map(),
      dirtyLayerIds: new Set(next.document.layerOrder),
      renderVersion: state.renderVersion + 1,
    });
  },

  pushHistory: (label = 'Edit') => {
    const state = get();

    // Flush any pending JS pixel data to the GPU before snapshotting.
    // The GPU is the single source of truth — if JS has data that hasn't
    // been synced yet, the GPU snapshot would capture stale textures.
    flushLayerSync(state);

    const prevSnapshot = state.undoStack[state.undoStack.length - 1];
    const gpuSnapshots = snapshotGpuLayers(state.document.layerOrder, state.dirtyLayerIds, prevSnapshot);

    const snapshot: HistorySnapshot = {
      document: state.document,
      gpuSnapshots,
      layerPixelData: new Map(),
      layerCropInfo: new Map(),
      sparseLayerData: new Map(),
      label,
      metadataOnly: false,
    };
    set({
      undoStack: [...state.undoStack.slice(-49), snapshot],
      redoStack: [],
      dirtyLayerIds: new Set(),
      isDirty: true,
    });
  },

  markClean: () => {
    set({ isDirty: false });
  },
});
