import type { ViewportState } from '../../types';
import type { SliceCreator } from './types';

export interface ViewportSlice {
  viewport: ViewportState;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setViewportSize: (width: number, height: number) => void;
  fitToView: () => void;
}

export const createViewportSlice: SliceCreator<ViewportSlice> = (set, get) => ({
  viewport: {
    zoom: 1,
    panX: 0,
    panY: 0,
    width: 0,
    height: 0,
  },

  setZoom: (zoom: number) => {
    set((state) => ({
      viewport: { ...state.viewport, zoom: Math.max(0.01, Math.min(64, zoom)) },
    }));
  },

  setPan: (x: number, y: number) => {
    set((state) => ({
      viewport: { ...state.viewport, panX: x, panY: y },
    }));
  },

  setViewportSize: (width: number, height: number) => {
    set((state) => ({
      viewport: { ...state.viewport, width, height },
    }));
  },

  fitToView: () => {
    const state = get();
    const { width: vw, height: vh } = state.viewport;
    const { width: dw, height: dh } = state.document;
    if (vw <= 0 || vh <= 0 || dw <= 0 || dh <= 0) return;
    const padding = 40;
    const zoom = Math.min((vw - padding * 2) / dw, (vh - padding * 2) / dh, 1);
    set((s) => ({
      viewport: { ...s.viewport, zoom, panX: 0, panY: 0 },
    }));
  },
});
