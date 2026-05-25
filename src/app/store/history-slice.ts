import type { HistorySnapshot, SliceCreator } from './types';
import type { Layer } from '../../types';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  endStroke, getLayerTextureDimensions, uploadLayerPixels,
  snapshotLayerGpu, restoreFromGpuSnapshot, releaseGpuSnapshot,
} from '../../engine-wasm/wasm-bridge';
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
  pushPrebuiltSnapshot: (snapshot: HistorySnapshot) => void;
  pushHistoryMetadata: (label: string) => void;
  markClean: () => void;
}

const EMPTY_HANDLE = 0xFFFFFFFF;

let lastRestoredSnapshot: HistorySnapshot | null = null;

// Pre-cached GPU snapshot handles for layers modified at pointer-up.
const preSnapshotCache = new Map<string, number>();
const pendingCacheIds = new Set<string>();

export function cacheLayerSnapshot(layerId: string): void {
  pendingCacheIds.delete(layerId);
  const engine = getEngine();
  if (!engine) return;
  const handle = snapshotLayerGpu(engine, layerId);
  if (handle !== EMPTY_HANDLE) {
    preSnapshotCache.set(layerId, handle);
  }
}

export function deferCacheLayerSnapshot(layerId: string): void {
  pendingCacheIds.add(layerId);
  setTimeout(() => {
    if (pendingCacheIds.has(layerId)) {
      cacheLayerSnapshot(layerId);
    }
  }, 0);
}

function flushPendingSnapshots(): void {
  for (const id of pendingCacheIds) {
    cacheLayerSnapshot(id);
  }
}

export function clearSnapshotCache(): void {
  const engine = getEngine();
  if (engine) {
    for (const handle of preSnapshotCache.values()) {
      releaseGpuSnapshot(engine, handle);
    }
  }
  preSnapshotCache.clear();
  pendingCacheIds.clear();
}

/**
 * Snapshot GPU textures via GPU blit (~1ms per layer).
 * No readback, no compression — just duplicate the texture on the GPU.
 */
function snapshotGpuLayers(
  layers: readonly Layer[],
  layerOrder: readonly string[],
  dirtyIds: Set<string>,
  previous: HistorySnapshot | undefined,
): Map<string, number> {
  const engine = getEngine();
  const gpuSnapshots = new Map<string, number>();

  for (const layerId of layerOrder) {
    // Reuse previous handle when the layer hasn't changed.
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

    // Use pre-cached handle from pointer-up if available.
    const cached = preSnapshotCache.get(layerId);
    if (cached !== undefined) {
      gpuSnapshots.set(layerId, cached);
      preSnapshotCache.delete(layerId);
      continue;
    }

    if (!engine) {
      gpuSnapshots.set(layerId, EMPTY_HANDLE);
      continue;
    }

    const dims = getLayerTextureDimensions(engine, layerId);
    if (!dims || dims[0] === 0 || dims[1] === 0) {
      gpuSnapshots.set(layerId, EMPTY_HANDLE);
      continue;
    }

    const handle = snapshotLayerGpu(engine, layerId);
    gpuSnapshots.set(layerId, handle);
  }

  return gpuSnapshots;
}

function restoreGpuFromSnapshot(snapshot: HistorySnapshot): void {
  if (snapshot.kind === 'metadata') return;

  const engine = getEngine();
  if (!engine) return;

  for (const [layerId, handle] of snapshot.gpuSnapshots) {
    if (handle === EMPTY_HANDLE) {
      uploadLayerPixels(engine, layerId, new Uint8Array(4), 1, 1, 0, 0);
    } else {
      restoreFromGpuSnapshot(engine, layerId, handle);
    }
  }
}

export const createHistorySlice: SliceCreator<HistorySlice> = (set, get) => ({
  undoStack: [],
  redoStack: [],
  isDirty: false,

  undo: () => {
    finalizePendingStrokeGlobal();
    flushPendingSnapshots();

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
    if (eng) {
      const restored = get();
      syncLayers(eng, restored.document.layers, restored.document.layerOrder, restored.dirtyLayerIds);
    }
  },

  redo: () => {
    flushPendingSnapshots();
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
    flushPendingSnapshots();
    const state = get();
    lastRestoredSnapshot = null;

    const engine = getEngine();
    if (engine && state.document.activeLayerId) {
      endStroke(engine, state.document.activeLayerId);
    }

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

  pushPrebuiltSnapshot: (snapshot: HistorySnapshot) => {
    const state = get();
    lastRestoredSnapshot = null;
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
