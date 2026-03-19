import { cloneImageData, cropToContentBounds } from '../../engine/canvas-ops';
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
 * Snapshot pixel data for undo. Dirty layers are cropped to content bounds.
 * Non-dirty layers share references with the previous snapshot (zero-copy).
 * Sparse layers are stored directly (no expansion).
 */
function snapshotPixelData(
  current: Map<string, ImageData>,
  sparseMap: Map<string, SparseLayerEntry>,
  dirtyIds: Set<string>,
  previous: HistorySnapshot | undefined,
): { pixelData: Map<string, ImageData>; cropInfo: Map<string, CropInfo>; sparseData: Map<string, SparseLayerEntry> } {
  const pixelData = new Map<string, ImageData>();
  const cropInfo = new Map<string, CropInfo>();
  const sparseData = new Map<string, SparseLayerEntry>();

  for (const [id, data] of current) {
    if (dirtyIds.has(id) || !previous?.layerPixelData.has(id)) {
      const crop = cropToContentBounds(data);
      if (!crop) continue;
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

  for (const [id, entry] of sparseMap) {
    if (pixelData.has(id)) continue;
    if (!dirtyIds.has(id) && previous?.sparseLayerData.has(id)) {
      sparseData.set(id, previous.sparseLayerData.get(id)!);
    } else {
      sparseData.set(id, entry);
    }
  }

  return { pixelData, cropInfo, sparseData };
}

/**
 * Restore from a snapshot. For metadata-only snapshots, only the document
 * is restored — pixel data is left unchanged (it wasn't modified).
 * For pixel snapshots, dense layers are cloned, sparse returned as-is,
 * and layer positions adjusted using cropInfo.
 */
function restoreFromSnapshot(
  snapshot: HistorySnapshot,
  currentPixelData: Map<string, ImageData>,
  currentSparseData: Map<string, SparseLayerEntry>,
): { pixelData: Map<string, ImageData>; sparseData: Map<string, SparseLayerEntry>; document: HistorySnapshot['document'] } {
  // Metadata-only: keep current pixel data, just restore document
  if (snapshot.metadataOnly) {
    return {
      pixelData: currentPixelData,
      sparseData: currentSparseData,
      document: snapshot.document,
    };
  }

  const pixelData = new Map<string, ImageData>();
  for (const [id, data] of snapshot.layerPixelData) {
    pixelData.set(id, cloneImageData(data));
  }
  const sparseData = new Map<string, SparseLayerEntry>(snapshot.sparseLayerData);

  // Apply cropInfo to layer positions — the snapshot's document may have
  // position (0,0) from expansion, but the data is cropped.
  let doc = snapshot.document;
  if (snapshot.layerCropInfo.size > 0) {
    const adjustedLayers = doc.layers.map((layer) => {
      const info = snapshot.layerCropInfo.get(layer.id);
      if (!info) return layer;
      const data = pixelData.get(layer.id);
      if (!data) return layer;
      if (layer.x === 0 && layer.y === 0 && info.fullWidth > 0 &&
          (data.width < info.fullWidth || data.height < info.fullHeight)) {
        return { ...layer, x: info.x, y: info.y, width: data.width, height: data.height } as typeof layer;
      }
      return layer;
    });
    doc = { ...doc, layers: adjustedLayers };
  }

  return { pixelData, sparseData, document: doc };
}

/**
 * Snapshot the current live state for the undo/redo opposite stack.
 * Metadata-only snapshots skip pixel data entirely.
 */
function snapshotCurrentState(
  state: {
    document: HistorySnapshot['document'];
    layerPixelData: Map<string, ImageData>;
    sparseLayerData: Map<string, SparseLayerEntry>;
  },
  label: string,
  metadataOnly: boolean,
): HistorySnapshot {
  if (metadataOnly) {
    return {
      document: state.document,
      layerPixelData: new Map(),
      layerCropInfo: new Map(),
      sparseLayerData: new Map(),
      label,
      metadataOnly: true,
    };
  }

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
  const sparseData = new Map<string, SparseLayerEntry>(state.sparseLayerData);
  return { document: state.document, layerPixelData: pixelData, layerCropInfo: cropInfo, sparseLayerData: sparseData, label, metadataOnly: false };
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
    // Save current state to redo — match the snapshot type (metadata-only or full)
    const currentSnapshot = snapshotCurrentState(state, previous.label, previous.metadataOnly);
    const restored = restoreFromSnapshot(previous, state.layerPixelData, state.sparseLayerData);
    set({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, currentSnapshot],
      document: restored.document,
      layerPixelData: restored.pixelData,
      sparseLayerData: restored.sparseData,
      dirtyLayerIds: new Set(previous.document.layerOrder),
      renderVersion: state.renderVersion + 1,
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const next = state.redoStack[state.redoStack.length - 1];
    if (!next) return;
    const currentSnapshot = snapshotCurrentState(state, next.label, next.metadataOnly);
    const restored = restoreFromSnapshot(next, state.layerPixelData, state.sparseLayerData);
    set({
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, currentSnapshot],
      document: restored.document,
      layerPixelData: restored.pixelData,
      sparseLayerData: restored.sparseData,
      dirtyLayerIds: new Set(next.document.layerOrder),
      renderVersion: state.renderVersion + 1,
    });
  },

  pushHistory: (label = 'Edit') => {
    const state = get();
    // snapshotPixelData shares references for non-dirty layers (zero-copy).
    // When no layers are dirty (metadata-only changes like effects/opacity),
    // ALL layers share references — no new pixel data is allocated.
    const prevSnapshot = state.undoStack[state.undoStack.length - 1];
    const { pixelData, cropInfo, sparseData } = snapshotPixelData(state.layerPixelData, state.sparseLayerData, state.dirtyLayerIds, prevSnapshot);
    // Always include pixel data — reference sharing makes non-dirty layers free.
    // metadataOnly is only set explicitly by callers that know no pixels will change.
    const metadataOnly = false;
    const snapshot: HistorySnapshot = {
      document: state.document,
      layerPixelData: pixelData,
      layerCropInfo: cropInfo,
      sparseLayerData: sparseData,
      label,
      metadataOnly,
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
