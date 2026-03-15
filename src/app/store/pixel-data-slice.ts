import type { SliceCreator } from './types';
import { createImageData } from '../../engine/color-space';
import { getRenderScheduler, getGpuCompositor } from '../../engine/renderer-registry';

export interface PixelDataSlice {
  layerPixelData: Map<string, ImageData>;
  dirtyLayerIds: Set<string>;
  renderVersion: number;
  getOrCreateLayerPixelData: (layerId: string) => ImageData;
  updateLayerPixelData: (layerId: string, data: ImageData) => void;
  notifyRender: () => void;
}

export const createPixelDataSlice: SliceCreator<PixelDataSlice> = (set, get) => ({
  layerPixelData: new Map(),
  dirtyLayerIds: new Set(),
  renderVersion: 0,

  getOrCreateLayerPixelData: (layerId: string) => {
    const state = get();
    const existing = state.layerPixelData.get(layerId);
    if (existing) return existing;

    const layer = state.document.layers.find((l) => l.id === layerId);
    const width = layer?.type === 'raster' || layer?.type === 'shape' ? layer.width : state.document.width;
    const height = layer?.type === 'raster' || layer?.type === 'shape' ? layer.height : state.document.height;
    const imageData = createImageData(width, height);
    const pixelData = new Map(state.layerPixelData);
    pixelData.set(layerId, imageData);
    set({ layerPixelData: pixelData });
    return imageData;
  },

  updateLayerPixelData: (layerId: string, data: ImageData) => {
    const state = get();
    const existing = state.layerPixelData.get(layerId);

    // Hot path: same ImageData reference (in-place modification via PixelBuffer.asImageData).
    // Skip Map cloning and bitmap cache — just notify the compositor.
    // Still track dirty state so history snapshots clone this layer's data.
    if (existing === data) {
      state.dirtyLayerIds.add(layerId);
      const compositor = getGpuCompositor();
      if (compositor) {
        compositor.bumpPixelVersion(layerId);
        getRenderScheduler()?.markCompositeDirty();
        return;
      }
      // CPU fallback: bump renderVersion so the useEffect re-composites
      set({ renderVersion: state.renderVersion + 1 });
      return;
    }

    // Cold path: new ImageData reference (first set, undo, image load, etc.)
    const pixelData = new Map(state.layerPixelData);
    pixelData.set(layerId, data);
    const dirtyLayerIds = new Set(state.dirtyLayerIds);
    dirtyLayerIds.add(layerId);
    set({ layerPixelData: pixelData, dirtyLayerIds, renderVersion: state.renderVersion + 1 });

    const compositor = getGpuCompositor();
    if (compositor) {
      compositor.bumpPixelVersion(layerId);
      getRenderScheduler()?.markCompositeDirty();
    }
  },

  notifyRender: () => {
    set((state) => ({ renderVersion: state.renderVersion + 1 }));
    getRenderScheduler()?.markCompositeDirty();
  },
});
