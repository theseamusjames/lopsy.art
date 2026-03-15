import type { SliceCreator } from './types';

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
    const imageData = new ImageData(width, height);
    const pixelData = new Map(state.layerPixelData);
    pixelData.set(layerId, imageData);
    set({ layerPixelData: pixelData });
    return imageData;
  },

  updateLayerPixelData: (layerId: string, data: ImageData) => {
    const state = get();
    const pixelData = new Map(state.layerPixelData);
    pixelData.set(layerId, data);
    const dirtyLayerIds = new Set(state.dirtyLayerIds);
    dirtyLayerIds.add(layerId);
    set({ layerPixelData: pixelData, dirtyLayerIds, renderVersion: state.renderVersion + 1 });
  },

  notifyRender: () => {
    set((state) => ({ renderVersion: state.renderVersion + 1 }));
  },
});
