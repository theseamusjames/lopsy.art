import type { HistorySnapshot, SliceCreator } from './types';
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
 * When restoring a metadata-only snapshot, take each layer's position and
 * size fields (x, y, width, height) from the CURRENT document rather than
 * the snapshot. This prevents an undo of a blend-mode / opacity / effects
 * edit from also reverting side-effect position changes made by
 * `transitionActiveLayer` (which crops the previously-active layer and
 * expands the newly-active layer on every setActiveLayer). Without this,
 * undoing a metadata edit made while the layer was in a different
 * expand/crop state teleports its content by exactly its own (x, y) —
 * (2x, 2y) after a second undo, (0, 0) after a redo (#783). Everything
 * else in the snapshot (blend mode, opacity, effects, mask, adjustments,
 * order, active layer, etc.) is restored as-is.
 */
function mergeMetadataLayerPositions(
  snapshot: import('../../types').DocumentState,
  current: import('../../types').DocumentState,
): import('../../types').DocumentState {
  const curById = new Map(current.layers.map((l) => [l.id, l]));
  const layers = snapshot.layers.map((snapLayer) => {
    const cur = curById.get(snapLayer.id);
    if (!cur) return snapLayer;
    if (cur.x === snapLayer.x && cur.y === snapLayer.y) {
      const snapW = 'width' in snapLayer ? (snapLayer as { width?: number | null }).width : undefined;
      const snapH = 'height' in snapLayer ? (snapLayer as { height?: number | null }).height : undefined;
      const curW = 'width' in cur ? (cur as { width?: number | null }).width : undefined;
      const curH = 'height' in cur ? (cur as { height?: number | null }).height : undefined;
      if (snapW === curW && snapH === curH) return snapLayer;
    }
    const patched: Record<string, unknown> = {
      ...(snapLayer as unknown as Record<string, unknown>),
      x: cur.x,
      y: cur.y,
    };
    if ('width' in cur && 'width' in snapLayer) {
      patched.width = (cur as unknown as { width?: number | null }).width;
    }
    if ('height' in cur && 'height' in snapLayer) {
      patched.height = (cur as unknown as { height?: number | null }).height;
    }
    return patched as unknown as typeof snapLayer;
  });
  return { ...snapshot, layers };
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
    // Preserve mask/selection content refs across the reset so an undo
    // that never touched a layer's mask doesn't re-upload the whole mask
    // (16.78 MB per masked layer at 4K, #781). Refs that DO differ from
    // the restored `mask.data` still fail the syncLayers gate and re-upload.
    if (eng) resetTrackedState(eng, { preserveContentRefs: true });

    pixelDataManager.clearAll();
    const restoredDocument = target.kind === 'metadata'
      ? mergeMetadataLayerPositions(target.document, state.document)
      : target.document;
    set({
      undoStack: state.undoStack.slice(0, S - n),
      redoStack: [...state.redoStack, ...additions],
      document: restoredDocument,
      selection: target.selection,
      paths: [...target.paths],
      selectedPathId: target.selectedPathId,
      dirtyLayerIds: new Set(restoredDocument.layerOrder),
      renderVersion: state.renderVersion + 1,
    });
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
    // Same as undoBy — preserve mask/selection refs across the reset
    // (#781).
    if (eng) resetTrackedState(eng, { preserveContentRefs: true });

    pixelDataManager.clearAll();
    const restoredDocument = target.kind === 'metadata'
      ? mergeMetadataLayerPositions(target.document, state.document)
      : target.document;
    set({
      redoStack: state.redoStack.slice(0, R - n),
      undoStack: [...state.undoStack, ...additions],
      document: restoredDocument,
      selection: target.selection,
      paths: [...target.paths],
      selectedPathId: target.selectedPathId,
      dirtyLayerIds: new Set(restoredDocument.layerOrder),
      renderVersion: state.renderVersion + 1,
    });
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
    // #782: mask readbacks are deferred to idle. If a metadata step
    // (visibility toggle, add layer, reorder …) runs within the wait
    // window after a mask stroke, this snapshot would capture the
    // stale pre-stroke mask array. Undoing the metadata entry would
    // then restore that stale mask over the current GPU texture,
    // erasing the stroke. Drain pending reads first, matching
    // pushHistory().
    flushAllPendingMaskReads();
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
