// KNOWN TECHNICAL DEBT: pixel data lives in the Zustand store
// (layerPixelData + sparseLayerData Maps below) despite the project's
// GPU-first design principle that says the GPU texture is the source of
// truth. This file's actions orchestrate *all* of: Map bookkeeping, GPU
// upload, dirty-layer tracking, bitmap-cache invalidation, and sparse↔
// dense conversion.
//
// The clean fix is a separate PixelDataManager class holding the Maps
// while the store keeps only the orchestration (dirtyLayerIds +
// renderVersion) and exposes a `resolvePixelData` accessor. That
// refactor needs to touch every caller of getOrCreateLayerPixelData /
// updateLayerPixelData / expandLayerForEditing and coordinate with
// history snapshots — it's not landing in a staff-review PR. Tracked
// for a dedicated follow-up.
import type { Layer } from '../../types';
import type { SliceCreator, SparseLayerEntry } from './types';
import { createImageData } from '../../engine/color-space';
import {
  cropToContentBounds,
  expandFromCrop,
  toSparsePixelData,
  fromSparsePixelData,
  sparseToImageData,
} from '../../engine/canvas-ops';
import { invalidateBitmapCache } from '../../engine/bitmap-cache';
import { readLayerAsImageData } from '../../engine-wasm/gpu-pixel-access';
import { getEngine } from '../../engine-wasm/engine-state';
import { uploadLayerPixels } from '../../engine-wasm/wasm-bridge';

export interface PixelDataSlice {
  layerPixelData: Map<string, ImageData>;
  sparseLayerData: Map<string, SparseLayerEntry>;
  dirtyLayerIds: Set<string>;
  renderVersion: number;
  getOrCreateLayerPixelData: (layerId: string) => ImageData;
  updateLayerPixelData: (layerId: string, data: ImageData) => void;
  notifyRender: () => void;
  cropLayerToContent: (layerId: string) => void;
  expandLayerForEditing: (layerId: string) => ImageData;
  /** Read-only: returns ImageData from GPU, JS cache, or sparse storage.
   *  Returns at the layer's stored dimensions (not full canvas). */
  resolvePixelData: (layerId: string) => ImageData | undefined;
}

export const createPixelDataSlice: SliceCreator<PixelDataSlice> = (set, get) => ({
  layerPixelData: new Map(),
  sparseLayerData: new Map(),
  dirtyLayerIds: new Set(),
  renderVersion: 0,

  getOrCreateLayerPixelData: (layerId: string) => {
    // Always returns a full-canvas-size ImageData, expanding cropped/sparse layers.
    // All callers are write operations (filters, paste, fill, etc.) that need
    // the full canvas area. Read-only code uses resolvePixelData().
    return get().expandLayerForEditing(layerId);
  },

  updateLayerPixelData: (layerId: string, data: ImageData) => {
    const state = get();
    const pixelData = new Map(state.layerPixelData);
    pixelData.set(layerId, data);
    const dirtyLayerIds = new Set(state.dirtyLayerIds);
    dirtyLayerIds.add(layerId);
    // Clear any sparse entry — we have live ImageData now
    const sparseMap = new Map(state.sparseLayerData);
    sparseMap.delete(layerId);
    // Invalidate stale bitmap — the data may have been modified in-place
    invalidateBitmapCache(layerId);

    // Upload to GPU so the engine stays in sync
    const engine = getEngine();
    if (engine) {
      const layer = state.document.layers.find((l) => l.id === layerId);
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;
      const rawBytes = new Uint8Array(data.data.buffer, data.data.byteOffset, data.data.byteLength);
      uploadLayerPixels(engine, layerId, rawBytes, data.width, data.height, lx, ly);
    }

    set({ layerPixelData: pixelData, sparseLayerData: sparseMap, dirtyLayerIds, renderVersion: state.renderVersion + 1 });
    // Auto-crop/sparsify after every write to keep memory tight
    get().cropLayerToContent(layerId);
  },

  notifyRender: () => {
    set((state) => ({ renderVersion: state.renderVersion + 1 }));
  },

  cropLayerToContent: (layerId: string) => {
    const state = get();
    const data = state.layerPixelData.get(layerId);
    if (!data) return;

    const layer = state.document.layers.find((l) => l.id === layerId);
    if (!layer || layer.type !== 'raster') return;

    const crop = cropToContentBounds(data);
    if (!crop) {
      // Fully empty — remove pixel data entirely
      invalidateBitmapCache(layerId);
      const pixelData = new Map(state.layerPixelData);
      pixelData.delete(layerId);
      const sparseMap = new Map(state.sparseLayerData);
      sparseMap.delete(layerId);
      set({
        document: {
          ...state.document,
          layers: state.document.layers.map((l) =>
            l.id === layerId ? { ...l, x: 0, y: 0, width: state.document.width, height: state.document.height } as Layer : l,
          ),
        },
        layerPixelData: pixelData,
        sparseLayerData: sparseMap,
        renderVersion: state.renderVersion + 1,
      });
      return;
    }

    // Try to sparsify the cropped data
    const sparse = toSparsePixelData(crop.data);
    if (sparse) {
      invalidateBitmapCache(layerId);
      const pixelData = new Map(state.layerPixelData);
      pixelData.delete(layerId);
      const sparseMap = new Map(state.sparseLayerData);
      sparseMap.set(layerId, {
        offsetX: layer.x + crop.x,
        offsetY: layer.y + crop.y,
        sparse,
      });
      const dirtyLayerIds = new Set(state.dirtyLayerIds);
      dirtyLayerIds.add(layerId);
      set({
        document: {
          ...state.document,
          layers: state.document.layers.map((l) =>
            l.id === layerId ? { ...l, x: layer.x + crop.x, y: layer.y + crop.y, width: crop.data.width, height: crop.data.height } as Layer : l,
          ),
        },
        layerPixelData: pixelData,
        sparseLayerData: sparseMap,
        dirtyLayerIds,
        renderVersion: state.renderVersion + 1,
      });
      return;
    }

    // Dense content — keep as cropped ImageData
    if (crop.x === 0 && crop.y === 0 && crop.data.width === data.width && crop.data.height === data.height) return;

    const pixelData = new Map(state.layerPixelData);
    pixelData.set(layerId, crop.data);
    const dirtyLayerIds = new Set(state.dirtyLayerIds);
    dirtyLayerIds.add(layerId);
    set({
      document: {
        ...state.document,
        layers: state.document.layers.map((l) =>
          l.id === layerId ? { ...l, x: layer.x + crop.x, y: layer.y + crop.y, width: crop.data.width, height: crop.data.height } as Layer : l,
        ),
      },
      layerPixelData: pixelData,
      dirtyLayerIds,
      renderVersion: state.renderVersion + 1,
    });
  },

  expandLayerForEditing: (layerId: string) => {
    const state = get();
    const layer = state.document.layers.find((l) => l.id === layerId);
    if (!layer || layer.type !== 'raster') {
      const existing = state.layerPixelData.get(layerId);
      if (existing) return existing;
      const imageData = createImageData(state.document.width, state.document.height);
      const pixelData = new Map(state.layerPixelData);
      pixelData.set(layerId, imageData);
      set({ layerPixelData: pixelData });
      return imageData;
    }

    const docW = state.document.width;
    const docH = state.document.height;

    // Helper: compute the union of the canvas area and the content area so
    // that off-canvas content is preserved (non-destructive move).
    const unionBounds = (cx: number, cy: number, cw: number, ch: number) => {
      const minX = Math.min(0, cx);
      const minY = Math.min(0, cy);
      const maxX = Math.max(docW, cx + cw);
      const maxY = Math.max(docH, cy + ch);
      return { minX, minY, bufW: maxX - minX, bufH: maxY - minY };
    };

    // Check for sparse data first
    const sparseEntry = state.sparseLayerData.get(layerId);
    if (sparseEntry) {
      // Use layer.x/y as the authoritative position — sparse offsets may
      // be stale after an updateLayerPosition() call (move tool).
      const { minX, minY, bufW, bufH } = unionBounds(
        layer.x, layer.y,
        sparseEntry.sparse.width, sparseEntry.sparse.height,
      );
      const expanded = fromSparsePixelData(
        sparseEntry.sparse, bufW, bufH,
        layer.x - minX, layer.y - minY,
      );
      const pixelData = new Map(state.layerPixelData);
      pixelData.set(layerId, expanded);
      const sparseMap = new Map(state.sparseLayerData);
      sparseMap.delete(layerId);
      set({
        document: {
          ...state.document,
          layers: state.document.layers.map((l) =>
            l.id === layerId ? { ...l, x: minX, y: minY, width: bufW, height: bufH } as Layer : l,
          ),
        },
        layerPixelData: pixelData,
        sparseLayerData: sparseMap,
      });
      return expanded;
    }

    const existing = state.layerPixelData.get(layerId);

    // Already covers the full canvas and all content is on-canvas
    if (existing && layer.x === 0 && layer.y === 0 && existing.width >= docW && existing.height >= docH) {
      return existing;
    }

    // If no JS data but GPU has data, read from GPU
    if (!existing) {
      const gpuData = readLayerAsImageData(layerId);
      if (gpuData) {
        const { minX, minY, bufW, bufH } = unionBounds(layer.x, layer.y, gpuData.width, gpuData.height);
        const expanded = expandFromCrop(gpuData, layer.x - minX, layer.y - minY, bufW, bufH);
        const pixelData = new Map(state.layerPixelData);
        pixelData.set(layerId, expanded);
        set({
          document: {
            ...state.document,
            layers: state.document.layers.map((l) =>
              l.id === layerId ? { ...l, x: minX, y: minY, width: bufW, height: bufH } as Layer : l,
            ),
          },
          layerPixelData: pixelData,
        });
        return expanded;
      }
    }

    // Expand cropped data, preserving off-canvas content
    if (existing) {
      const { minX, minY, bufW, bufH } = unionBounds(layer.x, layer.y, existing.width, existing.height);
      const expanded = expandFromCrop(existing, layer.x - minX, layer.y - minY, bufW, bufH);
      const pixelData = new Map(state.layerPixelData);
      pixelData.set(layerId, expanded);
      set({
        document: {
          ...state.document,
          layers: state.document.layers.map((l) =>
            l.id === layerId ? { ...l, x: minX, y: minY, width: bufW, height: bufH } as Layer : l,
          ),
        },
        layerPixelData: pixelData,
      });
      return expanded;
    }

    const empty = createImageData(docW, docH);
    const pixelData = new Map(state.layerPixelData);
    pixelData.set(layerId, empty);
    set({
      document: {
        ...state.document,
        layers: state.document.layers.map((l) =>
          l.id === layerId ? { ...l, x: 0, y: 0, width: docW, height: docH } as Layer : l,
        ),
      },
      layerPixelData: pixelData,
    });
    return empty;
  },

  resolvePixelData: (layerId: string) => {
    const state = get();
    // Check JS cache first
    const data = state.layerPixelData.get(layerId);
    if (data) return data;
    const sparseEntry = state.sparseLayerData.get(layerId);
    if (sparseEntry) return sparseToImageData(sparseEntry.sparse);
    // Fall back to GPU readback
    const gpuData = readLayerAsImageData(layerId);
    if (gpuData) return gpuData;
    return undefined;
  },
});
