import { cloneImageData } from '../../engine/canvas-ops';
import { getSelectionMaskValue } from '../../selection/selection';
import { createRasterLayer } from '../../layers/layer-model';
import { createImageData } from '../../engine/color-space';
import type { ClipboardData, SliceCreator } from './types';

export interface ClipboardSlice {
  clipboard: ClipboardData | null;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  pasteImageData: (imageData: ImageData) => void;
}

export const createClipboardSlice: SliceCreator<ClipboardSlice> = (set, get) => ({
  clipboard: null,

  copy: () => {
    const state = get();
    const activeId = state.document.activeLayerId;
    if (!activeId) return;
    const layerData = state.resolvePixelData(activeId);
    if (!layerData) return;
    const layer = state.document.layers.find((l) => l.id === activeId);
    if (!layer) return;

    const sel = state.selection;
    if (sel.active && sel.bounds && sel.mask) {
      const b = sel.bounds;
      const w = Math.round(b.width);
      const h = Math.round(b.height);
      const bx = Math.round(b.x);
      const by = Math.round(b.y);
      const copied = createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const docX = bx + x;
          const docY = by + y;
          const maskVal = getSelectionMaskValue(sel, docX, docY);
          if (maskVal < 128) continue;
          const srcX = docX - layer.x;
          const srcY = docY - layer.y;
          if (srcX < 0 || srcX >= layerData.width || srcY < 0 || srcY >= layerData.height) continue;
          const si = (srcY * layerData.width + srcX) * 4;
          const di = (y * w + x) * 4;
          copied.data[di] = layerData.data[si] ?? 0;
          copied.data[di + 1] = layerData.data[si + 1] ?? 0;
          copied.data[di + 2] = layerData.data[si + 2] ?? 0;
          copied.data[di + 3] = layerData.data[si + 3] ?? 0;
        }
      }
      set({ clipboard: { imageData: copied, offsetX: bx, offsetY: by } });
    } else {
      const copied = cloneImageData(layerData);
      set({ clipboard: { imageData: copied, offsetX: layer.x, offsetY: layer.y } });
    }
  },

  cut: () => {
    const state = get();
    const activeId = state.document.activeLayerId;
    if (!activeId) return;

    state.copy();

    state.pushHistory('Cut');
    const layerData = state.getOrCreateLayerPixelData(activeId);
    const layer = state.document.layers.find((l) => l.id === activeId);
    if (!layer) return;
    const result = cloneImageData(layerData);
    const sel = state.selection;

    if (sel.active && sel.bounds && sel.mask) {
      for (let y = 0; y < sel.maskHeight; y++) {
        for (let x = 0; x < sel.maskWidth; x++) {
          if (getSelectionMaskValue(sel, x, y) < 128) continue;
          const srcX = x - layer.x;
          const srcY = y - layer.y;
          if (srcX < 0 || srcX >= result.width || srcY < 0 || srcY >= result.height) continue;
          const idx = (srcY * result.width + srcX) * 4;
          result.data[idx] = 0;
          result.data[idx + 1] = 0;
          result.data[idx + 2] = 0;
          result.data[idx + 3] = 0;
        }
      }
    } else {
      result.data.fill(0);
    }
    state.updateLayerPixelData(activeId, result);
  },

  paste: () => {
    const state = get();
    const clip = state.clipboard;
    if (!clip) return;
    state.pushHistory('Paste');

    const newLayer = { ...createRasterLayer({ name: 'Pasted Layer', width: clip.imageData.width, height: clip.imageData.height }), x: clip.offsetX, y: clip.offsetY };

    const pixelData = new Map(state.layerPixelData);
    pixelData.set(newLayer.id, cloneImageData(clip.imageData));

    const orderIdx = state.document.activeLayerId
      ? state.document.layerOrder.indexOf(state.document.activeLayerId) + 1
      : state.document.layerOrder.length;
    const newOrder = [...state.document.layerOrder];
    newOrder.splice(orderIdx, 0, newLayer.id);

    set({
      document: {
        ...state.document,
        layers: [...state.document.layers, newLayer],
        layerOrder: newOrder,
        activeLayerId: newLayer.id,
      },
      layerPixelData: pixelData,
      renderVersion: state.renderVersion + 1,
    });
  },

  pasteImageData: (imageData: ImageData) => {
    const state = get();
    state.pushHistory('Paste');

    const newLayer = createRasterLayer({ name: 'Pasted Layer', width: imageData.width, height: imageData.height });

    const pixelData = new Map(state.layerPixelData);
    pixelData.set(newLayer.id, imageData);

    const orderIdx = state.document.activeLayerId
      ? state.document.layerOrder.indexOf(state.document.activeLayerId) + 1
      : state.document.layerOrder.length;
    const newOrder = [...state.document.layerOrder];
    newOrder.splice(orderIdx, 0, newLayer.id);

    set({
      document: {
        ...state.document,
        layers: [...state.document.layers, newLayer],
        layerOrder: newOrder,
        activeLayerId: newLayer.id,
      },
      layerPixelData: pixelData,
      renderVersion: state.renderVersion + 1,
    });
  },
});
