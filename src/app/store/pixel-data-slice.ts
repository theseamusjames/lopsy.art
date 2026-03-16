import type { Layer } from '../../types';
import type { SliceCreator } from './types';
import { createImageData } from '../../engine/color-space';
import { cropToContentBounds, expandFromCrop } from '../../engine/canvas-ops';

export interface PixelDataSlice {
  layerPixelData: Map<string, ImageData>;
  dirtyLayerIds: Set<string>;
  renderVersion: number;
  getOrCreateLayerPixelData: (layerId: string) => ImageData;
  updateLayerPixelData: (layerId: string, data: ImageData) => void;
  notifyRender: () => void;
  cropLayerToContent: (layerId: string) => void;
  expandLayerForEditing: (layerId: string) => ImageData;
}

export const createPixelDataSlice: SliceCreator<PixelDataSlice> = (set, get) => ({
  layerPixelData: new Map(),
  dirtyLayerIds: new Set(),
  renderVersion: 0,

  getOrCreateLayerPixelData: (layerId: string) => {
    // Always returns a full-canvas-size ImageData, expanding cropped layers.
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
    set({ layerPixelData: pixelData, dirtyLayerIds, renderVersion: state.renderVersion + 1 });
    // Auto-crop after every write to keep memory tight
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
      const pixelData = new Map(state.layerPixelData);
      pixelData.delete(layerId);
      set({
        document: {
          ...state.document,
          layers: state.document.layers.map((l) =>
            l.id === layerId ? { ...l, x: 0, y: 0, width: state.document.width, height: state.document.height } as Layer : l,
          ),
        },
        layerPixelData: pixelData,
        renderVersion: state.renderVersion + 1,
      });
      return;
    }

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
      return state.getOrCreateLayerPixelData(layerId);
    }

    const docW = state.document.width;
    const docH = state.document.height;
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
});
