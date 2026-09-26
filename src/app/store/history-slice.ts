import type { HistorySnapshot, SelectionData, SliceCreator } from './types';
import type { Layer } from '../../types';
import { EMPTY_HANDLE, restoreLayerGpu, type LayerHistoryBefore } from './layer-gpu-capture';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  endStroke, getLayerTextureDimensions,
  snapshotLayerGpu, releaseGpuSnapshot,
  hasFloat, dropFloat,
} from '../../engine-wasm/wasm-bridge';
import { resetTrackedState, flushLayerSync, syncLayers } from '../../engine-wasm/engine-sync';
import { clearMaskGpuDirty, markAllMasksGpuDirty } from '../../engine-wasm/mask-gpu-dirty';
import { pixelDataManager } from '../../engine/pixel-data-manager';
import { finalizePendingStrokeGlobal } from '../interactions/pending-stroke';
import { cancelPrefloat } from '../interactions/prefloat';
import { snapshotGpuMasks, withCurrentMaskStaleness, restoreMasksAfterUndo } from './mask-history';
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
  /**
   * Snapshot the current state onto the undo stack. `before` substitutes one
   * layer's descriptor and GPU texture with a copy captured earlier — used by
   * operations (text editing) that mutate the layer texture live before the
   * history entry is pushed.
   */
  pushHistory: (label?: string, before?: LayerHistoryBefore) => void;
  pushPrebuiltSnapshot: (snapshot: HistorySnapshot) => void;
  pushHistoryMetadata: (label: string) => void;
  markClean: () => void;
}


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
  before?: LayerHistoryBefore,
): Map<string, number> {
  const engine = getEngine();
  const gpuSnapshots = new Map<string, number>();

  for (const layerId of layerOrder) {
    if (before && before.layer.id === layerId) {
      gpuSnapshots.set(layerId, before.gpuHandle);
      continue;
    }

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

const NO_DIRTY_LAYERS: Set<string> = new Set();

/**
 * GPU handles describing the live document, for the entry undo/redo pushes
 * onto the opposite stack.
 *
 * Right after a restore the live textures are still the restored snapshot's,
 * so its handles are reused — but only per layer, and only where the layer's
 * bounds still match the ones that handle was captured with. The render loop
 * crops / expands layers on an active-layer switch without a history entry
 * (and an undo that changes `activeLayerId` triggers exactly that), so a
 * layer the restore left cropped can be full-document size by now. Pairing
 * its cropped handle with the expanded live bounds made the next undo blit a
 * 200×200 texture into a document-sized layer at (0, 0) (#833). Layers whose
 * bounds moved are re-snapshotted from the live texture instead.
 */
function snapshotLiveLayers(
  state: { document: { layers: readonly Layer[]; layerOrder: readonly string[] }; dirtyLayerIds: Set<string> },
  stackTop: HistorySnapshot | undefined,
): Map<string, number> {
  const { layers, layerOrder } = state.document;
  if (lastRestoredSnapshot?.kind === 'pixels') {
    return snapshotGpuLayers(layers, layerOrder, NO_DIRTY_LAYERS, lastRestoredSnapshot);
  }
  return snapshotGpuLayers(layers, layerOrder, state.dirtyLayerIds, stackTop);
}

/**
 * Mask handles for the entry undo/redo pushes onto the opposite stack. Right
 * after a restore the live mask textures are the restored snapshot's, so its
 * handles are reused; otherwise the masks are snapshotted against the stack top.
 */
function liveMaskSnapshots(
  layers: readonly Layer[],
  stackTop: HistorySnapshot | undefined,
): ReturnType<typeof snapshotGpuMasks> {
  if (lastRestoredSnapshot?.kind === 'pixels') {
    return withCurrentMaskStaleness(lastRestoredSnapshot.maskSnapshots);
  }
  return snapshotGpuMasks(layers, stackTop);
}

function restoreGpuFromSnapshot(snapshot: HistorySnapshot): void {
  if (snapshot.kind === 'metadata') return;

  for (const [layerId, handle] of snapshot.gpuSnapshots) {
    restoreLayerGpu(layerId, handle);
  }
}

/**
 * The transform-handle overlay (`uiStore.transform`) is a separate store
 * from the undo/redo stack, so restoring a snapshot's `selection` here
 * doesn't touch it. Left alone, the handle box (and its `originalBounds`
 * pivot) stays at wherever a Move/Transform gesture last drew it — even
 * after undo/redo has moved the real selection and pixels elsewhere (#871).
 * Only resync a transform that's already showing; this never conjures one
 * for a selection nothing was transforming.
 */
function syncTransformAfterHistoryRestore(selection: SelectionData): void {
  const uiState = useUIStore.getState();
  if (!uiState.transform) return;
  if (selection.active) {
    uiState.setTransform(createTransformState(selection.bounds, uiState.transform.mode));
  } else {
    uiState.setTransform(null);
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
    } else {
      const gpuSnapshots = snapshotLiveLayers(state, state.undoStack[S - 1]);
      firstSnapshot = {
        kind: 'pixels',
        document: state.document,
        selection: state.selection,
        gpuSnapshots,
        maskSnapshots: liveMaskSnapshots(state.document.layers, state.undoStack[S - 1]),
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
    // Keep mask/selection content refs across the reset (#781): mask
    // textures are restored from GPU snapshots below or untouched, and
    // `mask.data` may lag them, so it must not be re-uploaded (#780).
    if (eng) {
      resetTrackedState(eng, { preserveContentRefs: true });
      restoreMasksAfterUndo(eng, target, state.document.layers);
    }
    markAllMasksGpuDirty();

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
    syncTransformAfterHistoryRestore(target.selection);
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
    } else {
      const gpuSnapshots = snapshotLiveLayers(state, state.redoStack[R - 1]);
      firstSnapshot = {
        kind: 'pixels',
        document: state.document,
        selection: state.selection,
        gpuSnapshots,
        maskSnapshots: liveMaskSnapshots(state.document.layers, state.redoStack[R - 1]),
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
    // Keep mask/selection content refs across the reset (#781): mask
    // textures are restored from GPU snapshots below or untouched, and
    // `mask.data` may lag them, so it must not be re-uploaded (#780).
    if (eng) {
      resetTrackedState(eng, { preserveContentRefs: true });
      restoreMasksAfterUndo(eng, target, state.document.layers);
    }
    markAllMasksGpuDirty();

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
    syncTransformAfterHistoryRestore(target.selection);
  },

  pushHistory: (label = 'Edit', before) => {
    // Masks are captured as GPU snapshot handles below, so a mask readback
    // still queued from the previous stroke does not have to be drained
    // first — that synchronous drain stalled every mask stroke start (#780).
    flushPendingSnapshots();
    const state = get();
    lastRestoredSnapshot = null;

    const engine = getEngine();
    if (engine && state.document.activeLayerId) {
      endStroke(engine, state.document.activeLayerId);
    }

    flushLayerSync(state);

    const prevSnapshot = state.undoStack[state.undoStack.length - 1];
    const gpuSnapshots = snapshotGpuLayers(
      state.document.layers, state.document.layerOrder, state.dirtyLayerIds, prevSnapshot, before,
    );
    const document = before
      ? {
        ...state.document,
        layers: state.document.layers.map((l) => (l.id === before.layer.id ? before.layer : l)),
      }
      : state.document;
    const maskSnapshots = snapshotGpuMasks(state.document.layers, prevSnapshot);
    clearMaskGpuDirty();

    const snapshot: HistorySnapshot = {
      kind: 'pixels',
      document,
      selection: state.selection,
      gpuSnapshots,
      maskSnapshots,
      label,
      paths: state.paths,
      selectedPathId: state.selectedPathId,
    };
    set({
      undoStack: [...state.undoStack.slice(-49), snapshot],
      redoStack: [],
      // The substituted layer's live texture differs from the pushed one, so
      // keep it dirty: the next snapshot (e.g. undo's redo entry) must copy
      // the live texture instead of reusing the "before" handle.
      dirtyLayerIds: before ? new Set([before.layer.id]) : new Set(),
      isDirty: true,
      renderVersion: state.renderVersion + 1,
    });
  },

  pushPrebuiltSnapshot: (snapshot: HistorySnapshot) => {
    const state = get();
    lastRestoredSnapshot = null;
    // A prebuilt snapshot was captured at some earlier moment, so masks
    // written since then must not be matched against its handles.
    markAllMasksGpuDirty();
    set({
      undoStack: [...state.undoStack.slice(-49), snapshot],
      redoStack: [],
      dirtyLayerIds: new Set(),
      isDirty: true,
      renderVersion: state.renderVersion + 1,
    });
  },

  pushHistoryMetadata: (label: string) => {
    // No mask drain here (#782 used to force one): a metadata snapshot
    // taken inside the lazy-readback window may carry a lagging
    // `mask.data`, but undoing it keeps the live GPU mask and only
    // refreshes the JS copy (`restoreMasksAfterUndo`), so the lagging
    // bytes are never uploaded over the stroke (#780).
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
