import { cloneImageData, cropToContentBounds, sparseToImageData } from '../../engine/canvas-ops';
import type { CropInfo, HistorySnapshot, SliceCreator, SparseLayerEntry } from './types';

export interface HistorySlice {
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
  isDirty: boolean;
  undo: () => void;
  redo: () => void;
  pushHistory: (label?: string) => void;
  markClean: () => void;
}

/**
 * Clone pixel data map for a history snapshot.
 * Dirty layers are cropped to content bounds to minimize memory.
 * Unchanged layers share references with the previous snapshot.
 * Fully empty layers are omitted entirely.
 */
function snapshotPixelData(
  current: Map<string, ImageData>,
  sparseMap: Map<string, SparseLayerEntry>,
  dirtyIds: Set<string>,
  previous: HistorySnapshot | undefined,
): { pixelData: Map<string, ImageData>; cropInfo: Map<string, CropInfo> } {
  const pixelData = new Map<string, ImageData>();
  const cropInfo = new Map<string, CropInfo>();

  for (const [id, data] of current) {
    if (dirtyIds.has(id) || !previous?.layerPixelData.has(id)) {
      const crop = cropToContentBounds(data);
      if (!crop) continue; // fully empty — skip
      pixelData.set(id, crop.data);
      if (crop.x !== 0 || crop.y !== 0 || crop.data.width !== data.width || crop.data.height !== data.height) {
        cropInfo.set(id, { x: crop.x, y: crop.y, fullWidth: data.width, fullHeight: data.height });
      }
    } else {
      pixelData.set(id, previous.layerPixelData.get(id)!);
      const prevCrop = previous.layerCropInfo.get(id);
      if (prevCrop) cropInfo.set(id, prevCrop);
    }
  }

  // Include sparse layers — convert to compact ImageData for the snapshot
  for (const [id, entry] of sparseMap) {
    if (pixelData.has(id)) continue; // already handled above
    if (!dirtyIds.has(id) && previous?.layerPixelData.has(id)) {
      pixelData.set(id, previous.layerPixelData.get(id)!);
      const prevCrop = previous.layerCropInfo.get(id);
      if (prevCrop) cropInfo.set(id, prevCrop);
    } else {
      const data = sparseToImageData(entry.sparse);
      pixelData.set(id, data);
      cropInfo.set(id, { x: entry.offsetX, y: entry.offsetY, fullWidth: entry.sparse.width, fullHeight: entry.sparse.height });
    }
  }

  return { pixelData, cropInfo };
}

/**
 * Restore pixel data from a snapshot, expanding cropped entries
 * back to full canvas size for live editing.
 */
function restorePixelData(
  snapshot: HistorySnapshot,
): Map<string, ImageData> {
  const restored = new Map<string, ImageData>();
  for (const [id, data] of snapshot.layerPixelData) {
    // Keep data at its cropped dimensions — the document's layer positions
    // already match. Expanding to full canvas would double-offset because
    // the renderer applies layer.x/y again.
    restored.set(id, cloneImageData(data));
  }
  return restored;
}

/**
 * Snapshot the current live state for pushing onto undo/redo.
 * Crops all layers to content bounds.
 */
function snapshotCurrentState(
  state: {
    document: HistorySnapshot['document'];
    layerPixelData: Map<string, ImageData>;
    sparseLayerData: Map<string, SparseLayerEntry>;
  },
  label: string,
): HistorySnapshot {
  const pixelData = new Map<string, ImageData>();
  const cropInfo = new Map<string, CropInfo>();
  for (const [id, data] of state.layerPixelData) {
    const crop = cropToContentBounds(data);
    if (!crop) continue;
    pixelData.set(id, crop.data);
    if (crop.x !== 0 || crop.y !== 0 || crop.data.width !== data.width || crop.data.height !== data.height) {
      cropInfo.set(id, { x: crop.x, y: crop.y, fullWidth: data.width, fullHeight: data.height });
    }
  }
  // Include sparse layers
  for (const [id, entry] of state.sparseLayerData) {
    if (pixelData.has(id)) continue;
    const data = sparseToImageData(entry.sparse);
    pixelData.set(id, data);
    cropInfo.set(id, { x: entry.offsetX, y: entry.offsetY, fullWidth: entry.sparse.width, fullHeight: entry.sparse.height });
  }
  return { document: state.document, layerPixelData: pixelData, layerCropInfo: cropInfo, label };
}

export const createHistorySlice: SliceCreator<HistorySlice> = (set, get) => ({
  undoStack: [],
  redoStack: [],
  isDirty: false,

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;
    const previous = state.undoStack[state.undoStack.length - 1];
    if (!previous) return;
    const currentSnapshot = snapshotCurrentState(state, previous.label);
    set({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, currentSnapshot],
      document: previous.document,
      layerPixelData: restorePixelData(previous),
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
    const currentSnapshot = snapshotCurrentState(state, next.label);
    set({
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, currentSnapshot],
      document: next.document,
      layerPixelData: restorePixelData(next),
      sparseLayerData: new Map(),
      dirtyLayerIds: new Set(next.document.layerOrder),
      renderVersion: state.renderVersion + 1,
    });
  },

  pushHistory: (label = 'Edit') => {
    const state = get();
    const prevSnapshot = state.undoStack[state.undoStack.length - 1];
    const { pixelData, cropInfo } = snapshotPixelData(state.layerPixelData, state.sparseLayerData, state.dirtyLayerIds, prevSnapshot);
    const snapshot: HistorySnapshot = {
      document: state.document,
      layerPixelData: pixelData,
      layerCropInfo: cropInfo,
      label,
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
