import type { HistorySnapshot, SelectionData, SliceCreator } from './types';
import type { Layer } from '../../types';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  endStroke, getLayerTextureDimensions, uploadLayerPixels,
  snapshotLayerGpu, restoreFromGpuSnapshot, releaseGpuSnapshot,
  hasFloat, dropFloat,
} from '../../engine-wasm/wasm-bridge';
import { resetTrackedState, flushLayerSync, syncLayers } from '../../engine-wasm/engine-sync';
import { pixelDataManager } from '../../engine/pixel-data-manager';
import { finalizePendingStrokeGlobal } from '../interactions/pending-stroke';
import { cancelPrefloat } from '../interactions/prefloat';
import { flushAllPendingMaskReads } from '../mask-read-queue';
import { useUIStore } from '../ui-store';
import { createTransformState } from '../../tools/transform/transform';

export interface HistorySlice {
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
  isDirty: boolean;
  undo: () => void;
  redo: () => void;
  /**
   * Batched undo: pop `n` snapshots off `undoStack`, restore the target
   * state in a single GPU restore + tracked-state reset + syncLayers pass.
   * A held Cmd+Z and a History-panel jump both use this — each intermediate
   * step is skipped so masks and selection are re-uploaded once instead of
   * once per step (#761).
   */
  undoBy: (steps: number) => void;
  /** Batched redo — see `undoBy`. */
  redoBy: (steps: number) => void;
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

export function invalidateCachedSnapshot(layerId: string): void {
  pendingCacheIds.delete(layerId);
  const handle = preSnapshotCache.get(layerId);
  if (handle !== undefined) {
    const engine = getEngine();
    if (engine) releaseGpuSnapshot(engine, handle);
    preSnapshotCache.delete(layerId);
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

/**
 * Undo/redo restore the document and selection in `useEditorStore`, but the
 * Move tool's transform-handle box lives in `useUIStore` and is only ever
 * re-seeded by the interaction handlers that produce a selection (marquee
 * commit, `selectLayerAlpha`, a Move drag's pointer-up, …) — undo/redo never
 * called any of those, so the box was left pointing at whatever position the
 * last live drag put it at. Stepping back through a chain of "Move" entries
 * therefore restored the marquee correctly every time but left its
 * transform-handle box frozen at the newest position until the selection
 * itself was undone away entirely (#925). Re-seed a fresh identity transform
 * from the restored selection's bounds on every step so the handles track
 * the marquee exactly like a fresh selection would.
 */
function resyncTransformToSelection(selection: SelectionData): void {
  const uiState = useUIStore.getState();
  if (selection.active && selection.bounds) {
    uiState.setTransform(createTransformState(selection.bounds));
  } else if (uiState.transform) {
    uiState.setTransform(null);
  }
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
    get().undoBy(1);
  },

  redo: () => {
    get().redoBy(1);
  },

  undoBy: (steps: number) => {
    if (steps <= 0) return;
    finalizePendingStrokeGlobal();
    // Drop any active float (and cancel a scheduled prefloat) before
    // restoring. A leftover float leaves `float_layer_id` set on the engine,
    // which makes `update_layer` preserve the float's expanded x/y/w/h in the
    // layer descriptor. After a restore that shrinks the layer texture back to
    // its pre-float dimensions, the mismatched descriptor renders the layer
    // stretched at (0, 0, doc.w, doc.h) instead of at its original position
    // (issue #706).
    cancelPrefloat();
    const eng0 = getEngine();
    if (eng0 && hasFloat(eng0)) dropFloat(eng0);
    flushPendingSnapshots();

    const state = get();
    const S = state.undoStack.length;
    if (S === 0) return;
    const n = Math.min(steps, S);
    const target = state.undoStack[S - n];
    if (!target) return;

    // Build the additions to push onto redoStack — one entry per undone
    // step, in the order they'd have been pushed by n consecutive undo()
    // calls. The first is a fresh snapshot of the current live state; each
    // subsequent one is the undoStack entry immediately below it, which by
    // construction has both the document AND the gpuSnapshots for the
    // intermediate state that undo() would have paused at (#761).
    const additions: HistorySnapshot[] = [];
    let firstSnapshot: HistorySnapshot;
    if (target.kind === 'metadata') {
      firstSnapshot = {
        kind: 'metadata',
        document: state.document,
        selection: state.selection,
        label: target.label,
        paths: state.paths,
        selectedPathId: state.selectedPathId,
      };
    } else if (lastRestoredSnapshot && lastRestoredSnapshot.kind === 'pixels') {
      firstSnapshot = {
        kind: 'pixels',
        document: state.document,
        selection: state.selection,
        gpuSnapshots: lastRestoredSnapshot.gpuSnapshots,
        label: target.label,
        paths: state.paths,
        selectedPathId: state.selectedPathId,
      };
    } else {
      const gpuSnapshots = snapshotGpuLayers(
        state.document.layers,
        state.document.layerOrder,
        state.dirtyLayerIds,
        state.undoStack[S - 1],
      );
      firstSnapshot = {
        kind: 'pixels',
        document: state.document,
        selection: state.selection,
        gpuSnapshots,
        label: target.label,
        paths: state.paths,
        selectedPathId: state.selectedPathId,
      };
    }
    additions.push(firstSnapshot);
    for (let i = S - 1; i > S - n; i--) {
      const step = state.undoStack[i];
      if (step) additions.push(step);
    }

    restoreGpuFromSnapshot(target);
    lastRestoredSnapshot = target;
    const eng = getEngine();
    if (eng) resetTrackedState(eng);

    pixelDataManager.clearAll();
    set({
      undoStack: state.undoStack.slice(0, S - n),
      redoStack: [...state.redoStack, ...additions],
      document: target.document,
      selection: target.selection,
      paths: [...target.paths],
      selectedPathId: target.selectedPathId,
      dirtyLayerIds: new Set(target.document.layerOrder),
      renderVersion: state.renderVersion + 1,
    });
    resyncTransformToSelection(target.selection);
    if (eng) {
      const restored = get();
      syncLayers(eng, restored.document.layers, restored.document.layerOrder, restored.dirtyLayerIds);
    }
  },

  redoBy: (steps: number) => {
    if (steps <= 0) return;
    // Same reasoning as undo: a stale float would preserve expanded dims in
    // the engine's layer descriptor and misplace the restored texture.
    cancelPrefloat();
    const eng0 = getEngine();
    if (eng0 && hasFloat(eng0)) dropFloat(eng0);
    flushPendingSnapshots();
    const state = get();
    const R = state.redoStack.length;
    if (R === 0) return;
    const n = Math.min(steps, R);
    const target = state.redoStack[R - n];
    if (!target) return;

    // Build additions to push onto undoStack, in the order n consecutive
    // redo() calls would have. First is a fresh snapshot of the current
    // live state; each subsequent one is the redoStack entry immediately
    // above it — same reuse trick as undoBy (#761).
    const additions: HistorySnapshot[] = [];
    let firstSnapshot: HistorySnapshot;
    if (target.kind === 'metadata') {
      firstSnapshot = {
        kind: 'metadata',
        document: state.document,
        selection: state.selection,
        label: target.label,
        paths: state.paths,
        selectedPathId: state.selectedPathId,
      };
    } else if (lastRestoredSnapshot && lastRestoredSnapshot.kind === 'pixels') {
      firstSnapshot = {
        kind: 'pixels',
        document: state.document,
        selection: state.selection,
        gpuSnapshots: lastRestoredSnapshot.gpuSnapshots,
        label: target.label,
        paths: state.paths,
        selectedPathId: state.selectedPathId,
      };
    } else {
      const gpuSnapshots = snapshotGpuLayers(
        state.document.layers,
        state.document.layerOrder,
        state.dirtyLayerIds,
        state.redoStack[R - 1],
      );
      firstSnapshot = {
        kind: 'pixels',
        document: state.document,
        selection: state.selection,
        gpuSnapshots,
        label: target.label,
        paths: state.paths,
        selectedPathId: state.selectedPathId,
      };
    }
    additions.push(firstSnapshot);
    for (let i = R - 1; i > R - n; i--) {
      const step = state.redoStack[i];
      if (step) additions.push(step);
    }

    restoreGpuFromSnapshot(target);
    lastRestoredSnapshot = target;
    const eng = getEngine();
    if (eng) resetTrackedState(eng);

    pixelDataManager.clearAll();
    set({
      redoStack: state.redoStack.slice(0, R - n),
      undoStack: [...state.undoStack, ...additions],
      document: target.document,
      selection: target.selection,
      paths: [...target.paths],
      selectedPathId: target.selectedPathId,
      dirtyLayerIds: new Set(target.document.layerOrder),
      renderVersion: state.renderVersion + 1,
    });
    resyncTransformToSelection(target.selection);
    if (eng) {
      const restored = get();
      syncLayers(eng, restored.document.layers, restored.document.layerOrder, restored.dirtyLayerIds);
    }
  },

  pushHistory: (label = 'Edit') => {
    // #756: mask readbacks are deferred to idle. Ensure any pending read
    // has settled so this snapshot captures the current mask data, not
    // the pre-stroke state.
    flushAllPendingMaskReads();
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
      selection: state.selection,
      gpuSnapshots,
      label,
      paths: state.paths,
      selectedPathId: state.selectedPathId,
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
      selection: state.selection,
      label,
      paths: state.paths,
      selectedPathId: state.selectedPathId,
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
