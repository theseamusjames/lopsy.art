import type { Rect } from '../../types';
import type { SelectionData, SliceCreator } from './types';

export interface SelectionSlice {
  selection: SelectionData;
  setSelection: (bounds: Rect, mask: Uint8ClampedArray, maskWidth: number, maskHeight: number) => void;
  clearSelection: () => void;
}

export const createSelectionSlice: SliceCreator<SelectionSlice> = (set, get) => ({
  selection: { active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 },

  setSelection: (bounds: Rect, mask: Uint8ClampedArray, maskWidth: number, maskHeight: number) => {
    set({ selection: { active: true, bounds, mask, maskWidth, maskHeight }, renderVersion: get().renderVersion + 1 });
  },

  clearSelection: () => {
    set({ selection: { active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 }, renderVersion: get().renderVersion + 1 });
  },
});
