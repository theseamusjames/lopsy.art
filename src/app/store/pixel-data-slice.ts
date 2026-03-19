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
  /** Read-only: returns ImageData from either dense or sparse storage.
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
    // the full canvas area. Read-only code uses layerPixelData.get() directly.
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
    // (same reference) so the subscription won't detect the change.
    invalidateBitmapCache(layerId);
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
      // Sparse storage — remove ImageData, store sparse.
      // Invalidate bitmap so an in-flight async build from the pre-sparse
      // full-canvas data doesn't store a huge bitmap that never gets cleaned up.
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

    // Dense content — keep as cropped ImageData (existing behavior)
    // Already at content bounds (or content fills >80%)
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
      // Non-raster: fall back to creating at doc dimensions
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

    // Check for sparse data first
    const sparseEntry = state.sparseLayerData.get(layerId);
    if (sparseEntry) {
      const expanded = fromSparsePixelData(sparseEntry.sparse, docW, docH, sparseEntry.offsetX, sparseEntry.offsetY);
      const pixelData = new Map(state.layerPixelData);
      pixelData.set(layerId, expanded);
      const sparseMap = new Map(state.sparseLayerData);
      sparseMap.delete(layerId);
      set({
        document: {
          ...state.document,
          layers: state.document.layers.map((l) =>
            l.id === layerId ? { ...l, x: 0, y: 0, width: docW, height: docH } as Layer : l,
          ),
        },
        layerPixelData: pixelData,
        sparseLayerData: sparseMap,
      });
      return expanded;
    }

    const existing = state.layerPixelData.get(layerId);

    // Already full canvas size at origin
    if (existing && layer.x === 0 && layer.y === 0 && existing.width === docW && existing.height === docH) {
      return existing;
    }

    // Expand cropped data to full canvas size
    const expanded = existing
      ? expandFromCrop(existing, layer.x, layer.y, docW, docH)
      : createImageData(docW, docH);

    const pixelData = new Map(state.layerPixelData);
    pixelData.set(layerId, expanded);
    set({
      document: {
        ...state.document,
        layers: state.document.layers.map((l) =>
          l.id === layerId ? { ...l, x: 0, y: 0, width: docW, height: docH } as Layer : l,
        ),
      },
      layerPixelData: pixelData,
    });
    return expanded;
  },

  resolvePixelData: (layerId: string) => {
    const state = get();
    const data = state.layerPixelData.get(layerId);
    if (data) return data;
    const sparseEntry = state.sparseLayerData.get(layerId);
    if (sparseEntry) return sparseToImageData(sparseEntry.sparse);
    return undefined;
  },
});
