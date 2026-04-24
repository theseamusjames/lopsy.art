import { createRasterLayer } from '../../layers/layer-model';
import { getInsertionGroupId, getInsertionOrderIndex, addToGroup } from '../../layers/group-utils';
import { clearJsPixelData } from './clear-js-pixel-data';
import { getEngine } from '../../engine-wasm/engine-state';
import { syncSelection } from '../../engine-wasm/engine-sync';
import {
  clipboardCopy,
  clipboardCut,
  clipboardPaste,
  uploadLayerPixels,
  readClipboardPixels,
  uploadClipboardPixels,
  compositeForExport,
} from '../../engine-wasm/wasm-bridge';
import type { ClipboardData, SliceCreator } from './types';

function writeToSystemClipboard(width: number, height: number): void {
  try {
    const engine = getEngine();
    if (!engine) return;
    const pixels = readClipboardPixels(engine);
    const buf = new ArrayBuffer(pixels.byteLength);
    new Uint8Array(buf).set(pixels);
    const clamped = new Uint8ClampedArray(buf);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imageData = new ImageData(clamped, width, height);
    ctx.putImageData(imageData, 0, 0);
    canvas.convertToBlob({ type: 'image/png' }).then((blob) => {
      if (typeof navigator.clipboard?.write !== 'function') return;
      const item = new ClipboardItem({ 'image/png': blob });
      navigator.clipboard.write([item]).catch(() => {});
    }).catch(() => {});
  } catch {
    // System clipboard write is best-effort
  }
}

export interface ClipboardSlice {
  clipboard: ClipboardData | null;
  copy: () => void;
  copyMerged: () => void;
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

    // Ensure selection mask is uploaded to GPU before copying
    if (hasSelection) {
      syncSelection(engine, sel);
    }

    const bx = hasSelection && sel.bounds ? Math.round(sel.bounds.x) : 0;
    const by = hasSelection && sel.bounds ? Math.round(sel.bounds.y) : 0;
    const bw = hasSelection && sel.bounds ? Math.round(sel.bounds.width) : 0;
    const bh = hasSelection && sel.bounds ? Math.round(sel.bounds.height) : 0;

    const result = clipboardCopy(engine, activeId, hasSelection, bx, by, bw, bh);
    if (result.length >= 4) {
      const clipW = result[0]!;
      const clipH = result[1]!;
      set({
        clipboard: {
          width: clipW,
          height: clipH,
          offsetX: result[2]!,
          offsetY: result[3]!,
          gpuResident: true,
        },
      });
      writeToSystemClipboard(clipW, clipH);
    }
  },

  copyMerged: () => {
    const engine = getEngine();
    if (!engine) return;
    const state = get();
    const { width: docW, height: docH } = state.document;

    const rawPixels = compositeForExport(engine);

    const sel = state.selection;
    const hasSelection = sel.active && sel.bounds !== null && sel.mask !== null;
    const bx = hasSelection ? Math.round(sel.bounds!.x) : 0;
    const by = hasSelection ? Math.round(sel.bounds!.y) : 0;
    const bw = hasSelection ? Math.round(sel.bounds!.width) : docW;
    const bh = hasSelection ? Math.round(sel.bounds!.height) : docH;

    const cropped = new Uint8Array(bw * bh * 4);
    for (let y = 0; y < bh; y++) {
      const srcOffset = ((by + y) * docW + bx) * 4;
      const dstOffset = y * bw * 4;
      cropped.set(rawPixels.subarray(srcOffset, srcOffset + bw * 4), dstOffset);
    }

    if (hasSelection && sel.mask) {
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const maskVal = sel.mask[(by + y) * sel.maskWidth + (bx + x)] ?? 0;
          if (maskVal === 0) {
            const i = (y * bw + x) * 4;
            cropped[i] = 0;
            cropped[i + 1] = 0;
            cropped[i + 2] = 0;
            cropped[i + 3] = 0;
          }
        }
      }
    }

    uploadClipboardPixels(engine, cropped, bw, bh, bx, by);

    set({
      clipboard: {
        width: bw,
        height: bh,
        offsetX: bx,
        offsetY: by,
        gpuResident: true,
      },
    });
    writeToSystemClipboard(bw, bh);
  },

  cut: () => {
    const state = get();
    const activeId = state.document.activeLayerId;
    if (!activeId) return;
    const engine = getEngine();
    if (!engine) return;

    const sel = state.selection;
    const hasSelection = sel.active && sel.bounds !== null && sel.mask !== null;

    // Ensure selection mask is uploaded to GPU before cutting
    if (hasSelection) {
      syncSelection(engine, sel);
    }

    const bx = hasSelection && sel.bounds ? Math.round(sel.bounds.x) : 0;
    const by = hasSelection && sel.bounds ? Math.round(sel.bounds.y) : 0;
    const bw = hasSelection && sel.bounds ? Math.round(sel.bounds.width) : 0;
    const bh = hasSelection && sel.bounds ? Math.round(sel.bounds.height) : 0;

    state.pushHistory('Cut');
    const result = clipboardCut(engine, activeId, hasSelection, bx, by, bw, bh);
    if (result.length >= 4) {
      const clipW = result[0]!;
      const clipH = result[1]!;
      clearJsPixelData(activeId);
      set({
        clipboard: {
          width: clipW,
          height: clipH,
          offsetX: result[2]!,
          offsetY: result[3]!,
          gpuResident: true,
        },
        renderVersion: state.renderVersion + 1,
      });
      writeToSystemClipboard(clipW, clipH);
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

    const orderIdx = getInsertionOrderIndex(state.document.layerOrder, state.document.activeLayerId, state.document.rootGroupId, state.document.layers);
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

    const orderIdx = getInsertionOrderIndex(state.document.layerOrder, state.document.activeLayerId, state.document.rootGroupId, state.document.layers);
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

    const orderIdx = getInsertionOrderIndex(state.document.layerOrder, state.document.activeLayerId, state.document.rootGroupId, state.document.layers);
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
