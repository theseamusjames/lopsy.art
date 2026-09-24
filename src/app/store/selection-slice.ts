import type { Rect } from '../../types';
import { cancelPrefloat } from '../interactions/prefloat';
import { getEngine } from '../../engine-wasm/engine-state';
import { hasFloat, dropFloat, cropLayerToContent } from '../../engine-wasm/wasm-bridge';
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
    // A pending prefloat holds GPU snapshots of every layer for the
    // selection that is being discarded — release them.
    cancelPrefloat();

    // #802 — a prefloat left a GPU float alive with the layer texture
    // expanded to doc size. If we clear the selection without dropping
    // that float, the engine keeps rendering the expanded state until
    // the next explicit operation, and any consumer that reads the
    // engine bounds sees the expanded rectangle. Drop the float and
    // crop the layer back to its content so the engine agrees with the
    // (never-touched) JS layer bounds.
    const engine = getEngine();
    const activeId = get().document.activeLayerId;
    if (engine && hasFloat(engine)) {
      dropFloat(engine);
      if (activeId) {
        const layer = get().document.layers.find((l) => l.id === activeId);
        if (layer && layer.type === 'raster') {
          const bounds = cropLayerToContent(engine, activeId);
          // If the engine's post-crop bounds don't match the JS layer,
          // re-align them so subsequent renders don't drift. This is a
          // no-op in the common case (the JS layer never changed).
          if (bounds.length === 4 && (bounds[2] ?? 0) > 0) {
            const [newX, newY, newW, newH] = [bounds[0]!, bounds[1]!, bounds[2]!, bounds[3]!];
            const width = (layer as { width?: number }).width ?? 0;
            const height = (layer as { height?: number }).height ?? 0;
            if (newX !== layer.x || newY !== layer.y || newW !== width || newH !== height) {
              set((s) => ({
                document: {
                  ...s.document,
                  layers: s.document.layers.map((l) =>
                    l.id === activeId
                      ? { ...l, x: newX, y: newY, width: newW, height: newH }
                      : l,
                  ),
                },
              }));
            }
          }
        }
      }
    }

    set({ selection: EMPTY_SELECTION, renderVersion: get().renderVersion + 1 });
  },
});
