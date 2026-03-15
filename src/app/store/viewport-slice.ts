import type { ViewportState } from '../../types';
import type { SliceCreator } from './types';

export interface ViewportSlice {
  viewport: ViewportState;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setViewportSize: (width: number, height: number) => void;
}

export const createViewportSlice: SliceCreator<ViewportSlice> = (set) => ({
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
});
