import type { Rect } from '../../types';
import { EMPTY_SELECTION, type SelectionData, type SliceCreator } from './types';

export interface SelectionSlice {
  selection: SelectionData;
  setSelection: (bounds: Rect, mask: Uint8ClampedArray, maskWidth: number, maskHeight: number) => void;
  setSelectionBounds: (bounds: Rect) => void;
  clearSelection: () => void;
}

export const createSelectionSlice: SliceCreator<SelectionSlice> = (set, get) => ({
  selection: EMPTY_SELECTION,

  setSelection: (bounds: Rect, mask: Uint8ClampedArray, maskWidth: number, maskHeight: number) => {
    set({
      selection: { active: true, bounds, mask, maskWidth, maskHeight },
      renderVersion: get().renderVersion + 1,
    });
  },

  setSelectionBounds: (bounds: Rect) => {
    const sel = get().selection;
    if (!sel.active) return;
    set({
      selection: { ...sel, bounds },
      renderVersion: get().renderVersion + 1,
    });
  },

  clearSelection: () => {
    set({ selection: EMPTY_SELECTION, renderVersion: get().renderVersion + 1 });
  },
});
