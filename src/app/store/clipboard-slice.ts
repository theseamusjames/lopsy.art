import { createRasterLayer } from '../../layers/layer-model';
import { getInsertionGroupId, addToGroup } from '../../layers/group-utils';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  clipboardCopy,
  clipboardCut,
  clipboardPaste,
  uploadLayerPixels,
} from '../../engine-wasm/wasm-bridge';
import type { ClipboardData, SliceCreator } from './types';

export interface ClipboardSlice {
  clipboard: ClipboardData | null;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  pasteImageData: (imageData: ImageData) => void;
  /** Create a layer for pixels already uploaded to the GPU by decodeAndUploadImage. */
  pasteGpuLayer: (layerId: string, width: number, height: number) => void;
}

export const createClipboardSlice: SliceCreator<ClipboardSlice> = (set, get) => ({
  clipboard: null,

  copy: () => {
    const state = get();
    const activeId = state.document.activeLayerId;
    if (!activeId) return;
    const engine = getEngine();
    if (!engine) return;

    const sel = state.selection;
    const hasSelection = sel.active && sel.bounds !== null && sel.mask !== null;
    const bx = hasSelection && sel.bounds ? Math.round(sel.bounds.x) : 0;
    const by = hasSelection && sel.bounds ? Math.round(sel.bounds.y) : 0;
    const bw = hasSelection && sel.bounds ? Math.round(sel.bounds.width) : 0;
    const bh = hasSelection && sel.bounds ? Math.round(sel.bounds.height) : 0;

    const result = clipboardCopy(engine, activeId, hasSelection, bx, by, bw, bh);
    if (result.length >= 4) {
      set({
        clipboard: {
          width: result[0]!,
          height: result[1]!,
          offsetX: result[2]!,
          offsetY: result[3]!,
          gpuResident: true,
        },
      });
    }
  },

  cut: () => {
    const state = get();
    const activeId = state.document.activeLayerId;
    if (!activeId) return;
    const engine = getEngine();
    if (!engine) return;

    const sel = state.selection;
    const hasSelection = sel.active && sel.bounds !== null && sel.mask !== null;
    const bx = hasSelection && sel.bounds ? Math.round(sel.bounds.x) : 0;
    const by = hasSelection && sel.bounds ? Math.round(sel.bounds.y) : 0;
    const bw = hasSelection && sel.bounds ? Math.round(sel.bounds.width) : 0;
    const bh = hasSelection && sel.bounds ? Math.round(sel.bounds.height) : 0;

    state.pushHistory('Cut');
    const result = clipboardCut(engine, activeId, hasSelection, bx, by, bw, bh);
    if (result.length >= 4) {
      // Clear stale JS pixel data for the source layer
      const pixelDataMap = new Map(state.layerPixelData);
      pixelDataMap.delete(activeId);
      const sparseMap = new Map(state.sparseLayerData);
      sparseMap.delete(activeId);
      const dirtyIds = new Set(state.dirtyLayerIds);
      dirtyIds.add(activeId);

      set({
        clipboard: {
          width: result[0]!,
          height: result[1]!,
          offsetX: result[2]!,
          offsetY: result[3]!,
          gpuResident: true,
        },
        layerPixelData: pixelDataMap,
        sparseLayerData: sparseMap,
        dirtyLayerIds: dirtyIds,
        renderVersion: state.renderVersion + 1,
      });
    }
  },

  paste: () => {
    const state = get();
    const clip = state.clipboard;
    if (!clip) return;
    const engine = getEngine();
    if (!engine) return;

    state.pushHistory('Paste');

    const newLayer = {
      ...createRasterLayer({ name: 'Pasted Layer', width: clip.width, height: clip.height }),
      x: clip.offsetX,
      y: clip.offsetY,
    };

    const orderIdx = state.document.activeLayerId
      ? state.document.layerOrder.indexOf(state.document.activeLayerId) + 1
      : state.document.layerOrder.length;
    const newOrder = [...state.document.layerOrder];
    newOrder.splice(orderIdx, 0, newLayer.id);

    // Blit clipboard texture to the new layer
    clipboardPaste(engine, newLayer.id);

    const groupId = getInsertionGroupId(state.document.layers, state.document.activeLayerId, state.document.rootGroupId);
    let layers = [...state.document.layers, newLayer];
    if (groupId) layers = addToGroup(layers, newLayer.id, groupId);

    set({
      document: {
        ...state.document,
        layers,
        layerOrder: newOrder,
        activeLayerId: newLayer.id,
      },
      renderVersion: state.renderVersion + 1,
    });
  },

  pasteImageData: (imageData: ImageData) => {
    const state = get();
    state.pushHistory('Paste');

    const newLayer = createRasterLayer({ name: 'Pasted Layer', width: imageData.width, height: imageData.height });

    const orderIdx = state.document.activeLayerId
      ? state.document.layerOrder.indexOf(state.document.activeLayerId) + 1
      : state.document.layerOrder.length;
    const newOrder = [...state.document.layerOrder];
    newOrder.splice(orderIdx, 0, newLayer.id);

    const groupId2 = getInsertionGroupId(state.document.layers, state.document.activeLayerId, state.document.rootGroupId);
    let layers2 = [...state.document.layers, newLayer];
    if (groupId2) layers2 = addToGroup(layers2, newLayer.id, groupId2);

    set({
      document: {
        ...state.document,
        layers: layers2,
        layerOrder: newOrder,
        activeLayerId: newLayer.id,
      },
      renderVersion: state.renderVersion + 1,
    });

    // Upload external image data directly to GPU
    const engine = getEngine();
    if (engine) {
      const rawBytes = new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength);
      uploadLayerPixels(engine, newLayer.id, rawBytes, imageData.width, imageData.height, 0, 0);
    }
  },

  pasteGpuLayer: (layerId: string, width: number, height: number) => {
    const state = get();
    state.pushHistory('Paste');

    const newLayer = { ...createRasterLayer({ name: 'Pasted Layer', width, height }), id: layerId };

    const orderIdx = state.document.activeLayerId
      ? state.document.layerOrder.indexOf(state.document.activeLayerId) + 1
      : state.document.layerOrder.length;
    const newOrder = [...state.document.layerOrder];
    newOrder.splice(orderIdx, 0, newLayer.id);

    const groupId3 = getInsertionGroupId(state.document.layers, state.document.activeLayerId, state.document.rootGroupId);
    let layers3 = [...state.document.layers, newLayer];
    if (groupId3) layers3 = addToGroup(layers3, newLayer.id, groupId3);

    set({
      document: {
        ...state.document,
        layers: layers3,
        layerOrder: newOrder,
        activeLayerId: newLayer.id,
      },
      renderVersion: state.renderVersion + 1,
    });
  },
});
