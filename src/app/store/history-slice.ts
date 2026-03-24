import type { HistorySnapshot, SliceCreator, SparseLayerEntry } from './types';
import { getEngine } from '../../engine-wasm/engine-state';
import { getLayerTextureDimensions, uploadLayerPixels } from '../../engine-wasm/wasm-bridge';
import { readLayerCompressed, uploadCompressed } from '../../engine-wasm/gpu-pixel-access';
import { resetTrackedState } from '../../engine-wasm/engine-sync';

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
 * Snapshot layer pixel data as cropped blobs.
 * Reads from JS pixel data or sparse data first (most current),
 * falls back to GPU readback for GPU-only layers (brush/gradient/shape).
 * Non-dirty layers share blob references from the previous snapshot (zero-copy).
 */
function snapshotGpuLayers(
  layerOrder: readonly string[],
  dirtyIds: Set<string>,
  previous: HistorySnapshot | undefined,
  pixelData?: Map<string, ImageData>,
  sparseData?: Map<string, SparseLayerEntry>,
  layers?: readonly { id: string; x: number; y: number }[],
): Map<string, Uint8Array> {
  const engine = getEngine();
  const gpuSnapshots = new Map<string, Uint8Array>();

  for (const layerId of layerOrder) {
    // Reuse previous snapshot blob for non-dirty layers
    if (!dirtyIds.has(layerId) && previous?.gpuSnapshots.has(layerId)) {
      gpuSnapshots.set(layerId, previous.gpuSnapshots.get(layerId)!);
      continue;
    }

    // Try JS pixel data first — it may be more current than the GPU
    // (syncLayers uploads to GPU asynchronously in the rAF loop)
    const jsData = pixelData?.get(layerId);
    if (jsData) {
      const blob = snapshotFromImageData(jsData, layerId, layers);
      if (blob) { gpuSnapshots.set(layerId, blob); continue; }
    }

    // Try sparse data
    const sparse = sparseData?.get(layerId);
    if (sparse) {
      const blob = snapshotFromSparse(sparse);
      if (blob) { gpuSnapshots.set(layerId, blob); continue; }
    }

    // Fall back to GPU readback (for GPU-only layers)
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

/** Build a snapshot blob from JS ImageData (crop to content, add header). */
function snapshotFromImageData(
  data: ImageData,
  layerId: string,
  layers?: readonly { id: string; x: number; y: number }[],
): Uint8Array | null {
  const layer = layers?.find(l => l.id === layerId);
  const offsetX = layer?.x ?? 0;
  const offsetY = layer?.y ?? 0;

  // Find content bounds
  let minX = data.width, minY = data.height, maxX = -1, maxY = -1;
  for (let y = 0; y < data.height; y++) {
    for (let x = 0; x < data.width; x++) {
      if (data.data[(y * data.width + x) * 4 + 3]! > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // empty

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const cropped = new Uint8Array(cropW * cropH * 4);
  for (let y = 0; y < cropH; y++) {
    const srcStart = ((minY + y) * data.width + minX) * 4;
    const dstStart = y * cropW * 4;
    cropped.set(data.data.subarray(srcStart, srcStart + cropW * 4), dstStart);
  }

  // Build blob: 16-byte header + pixel data
  const header = new ArrayBuffer(16);
  const view = new DataView(header);
  view.setInt32(0, offsetX + minX, true);
  view.setInt32(4, offsetY + minY, true);
  view.setInt32(8, cropW, true);
  view.setInt32(12, cropH, true);

  const result = new Uint8Array(16 + cropped.length);
  result.set(new Uint8Array(header), 0);
  result.set(cropped, 16);
  return result;
}

/** Build a snapshot blob from sparse layer data. */
function snapshotFromSparse(entry: SparseLayerEntry): Uint8Array | null {
  const { sparse, offsetX, offsetY } = entry;
  const w = sparse.width;
  const h = sparse.height;
  if (w === 0 || h === 0) return null;

  // Reconstruct dense pixel data from sparse indices + rgba
  const pixels = new Uint8Array(w * h * 4);
  const indices = sparse.indices;
  const rgba = sparse.rgba;
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i]!;
    const px = idx * 4;
    const sx = i * 4;
    pixels[px] = rgba[sx]!;
    pixels[px + 1] = rgba[sx + 1]!;
    pixels[px + 2] = rgba[sx + 2]!;
    pixels[px + 3] = rgba[sx + 3]!;
  }

  // Build blob: 16-byte header + pixel data
  const header = new ArrayBuffer(16);
  const view = new DataView(header);
  view.setInt32(0, offsetX, true);
  view.setInt32(4, offsetY, true);
  view.setInt32(8, w, true);
  view.setInt32(12, h, true);

  const result = new Uint8Array(16 + pixels.length);
  result.set(new Uint8Array(header), 0);
  result.set(pixels, 16);
  return result;
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
    layerPixelData: Map<string, ImageData>;
    sparseLayerData: Map<string, SparseLayerEntry>;
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
  const gpuSnapshots = snapshotGpuLayers(
    state.document.layerOrder, allDirty, prevSnapshot,
    state.layerPixelData, state.sparseLayerData, state.document.layers,
  );

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
    const prevSnapshot = state.undoStack[state.undoStack.length - 1];
    const gpuSnapshots = snapshotGpuLayers(
      state.document.layerOrder, state.dirtyLayerIds, prevSnapshot,
      state.layerPixelData, state.sparseLayerData, state.document.layers,
    );

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
