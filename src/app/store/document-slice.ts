import type { BlendMode, LayerEffects, Layer, Rect } from '../../types';
import type { AlignEdge } from '../../tools/move/move';
import { createRasterLayer, createGroupLayer } from '../../layers/layer-model';
import { moveLayerToGroup as moveLayerToGroupUtil, getInsertionGroupId, getInsertionOrderIndex, addToGroup as addToGroupUtil } from '../../layers/group-utils';
import { sparseToImageData } from '../../engine/canvas-ops';
import { readLayerAsImageData } from '../../engine-wasm/gpu-pixel-access';
import { getEngine } from '../../engine-wasm/engine-state';
import { uploadLayerPixels } from '../../engine-wasm/wasm-bridge';
import { invalidateBitmapCache } from '../../engine/bitmap-cache';
import type { SliceCreator, SparseLayerEntry } from './types';
import { useUIStore } from '../ui-store';

import { computeCreateDocument } from './actions/create-document';
import { computeOpenImage } from './actions/open-image';
import { computeAddLayer } from './actions/add-layer';
import { computeAddTextLayer, computeUpdateTextLayerProperties } from './actions/add-text-layer';
import { computeRemoveLayer } from './actions/remove-layer';
import { computeMoveLayer } from './actions/move-layer';
import { computeDuplicateLayer } from './actions/duplicate-layer';
import { computeMergeDown } from './actions/merge-down';
import { computeFlattenImage } from './actions/flatten-image';
import { computeRasterizeStyle } from './actions/rasterize-style';
import { computeCropCanvas } from './actions/crop-canvas';
import { computeResizeCanvas } from './actions/resize-canvas';
import { computeResizeImage } from './actions/resize-image';
import { computeAlignLayer } from './actions/align-layer';
import { computeAddLayerMask } from './actions/add-layer-mask';
import { computeRemoveLayerMask } from './actions/remove-layer-mask';
import {
  computeSetActiveLayer,
  computeToggleVisibility,
  computeUpdateOpacity,
  computeUpdateBlendMode,
  computeUpdatePosition,
  computeUpdateEffects,
  computeToggleMask,
  computeUpdateMaskData,
} from './actions/layer-property-updates';

/** Merge dense + sparse + GPU pixel data into a single map for compute functions.
 *  Falls back to GPU readback for layers that have no JS data.
 *  IMPORTANT: callers must clear sparseLayerData after set() to avoid
 *  sparse entries duplicating data that is now in layerPixelData. */
function resolveAllPixelData(
  dense: Map<string, ImageData>,
  sparse: Map<string, SparseLayerEntry>,
  layerIds?: readonly string[],
  layers?: readonly Layer[],
): Map<string, ImageData> {
  const merged = new Map(dense);
  for (const [id, entry] of sparse) {
    if (!merged.has(id)) {
      merged.set(id, sparseToImageData(entry.sparse));
    }
  }
  // Fall back to GPU readback for layers with no JS data
  if (layerIds) {
    for (const id of layerIds) {
      if (!merged.has(id)) {
        // Skip group layers — they have no GPU texture
        if (layers) {
          const layer = layers.find((l) => l.id === id);
          if (layer && layer.type === 'group') continue;
        }
        const gpuData = readLayerAsImageData(id);
        if (gpuData) {
          merged.set(id, gpuData);
        }
      }
    }
  }
  return merged;
}

/** Upload all pixel data entries to the GPU engine.
 *  Called after compute functions that produce a new layerPixelData map. */
function syncPixelDataToGpu(
  pixelData: Map<string, ImageData>,
  layers: readonly Layer[],
): void {
  const engine = getEngine();
  if (!engine) return;
  for (const [layerId, data] of pixelData) {
    invalidateBitmapCache(layerId);
    const layer = layers.find((l) => l.id === layerId);
    const lx = layer?.x ?? 0;
    const ly = layer?.y ?? 0;
    const rawBytes = new Uint8Array(data.data.buffer, data.data.byteOffset, data.data.byteLength);
    uploadLayerPixels(engine, layerId, rawBytes, data.width, data.height, lx, ly);
  }
}

function createInitialDocument() {
  const bg = createRasterLayer({ name: 'Background', width: 800, height: 600 });
  const rootGroup = createGroupLayer({ name: 'Project', children: [bg.id] });
  return {
    id: crypto.randomUUID(),
    name: 'Untitled' as const,
    width: 800,
    height: 600,
    layers: [bg, rootGroup] as readonly Layer[],
    layerOrder: [bg.id, rootGroup.id] as readonly string[],
    activeLayerId: bg.id as string | null,
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    rootGroupId: rootGroup.id as string | null,
  };
}

export interface DocumentSlice {
  document: ReturnType<typeof createInitialDocument>;
  documentReady: boolean;
  createDocument: (width: number, height: number, transparentBg: boolean) => void;
  openImageAsDocument: (imageData: ImageData, name: string) => void;
  addLayer: () => void;
  addTextLayer: (layer: import('../../types').TextLayer) => void;
  updateTextLayerProperties: (id: string, props: Partial<Omit<import('../../types').TextLayer, 'id' | 'type'>>) => void;
  removeLayer: (id: string) => void;
  setActiveLayer: (id: string) => void;
  toggleLayerVisibility: (id: string) => void;
  toggleLayerLock: (id: string) => void;
  renameLayer: (id: string, name: string) => void;
  addGroup: (name?: string) => void;
  toggleGroupCollapsed: (groupId: string) => void;
  moveLayerToGroup: (layerId: string, targetGroupId: string, insertIndex?: number) => void;
  setGroupAdjustments: (groupId: string, adjustments: import('../../filters/image-adjustments').ImageAdjustments) => void;
  setGroupAdjustmentsEnabled: (groupId: string, enabled: boolean) => void;
  updateLayerOpacity: (id: string, opacity: number) => void;
  updateLayerBlendMode: (id: string, blendMode: BlendMode) => void;
  moveLayer: (fromIndex: number, toIndex: number) => void;
  updateLayerPosition: (id: string, x: number, y: number) => void;
  alignLayer: (edge: AlignEdge) => void;
  duplicateLayer: () => void;
  mergeDown: () => void;
  flattenImage: () => void;
  rasterizeLayerStyle: () => void;
  updateLayerEffects: (id: string, effects: LayerEffects) => void;
  addLayerMask: (id: string) => void;
  removeLayerMask: (id: string) => void;
  toggleLayerMask: (id: string) => void;
  updateLayerMaskData: (layerId: string, maskData: Uint8ClampedArray) => void;
  cropCanvas: (rect: Rect) => void;
  resizeCanvas: (newWidth: number, newHeight: number, anchorX: number, anchorY: number) => void;
  resizeImage: (newWidth: number, newHeight: number) => void;
}

export const createDocumentSlice: SliceCreator<DocumentSlice> = (set, get) => ({
  document: createInitialDocument(),
  documentReady: false,

  createDocument: (width, height, transparentBg) => {
    const result = computeCreateDocument(width, height, transparentBg);
    set(result);
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
    useUIStore.getState().clearGuides();
  },

  openImageAsDocument: (imageData, name) => {
    const result = computeOpenImage(imageData, name);
    set(result);
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
    useUIStore.getState().clearGuides();
  },

  addLayer: () => {
    const s = get();
    s.pushHistory('Add Layer');
    const result = computeAddLayer(s.document);
    if (result) set(result);
  },

  addTextLayer: (layer) => {
    const s = get();
    s.pushHistory('Add Text Layer');
    const result = computeAddTextLayer(s.document, layer);
    if (result) set(result);
  },

  updateTextLayerProperties: (id, props) => {
    const s = get();
    const result = computeUpdateTextLayerProperties(s.document, id, props);
    set({ ...result, renderVersion: s.renderVersion + 1 });
  },

  removeLayer: (id) => {
    const s = get();
    const result = computeRemoveLayer(s.document, s.layerPixelData, s.sparseLayerData, id);
    if (!result) return;
    s.pushHistory('Delete Layer');
    set(result);
  },

  setActiveLayer: (id) => {
    set(computeSetActiveLayer(get().document, id));
  },

  toggleLayerVisibility: (id) => {
    const s = get();
    s.pushHistory('Toggle Visibility');
    set(computeToggleVisibility(s.document, id));
  },

  toggleLayerLock: (id) => {
    const doc = get().document;
    const layers = doc.layers.map((l) =>
      l.id === id ? { ...l, locked: !l.locked } : l,
    );
    set({ document: { ...doc, layers } });
  },

  renameLayer: (id, name) => {
    const doc = get().document;
    const layers = doc.layers.map((l) =>
      l.id === id ? { ...l, name } : l,
    );
    set({ document: { ...doc, layers } });
  },

  addGroup: (name) => {
    const doc = get().document;
    const group = createGroupLayer({ name: name ?? 'Group' });
    let layers = [...doc.layers, group];
    const targetGroupId = getInsertionGroupId(doc.layers, doc.activeLayerId, doc.rootGroupId);
    if (targetGroupId) {
      layers = addToGroupUtil(layers, group.id, targetGroupId);
    }
    const orderIdx = getInsertionOrderIndex(doc.layerOrder, doc.activeLayerId);
    const layerOrder = [...doc.layerOrder];
    layerOrder.splice(orderIdx, 0, group.id);
    set({
      document: { ...doc, layers, layerOrder, activeLayerId: group.id },
    });
  },

  toggleGroupCollapsed: (groupId) => {
    const doc = get().document;
    const layers = doc.layers.map((l) =>
      l.id === groupId && l.type === 'group'
        ? { ...l, collapsed: !('collapsed' in l && l.collapsed) }
        : l,
    );
    set({ document: { ...doc, layers } });
  },

  moveLayerToGroup: (layerId, targetGroupId, insertIndex) => {
    const doc = get().document;
    const newLayers = moveLayerToGroupUtil(doc.layers, layerId, targetGroupId, insertIndex);
    // Reposition in layerOrder: place just before the target group
    // so the layer renders within the group's range
    const newOrder = doc.layerOrder.filter((id) => id !== layerId);
    const groupIdx = newOrder.indexOf(targetGroupId);
    if (groupIdx !== -1) {
      newOrder.splice(groupIdx, 0, layerId);
    } else {
      newOrder.push(layerId);
    }
    set({ document: { ...doc, layers: newLayers, layerOrder: newOrder } });
  },

  setGroupAdjustments: (groupId, adjustments) => {
    const doc = get().document;
    const layers = doc.layers.map((l) =>
      l.id === groupId && l.type === 'group' ? { ...l, adjustments } : l,
    );
    set({ document: { ...doc, layers } });
  },

  setGroupAdjustmentsEnabled: (groupId, enabled) => {
    const doc = get().document;
    const layers = doc.layers.map((l) =>
      l.id === groupId && l.type === 'group'
        ? { ...l, adjustmentsEnabled: enabled }
        : l,
    );
    set({ document: { ...doc, layers } });
  },

  updateLayerOpacity: (id, opacity) => {
    set(computeUpdateOpacity(get().document, id, opacity));
  },

  updateLayerBlendMode: (id, blendMode) => {
    set(computeUpdateBlendMode(get().document, id, blendMode));
  },

  moveLayer: (fromIndex, toIndex) => {
    const s = get();
    s.pushHistory('Reorder Layer');
    const result = computeMoveLayer(s.document, s.renderVersion, fromIndex, toIndex);
    if (result) set(result);
  },

  updateLayerPosition: (id, x, y) => {
    set(computeUpdatePosition(get().document, get().renderVersion, id, x, y));
  },

  alignLayer: (edge) => {
    const s = get();
    const sparseIds = [...s.sparseLayerData.keys()];
    const result = computeAlignLayer(s.document, resolveAllPixelData(s.layerPixelData, s.sparseLayerData, s.document.layerOrder, s.document.layers), s.selection, s.renderVersion, edge);
    if (!result) return;
    s.pushHistory('Align Layer');
    set({ ...result, sparseLayerData: new Map() });
    for (const id of sparseIds) get().cropLayerToContent(id);
  },

  duplicateLayer: () => {
    const s = get();
    const sparseIds = [...s.sparseLayerData.keys()];
    const result = computeDuplicateLayer(s.document, resolveAllPixelData(s.layerPixelData, s.sparseLayerData, s.document.layerOrder, s.document.layers));
    if (!result) return;
    s.pushHistory('Duplicate Layer');
    set({ ...result, sparseLayerData: new Map() });
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
    for (const id of sparseIds) get().cropLayerToContent(id);
  },

  mergeDown: () => {
    const s = get();
    const sparseIds = [...s.sparseLayerData.keys()];
    const result = computeMergeDown(s.document, resolveAllPixelData(s.layerPixelData, s.sparseLayerData, s.document.layerOrder, s.document.layers));
    if (!result) return;
    s.pushHistory('Merge Down');
    set({ ...result, sparseLayerData: new Map() });
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
    for (const id of sparseIds) get().cropLayerToContent(id);
  },

  flattenImage: () => {
    const s = get();
    const result = computeFlattenImage(s.document, resolveAllPixelData(s.layerPixelData, s.sparseLayerData, s.document.layerOrder, s.document.layers));
    if (!result) return;
    s.pushHistory('Flatten Image');
    set({ ...result, sparseLayerData: new Map() });
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
  },

  rasterizeLayerStyle: () => {
    const s = get();
    const sparseIds = [...s.sparseLayerData.keys()];
    const result = computeRasterizeStyle(s.document, resolveAllPixelData(s.layerPixelData, s.sparseLayerData, s.document.layerOrder, s.document.layers));
    if (!result) return;
    s.pushHistory('Rasterize Layer Style');
    set({ ...result, sparseLayerData: new Map() });
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
    for (const id of sparseIds) get().cropLayerToContent(id);
  },

  updateLayerEffects: (id, effects) => {
    const s = get();
    s.pushHistory('Update Effects');
    set(computeUpdateEffects(s.document, s.renderVersion, id, effects));
  },

  addLayerMask: (id) => {
    const s = get();
    s.pushHistory('Add Mask');
    const result = computeAddLayerMask(s.document, s.renderVersion, id);
    if (result) set(result);
  },

  removeLayerMask: (id) => {
    const s = get();
    const result = computeRemoveLayerMask(s.document, s.renderVersion, id);
    if (!result) return;
    s.pushHistory('Remove Mask');
    set(result);
  },

  toggleLayerMask: (id) => {
    const s = get();
    const result = computeToggleMask(s.document, s.renderVersion, id);
    if (!result) return;
    s.pushHistory('Toggle Mask');
    set(result);
  },

  updateLayerMaskData: (layerId, maskData) => {
    set(computeUpdateMaskData(get().document, get().renderVersion, layerId, maskData));
  },

  cropCanvas: (rect) => {
    const s = get();
    s.pushHistory('Crop Canvas');
    const result = computeCropCanvas(s.document, resolveAllPixelData(s.layerPixelData, s.sparseLayerData, s.document.layerOrder, s.document.layers), s.renderVersion, rect);
    if (result) {
      set({ ...result, sparseLayerData: new Map() });
      if (result.layerPixelData && result.document) {
        syncPixelDataToGpu(result.layerPixelData, result.document.layers);
      }
    }
  },

  resizeCanvas: (newWidth, newHeight, anchorX, anchorY) => {
    const s = get();
    s.pushHistory('Resize Canvas');
    const result = computeResizeCanvas(s.document, resolveAllPixelData(s.layerPixelData, s.sparseLayerData, s.document.layerOrder, s.document.layers), s.renderVersion, newWidth, newHeight, anchorX, anchorY);
    set({ ...result, sparseLayerData: new Map() });
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
  },

  resizeImage: (newWidth, newHeight) => {
    const s = get();
    s.pushHistory('Resize Image');
    const result = computeResizeImage(s.document, resolveAllPixelData(s.layerPixelData, s.sparseLayerData, s.document.layerOrder, s.document.layers), s.renderVersion, newWidth, newHeight);
    set({ ...result, sparseLayerData: new Map() });
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
  },
});
