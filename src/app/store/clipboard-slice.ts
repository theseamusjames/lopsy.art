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
  clipboardCopyMerged,
} from '../../engine-wasm/wasm-bridge';
import { decodeBlobToRgba, pixelsLikelySame } from './clipboard-image-match';
import {
  beginSystemClipboardWrite,
  completeSystemClipboardWrite,
  isSystemClipboardWriteCurrent,
} from './system-clipboard-sync';
import { notifyInfo } from '../notifications-store';
import type { ClipboardData, SliceCreator } from './types';
import type { Layer } from '../../types';

/**
 * A group's own texture is never drawn, so copying or cutting it yields an
 * empty clipboard that a later Paste turns into an empty layer (#1338).
 * Returns false (after a toast) when the active layer can't be copied from.
 */
function guardCopySource(layer: Layer | undefined, action: 'copied' | 'cut'): boolean {
  if (layer?.type !== 'group') return true;
  notifyInfo(`Groups can't be ${action} from. Select a layer inside the group, or use Copy Merged.`);
  return false;
}

function writeToSystemClipboard(width: number, height: number): void {
  const seq = beginSystemClipboardWrite();
  const engine = getEngine();
  if (!engine) return;
  readClipboardPixels(engine)
    .then((pixels) => {
      const buf = new ArrayBuffer(pixels.byteLength);
      new Uint8Array(buf).set(pixels);
      const clamped = new Uint8ClampedArray(buf);
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const imageData = new ImageData(clamped, width, height);
      ctx.putImageData(imageData, 0, 0);
      return canvas.convertToBlob({ type: 'image/png' });
    })
    .then((blob) => {
      if (!blob) return undefined;
      if (typeof navigator.clipboard?.write !== 'function') return undefined;
      if (!isSystemClipboardWriteCurrent(seq)) return undefined;
      const item = new ClipboardItem({ 'image/png': blob });
      return navigator.clipboard.write([item]).then(() => completeSystemClipboardWrite(seq));
    })
    .catch(() => {
      // System clipboard write is best-effort
    });
}

export interface ClipboardSlice {
  clipboard: ClipboardData | null;
  copy: () => void;
  copyMerged: () => Promise<void>;
  cut: () => void;
  /** Paste the internal clipboard in place; returns the new layer's id, or null if nothing was pasted. */
  paste: () => string | null;
  /**
   * Whether `blob` is a paste-back of content copied inside the app — same
   * dimensions AND (near-)identical pixels as the GPU-resident clipboard — so
   * the caller can paste the internal copy in place instead of treating the
   * blob as an external image.
   */
  matchesInternalClipboard: (blob: Blob) => Promise<boolean>;
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
    const activeLayer = state.document.layers.find((l) => l.id === activeId);
    if (!guardCopySource(activeLayer, 'copied')) return;
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

  copyMerged: async () => {
    const engine = getEngine();
    if (!engine) return;
    const sel = get().selection;
    const hasSelection = sel.active && sel.bounds !== null && sel.mask !== null;

    // Ensure selection mask is uploaded to GPU before copying
    if (hasSelection) {
      syncSelection(engine, sel);
    }

    const bx = hasSelection && sel.bounds ? Math.round(sel.bounds.x) : 0;
    const by = hasSelection && sel.bounds ? Math.round(sel.bounds.y) : 0;
    const bw = hasSelection && sel.bounds ? Math.round(sel.bounds.width) : 0;
    const bh = hasSelection && sel.bounds ? Math.round(sel.bounds.height) : 0;

    // The engine composites the document and copies it into the clipboard
    // texture through the selection. Nothing is read back, except in a Lab
    // document, whose composite the engine decodes on the CPU.
    const result = await clipboardCopyMerged(engine, hasSelection, bx, by, bw, bh);
    if (result.length < 4) return;
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
  },

  cut: () => {
    const state = get();
    const activeId = state.document.activeLayerId;
    if (!activeId) return;
    const activeLayer = state.document.layers.find((l) => l.id === activeId);
    if (!guardCopySource(activeLayer, 'cut')) return;
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
    if (!clip) return null;
    const engine = getEngine();
    if (!engine) return null;

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
    if (groupId) layers = addToGroup(layers, newLayer.id, groupId, newOrder);

    set({
      document: {
        ...state.document,
        layers,
        layerOrder: newOrder,
        activeLayerId: newLayer.id,
        selectedLayerIds: [newLayer.id],
      },
      renderVersion: state.renderVersion + 1,
    });
    return newLayer.id;
  },

  matchesInternalClipboard: async (blob: Blob): Promise<boolean> => {
    const clip = get().clipboard;
    if (!clip) return false;
    const engine = getEngine();
    if (!engine) return false;

    const decoded = await decodeBlobToRgba(blob);
    if (!decoded || decoded.width !== clip.width || decoded.height !== clip.height) return false;

    // read_clipboard_pixels throws when the GPU clipboard texture is gone
    // (e.g. after the engine was reset by File > New), which also keeps the
    // caller's paste() from operating on a released clipboard.
    let clipPixels: Uint8Array;
    try {
      clipPixels = await readClipboardPixels(engine);
    } catch {
      return false;
    }
    return pixelsLikelySame(clipPixels, decoded.data);
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
    if (groupId2) layers2 = addToGroup(layers2, newLayer.id, groupId2, newOrder);

    set({
      document: {
        ...state.document,
        layers: layers2,
        layerOrder: newOrder,
        activeLayerId: newLayer.id,
        selectedLayerIds: [newLayer.id],
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
    if (groupId3) layers3 = addToGroup(layers3, newLayer.id, groupId3, newOrder);

    set({
      document: {
        ...state.document,
        layers: layers3,
        layerOrder: newOrder,
        activeLayerId: newLayer.id,
        selectedLayerIds: [newLayer.id],
      },
      renderVersion: state.renderVersion + 1,
    });
  },
});
