import { create } from 'zustand';
import { createViewportSlice } from './store/viewport-slice';
import { createSelectionSlice } from './store/selection-slice';
import { createPixelDataSlice } from './store/pixel-data-slice';
import { createHistorySlice } from './store/history-slice';
import { createClipboardSlice } from './store/clipboard-slice';
import { createDocumentSlice } from './store/document-slice';
import { updateBitmapCache, clearBitmapCache, removeBitmapCache, setBitmapReadyCallback } from '../engine/bitmap-cache';
import type { EditorState } from './store/types';

export type { EditorState };

export const useEditorStore = create<EditorState>((...a) => ({
  ...createViewportSlice(...a),
  ...createSelectionSlice(...a),
  ...createPixelDataSlice(...a),
  ...createHistorySlice(...a),
  ...createClipboardSlice(...a),
  ...createDocumentSlice(...a),
}));

// When a bitmap finishes building, bump renderVersion so the canvas repaints
setBitmapReadyCallback(() => {
  useEditorStore.getState().notifyRender();
});

// Watch for pixel data changes and keep the bitmap cache in sync
let prevPixelData: Map<string, ImageData> = new Map();
useEditorStore.subscribe((state) => {
  const next = state.layerPixelData;
  if (next === prevPixelData) return;

  // Build bitmaps for new or changed entries
  for (const [id, data] of next) {
    if (prevPixelData.get(id) !== data) {
      updateBitmapCache(id, data);
    }
  }
  // Clean up removed layers (including sparsified — their bitmap is stale)
  for (const id of prevPixelData.keys()) {
    if (!next.has(id)) {
      removeBitmapCache(id);
    }
  }
  // Detect full document reset (all layer IDs changed)
  if (next.size > 0 && prevPixelData.size > 0) {
    let anyShared = false;
    for (const id of next.keys()) {
      if (prevPixelData.has(id)) { anyShared = true; break; }
    }
    if (!anyShared) clearBitmapCache();
  }

  prevPixelData = next;
});
