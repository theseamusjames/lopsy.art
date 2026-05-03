import type { BlendMode, LayerEffects, Layer, Rect } from '../../types';
import type { AdjustmentNodeType, AdjustmentNode } from '../../types/adjustment-nodes';
import type { AlignEdge } from '../../tools/move/move';
import { createRasterLayer, createGroupLayer } from '../../layers/layer-model';
import { createDefaultNode } from '../../filters/adjustment-node-utils';
import { createImageData } from '../../engine/color-space';
import { moveLayerToGroup as moveLayerToGroupUtil, getInsertionGroupId, getInsertionOrderIndex, addToGroup as addToGroupUtil, getDescendantIds as getDescendantIdsUtil, buildFlatDisplayList, findParentGroup, removeFromParentGroup } from '../../layers/group-utils';
import { sparseToImageData } from '../../engine/canvas-ops';
import { readLayerAsImageData } from '../../engine-wasm/gpu-pixel-access';
import { getEngine, clearEngine } from '../../engine-wasm/engine-state';
import { flushLayerSync } from '../../engine-wasm/engine-sync';
import { uploadLayerPixels, getLayerTextureDimensions, removeTextLayerState } from '../../engine-wasm/wasm-bridge';
import { invalidateBitmapCache } from '../../engine/bitmap-cache';
import { pixelDataManager } from '../../engine/pixel-data-manager';
import type { ActionResult, SliceCreator, SparseLayerEntry } from './types';
import { useUIStore } from '../ui-store';
import { cancelLiquify } from '../MenuBar/liquify-actions';
import { finalizePendingStrokeGlobal } from '../interactions/pending-stroke';

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
import { computeFitLayer } from './actions/fit-layer';
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

/** Merge dense + sparse + GPU pixel data into a single map for compute
 *  functions. Pulls from the PixelDataManager and falls back to GPU
 *  readback for layers that have no JS data. */
function resolveAllPixelData(
  layerIds?: readonly string[],
  layers?: readonly Layer[],
): Map<string, ImageData> {
  const merged = new Map(pixelDataManager.denseMap());
  for (const [id, entry] of pixelDataManager.sparseMap()) {
    if (!merged.has(id)) {
      merged.set(id, sparseToImageData(entry.sparse));
    }
  }
  if (layerIds) {
    for (const id of layerIds) {
      if (!merged.has(id)) {
        // Skip group layers — they have no GPU texture.
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

/** Apply an ActionResult: if it carries pixel data, push it to the manager;
 *  spread the remaining EditorState fields into the store. */
function applyActionResult(
  set: (partial: Partial<import('./types').EditorState>) => void,
  result: ActionResult,
): void {
  const { layerPixelData, sparseLayerData, ...storeDelta } = result;
  if (layerPixelData !== undefined || sparseLayerData !== undefined) {
    pixelDataManager.replace(
      layerPixelData ?? new Map(),
      sparseLayerData ?? new Map(),
    );
  }
  set(storeDelta);
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
  // Bump pixel versions after GPU upload so thumbnail reads happen after
  // data is on the GPU. The initial bump from pixelDataManager.replace()
  // fires before the upload, causing thumbnails to read empty textures.
  requestAnimationFrame(() => {
    for (const layerId of pixelData.keys()) {
      pixelDataManager.bumpVersion(layerId);
    }
  });
}

function createInitialDocument() {
  const bg = createRasterLayer({ name: 'Background', width: 800, height: 600 });
  const rootGroup = createGroupLayer({ name: 'Project', children: [bg.id] });
  const imgData = createImageData(800, 600);
  for (let i = 0; i < imgData.data.length; i += 4) {
    imgData.data[i] = 255;
    imgData.data[i + 1] = 255;
    imgData.data[i + 2] = 255;
    imgData.data[i + 3] = 255;
  }
  pixelDataManager.setDense(bg.id, imgData);
  return {
    id: crypto.randomUUID(),
    name: 'lopsy' as const,
    width: 800,
    height: 600,
    layers: [bg, rootGroup] as readonly Layer[],
    layerOrder: [bg.id, rootGroup.id] as readonly string[],
    activeLayerId: bg.id as string | null,
    selectedLayerIds: [bg.id] as readonly string[],
    backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
    rootGroupId: rootGroup.id as string | null,
    artboards: [] as readonly import('../../types/document').Artboard[],
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
  setLayerColorTag: (id: string, tag: import('../../types/layers').LayerColorTag | null) => void;
  addGroup: (name?: string) => void;
  toggleGroupCollapsed: (groupId: string) => void;
  moveLayerToGroup: (layerId: string, targetGroupId: string, insertIndex?: number) => void;
  setGroupAdjustmentsEnabled: (groupId: string, enabled: boolean) => void;
  addAdjustmentNode: (groupId: string, nodeType: AdjustmentNodeType) => void;
  removeAdjustmentNode: (groupId: string, nodeId: string) => void;
  updateAdjustmentNode: (groupId: string, nodeId: string, params: Partial<AdjustmentNode>) => void;
  toggleAdjustmentNode: (groupId: string, nodeId: string) => void;
  reorderAdjustmentNodes: (groupId: string, nodeIds: readonly string[]) => void;
  updateLayerOpacity: (id: string, opacity: number) => void;
  updateLayerBlendMode: (id: string, blendMode: BlendMode) => void;
  moveLayer: (fromIndex: number, toIndex: number) => void;
  updateLayerPosition: (id: string, x: number, y: number) => void;
  alignLayer: (edge: AlignEdge) => void;
  fitActiveLayerToCanvas: () => void;
  duplicateLayer: () => void;
  mergeDown: () => void;
  flattenImage: () => void;
  rasterizeLayerStyle: () => void;
  rasterizeTextLayer: () => void;
  updateLayerEffects: (id: string, effects: Partial<LayerEffects>) => void;
  addLayerMask: (id: string) => void;
  removeLayerMask: (id: string) => void;
  toggleLayerMask: (id: string) => void;
  updateLayerMaskData: (layerId: string, maskData: Uint8ClampedArray) => void;
  cropCanvas: (rect: Rect) => void;
  resizeCanvas: (newWidth: number, newHeight: number, anchorX: number, anchorY: number) => void;
  resizeImage: (newWidth: number, newHeight: number) => void;

  // Multi-select
  toggleLayerSelection: (id: string) => void;
  addLayerToSelection: (id: string) => void;
  setLayerSelection: (ids: string[]) => void;
  clearLayerSelection: () => void;
  selectLayerRange: (fromId: string, toId: string) => void;
  removeSelectedLayers: () => void;
  groupSelectedLayers: () => void;
}

export const createDocumentSlice: SliceCreator<DocumentSlice> = (set, get) => ({
  document: createInitialDocument(),
  documentReady: false,

  createDocument: (width, height, transparentBg) => {
    cancelLiquify();
    clearEngine();
    const result = computeCreateDocument(width, height, transparentBg);
    applyActionResult(set, result);
    set({ documentVersion: get().documentVersion + 1 });
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
    useUIStore.getState().clearGuides();
  },

  openImageAsDocument: (imageData, name) => {
    cancelLiquify();
    clearEngine();
    const result = computeOpenImage(imageData, name);
    applyActionResult(set, result);
    set({ documentVersion: get().documentVersion + 1 });
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
    useUIStore.getState().clearGuides();
  },

  addLayer: () => {
    finalizePendingStrokeGlobal();
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
    const result = computeRemoveLayer(
      s.document,
      pixelDataManager.denseMap() as Map<string, ImageData>,
      pixelDataManager.sparseMap() as Map<string, SparseLayerEntry>,
      id,
    );
    if (!result) return;

    // Clean up text renderer state if this was a text layer.
    const removedLayer = s.document.layers.find((l) => l.id === id);
    if (removedLayer?.type === 'text') {
      const eng = getEngine();
      if (eng) removeTextLayerState(eng, id);
    }

    s.pushHistory('Delete Layer');
    applyActionResult(set, result);
  },

  setActiveLayer: (id) => {
    finalizePendingStrokeGlobal();
    set(computeSetActiveLayer(get().document, id));
  },

  toggleLayerVisibility: (id) => {
    const s = get();
    s.pushHistory('Toggle Visibility');
    set(computeToggleVisibility(s.document, id));
  },

  // No history — lock state is ephemeral UI, not a document edit worth an undo step
  toggleLayerLock: (id) => {
    const doc = get().document;
    const layers = doc.layers.map((l) =>
      l.id === id ? { ...l, locked: !l.locked } : l,
    );
    set({ document: { ...doc, layers } });
  },

  // No history — renaming is lightweight metadata, not worth an undo step
  renameLayer: (id, name) => {
    const doc = get().document;
    const layers = doc.layers.map((l) =>
      l.id === id ? { ...l, name } : l,
    );
    set({ document: { ...doc, layers } });
  },

  // No history — color tag is visual organization metadata, not a pixel-level edit
  setLayerColorTag: (id, tag) => {
    const doc = get().document;
    const layers = doc.layers.map((l) =>
      l.id === id ? { ...l, colorTag: tag } : l,
    );
    set({ document: { ...doc, layers } });
  },

  // No history — group creation is cheap; undo would be confusing with empty groups
  addGroup: (name) => {
    const doc = get().document;
    const group = createGroupLayer({ name: name ?? 'Group' });
    let layers = [...doc.layers, group];
    const targetGroupId = getInsertionGroupId(doc.layers, doc.activeLayerId, doc.rootGroupId);
    if (targetGroupId) {
      layers = addToGroupUtil(layers, group.id, targetGroupId);
    }
    const orderIdx = getInsertionOrderIndex(doc.layerOrder, doc.activeLayerId, doc.rootGroupId, doc.layers);
    const layerOrder = [...doc.layerOrder];
    layerOrder.splice(orderIdx, 0, group.id);
    set({
      document: { ...doc, layers, layerOrder, activeLayerId: group.id, selectedLayerIds: [group.id] },
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

  // No history — reparenting is a panel drag operation, not a pixel-level edit
  moveLayerToGroup: (layerId, targetGroupId, insertIndex) => {
    const doc = get().document;
    const newLayers = moveLayerToGroupUtil(doc.layers, layerId, targetGroupId, insertIndex);

    // Collect all IDs to reposition (the layer + descendants if it's a group)
    const movedLayer = doc.layers.find((l) => l.id === layerId);
    const idsToMove = new Set([layerId]);
    if (movedLayer && movedLayer.type === 'group') {
      for (const id of getDescendantIdsUtil(doc.layers, layerId)) {
        idsToMove.add(id);
      }
    }

    // Preserve relative order of moved entries
    const movedEntries = doc.layerOrder.filter((id) => idsToMove.has(id));
    const newOrder = doc.layerOrder.filter((id) => !idsToMove.has(id));
    const groupIdx = newOrder.indexOf(targetGroupId);
    if (groupIdx !== -1) {
      newOrder.splice(groupIdx, 0, ...movedEntries);
    } else {
      newOrder.push(...movedEntries);
    }
    set({ document: { ...doc, layers: newLayers, layerOrder: newOrder } });
  },

  // No history — toggle is paired with adjustment actions which handle commit
  setGroupAdjustmentsEnabled: (groupId, enabled) => {
    const doc = get().document;
    const layers = doc.layers.map((l) =>
      l.id === groupId && l.type === 'group'
        ? { ...l, adjustmentsEnabled: enabled }
        : l,
    );
    set({ document: { ...doc, layers } });
  },

  // No history — node edits fire continuously; history is pushed on commit
  addAdjustmentNode: (groupId, nodeType) => {
    const doc = get().document;
    const node = createDefaultNode(nodeType);
    const layers = doc.layers.map((l) => {
      if (l.id !== groupId || l.type !== 'group') return l;
      // Pass-through groups bypass the group composite FBO, so adjustments
      // would be silently ignored. Switch to normal so the adjustment renders.
      const blendMode = l.blendMode === 'pass-through' ? 'normal' : l.blendMode;
      return { ...l, blendMode, adjustments: [...l.adjustments, node] };
    });
    set({ document: { ...doc, layers } });
  },

  removeAdjustmentNode: (groupId, nodeId) => {
    const doc = get().document;
    const layers = doc.layers.map((l) =>
      l.id === groupId && l.type === 'group'
        ? { ...l, adjustments: l.adjustments.filter((n) => n.id !== nodeId) }
        : l,
    );
    set({ document: { ...doc, layers } });
  },

  // No history — param sliders fire continuously; history is pushed on commit
  updateAdjustmentNode: (groupId, nodeId, params) => {
    const doc = get().document;
    const layers = doc.layers.map((l) => {
      if (l.id !== groupId || l.type !== 'group') return l;
      const adjustments = l.adjustments.map((n) =>
        n.id === nodeId ? ({ ...n, ...params } as AdjustmentNode) : n,
      );
      return { ...l, adjustments };
    });
    set({ document: { ...doc, layers } });
  },

  toggleAdjustmentNode: (groupId, nodeId) => {
    const doc = get().document;
    const layers = doc.layers.map((l) => {
      if (l.id !== groupId || l.type !== 'group') return l;
      const adjustments = l.adjustments.map((n) =>
        n.id === nodeId ? ({ ...n, enabled: !n.enabled } as AdjustmentNode) : n,
      );
      return { ...l, adjustments };
    });
    set({ document: { ...doc, layers } });
  },

  reorderAdjustmentNodes: (groupId, nodeIds) => {
    const doc = get().document;
    const layers = doc.layers.map((l) => {
      if (l.id !== groupId || l.type !== 'group') return l;
      const nodeMap = new Map(l.adjustments.map((n) => [n.id, n]));
      const adjustments = nodeIds
        .map((id) => nodeMap.get(id))
        .filter((n): n is AdjustmentNode => n !== undefined);
      return { ...l, adjustments };
    });
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
    finalizePendingStrokeGlobal();
    const s = get();
    const sparseIds = [...pixelDataManager.sparseMap().keys()];
    const result = computeAlignLayer(
      s.document,
      resolveAllPixelData(s.document.layerOrder, s.document.layers),
      s.selection, s.renderVersion, edge,
    );
    if (!result) return;
    s.pushHistory('Align Layer');
    applyActionResult(set, result);
    for (const id of sparseIds) get().cropLayerToContent(id);
  },

  fitActiveLayerToCanvas: () => {
    finalizePendingStrokeGlobal();
    const s = get();
    const result = computeFitLayer(s.document, s.renderVersion);
    if (!result) return;
    s.pushHistory('Fit Layer to Canvas');
    applyActionResult(set, result);
  },

  duplicateLayer: () => {
    const s = get();
    const sparseIds = [...pixelDataManager.sparseMap().keys()];
    const result = computeDuplicateLayer(
      s.document,
      resolveAllPixelData(s.document.layerOrder, s.document.layers),
    );
    if (!result) return;
    s.pushHistory('Duplicate Layer');
    applyActionResult(set, result);
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
    for (const id of sparseIds) get().cropLayerToContent(id);
  },

  mergeDown: () => {
    const s = get();
    flushLayerSync(s);
    const sparseIds = [...pixelDataManager.sparseMap().keys()];
    const result = computeMergeDown(
      s.document,
      resolveAllPixelData(s.document.layerOrder, s.document.layers),
    );
    if (!result) return;
    s.pushHistory('Merge Down');
    applyActionResult(set, result);
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
    for (const id of sparseIds) get().cropLayerToContent(id);
  },

  flattenImage: () => {
    const s = get();
    flushLayerSync(s);
    const result = computeFlattenImage(
      s.document,
      resolveAllPixelData(s.document.layerOrder, s.document.layers),
    );
    if (!result) return;
    s.pushHistory('Flatten Image');
    applyActionResult(set, result);
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
  },

  rasterizeLayerStyle: () => {
    const s = get();
    flushLayerSync(s);
    const sparseIds = [...pixelDataManager.sparseMap().keys()];
    const result = computeRasterizeStyle(
      s.document,
      resolveAllPixelData(s.document.layerOrder, s.document.layers),
    );
    if (!result) return;
    s.pushHistory('Rasterize Layer Style');
    applyActionResult(set, result);
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
    for (const id of sparseIds) get().cropLayerToContent(id);
  },

  rasterizeTextLayer: () => {
    const s = get();
    const activeId = s.document.activeLayerId;
    if (!activeId) return;
    const layer = s.document.layers.find((l) => l.id === activeId);
    if (!layer || layer.type !== 'text') return;

    const engine = getEngine();
    if (!engine) return;

    const dims = getLayerTextureDimensions(engine, activeId);
    const w = dims[0] ?? 0;
    const h = dims[1] ?? 0;
    if (w === 0 || h === 0) return;

    s.pushHistory('Rasterize Layer');

    // Convert the text layer to raster. The GPU texture already has the
    // rendered text pixels — no re-upload needed. Just update the Zustand
    // state so the compositor and all pipeline code treat this as a raster
    // layer going forward.
    set({
      document: {
        ...s.document,
        layers: s.document.layers.map((l) =>
          l.id === activeId
            ? {
                id: l.id,
                name: l.name,
                type: 'raster' as const,
                visible: l.visible,
                locked: l.locked,
                opacity: l.opacity,
                blendMode: l.blendMode,
                x: l.x,
                y: l.y,
                clipToBelow: l.clipToBelow,
                effects: l.effects,
                mask: l.mask,
                width: w,
                height: h,
              }
            : l,
        ),
      },
      renderVersion: s.renderVersion + 1,
    });
  },

  updateLayerEffects: (id: string, effects, skipHistory?: boolean) => {
    finalizePendingStrokeGlobal();
    const s = get();
    if (!skipHistory) s.pushHistory('Edit Effect');
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
    const result = computeCropCanvas(
      s.document,
      resolveAllPixelData(s.document.layerOrder, s.document.layers),
      s.renderVersion, rect,
    );
    if (result) {
      applyActionResult(set, result);
      if (result.layerPixelData && result.document) {
        syncPixelDataToGpu(result.layerPixelData, result.document.layers);
      }
    }
  },

  resizeCanvas: (newWidth, newHeight, anchorX, anchorY) => {
    const s = get();
    s.pushHistory('Resize Canvas');
    const result = computeResizeCanvas(
      s.document,
      resolveAllPixelData(s.document.layerOrder, s.document.layers),
      s.renderVersion, newWidth, newHeight, anchorX, anchorY,
    );
    applyActionResult(set, result);
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
  },

  resizeImage: (newWidth, newHeight) => {
    const s = get();
    s.pushHistory('Resize Image');
    const result = computeResizeImage(
      s.document,
      resolveAllPixelData(s.document.layerOrder, s.document.layers),
      s.renderVersion, newWidth, newHeight,
    );
    applyActionResult(set, result);
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
  },

  toggleLayerSelection: (id) => {
    const doc = get().document;
    const current = doc.selectedLayerIds;
    const isSelected = current.includes(id);
    const next = isSelected
      ? current.filter((sid) => sid !== id)
      : [...current, id];
    // Ensure at least the active layer remains selected
    const activeId = doc.activeLayerId;
    const finalIds = activeId && !next.includes(activeId) ? [activeId, ...next] : next;
    set({ document: { ...doc, selectedLayerIds: finalIds } });
  },

  addLayerToSelection: (id) => {
    const doc = get().document;
    if (doc.selectedLayerIds.includes(id)) return;
    set({ document: { ...doc, selectedLayerIds: [...doc.selectedLayerIds, id] } });
  },

  setLayerSelection: (ids) => {
    const doc = get().document;
    set({ document: { ...doc, selectedLayerIds: ids } });
  },

  clearLayerSelection: () => {
    const doc = get().document;
    const activeId = doc.activeLayerId;
    set({ document: { ...doc, selectedLayerIds: activeId ? [activeId] : [] } });
  },

  selectLayerRange: (fromId, toId) => {
    const doc = get().document;
    const displayList = buildFlatDisplayList(doc.layers, doc.layerOrder);
    const ids = displayList.map((e) => e.layer.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) {
      set({ document: { ...doc, selectedLayerIds: [toId] } });
      return;
    }
    const start = Math.min(fromIdx, toIdx);
    const end = Math.max(fromIdx, toIdx);
    const rangeIds = ids.slice(start, end + 1);
    set({ document: { ...doc, selectedLayerIds: rangeIds } });
  },

  removeSelectedLayers: () => {
    const s = get();
    const doc = s.document;
    const toRemove = doc.selectedLayerIds.filter(
      (id) => id !== doc.rootGroupId,
    );
    if (toRemove.length === 0) return;
    s.pushHistory('Delete Layers');
    let currentDoc = doc;
    for (const id of toRemove) {
      const result = computeRemoveLayer(
        currentDoc,
        pixelDataManager.denseMap() as Map<string, ImageData>,
        pixelDataManager.sparseMap() as Map<string, SparseLayerEntry>,
        id,
      );
      if (!result || !result.document) continue;
      currentDoc = result.document as typeof doc;
    }
    const activeId = currentDoc.activeLayerId;
    set({
      document: {
        ...currentDoc,
        selectedLayerIds: activeId ? [activeId] : [],
      },
    });
  },

  groupSelectedLayers: () => {
    const s = get();
    const doc = s.document;
    const idsToGroup = doc.selectedLayerIds.filter(
      (id) => id !== doc.rootGroupId,
    );
    if (idsToGroup.length < 2) {
      s.addGroup();
      return;
    }

    const displayList = buildFlatDisplayList(doc.layers, doc.layerOrder);
    // Preserve visual order (top→bottom in panel)
    const orderedIds = displayList
      .map((e) => e.layer.id)
      .filter((id) => idsToGroup.includes(id));

    const group = createGroupLayer({
      name: 'Group',
      children: [...orderedIds],
    });

    // Find the parent group to add the new group into
    const firstId = orderedIds[0]!;
    const parentGroup = findParentGroup(doc.layers, firstId);
    const targetGroupId = parentGroup?.id ?? doc.rootGroupId ?? null;

    // Remove selected layers from their current parents BEFORE adding the
    // group — otherwise removeFromParentGroup also strips children from
    // the newly created group.
    let newLayers = [...doc.layers];
    for (const id of orderedIds) {
      newLayers = removeFromParentGroup(newLayers, id);
    }
    newLayers = [...newLayers, group];
    if (targetGroupId) {
      newLayers = addToGroupUtil(newLayers, group.id, targetGroupId);
    }

    // Rebuild layerOrder: strip out grouped IDs, insert block before target group
    const toGroupSet = new Set(orderedIds);
    const filteredOrder = doc.layerOrder.filter((id) => !toGroupSet.has(id));
    const targetIdx = targetGroupId ? filteredOrder.indexOf(targetGroupId) : filteredOrder.length;
    const insertAt = targetIdx !== -1 ? targetIdx : filteredOrder.length;
    const newOrder = [
      ...filteredOrder.slice(0, insertAt),
      ...orderedIds,
      group.id,
      ...filteredOrder.slice(insertAt),
    ];

    s.pushHistory('Group Layers');
    set({
      document: {
        ...doc,
        layers: newLayers,
        layerOrder: newOrder,
        activeLayerId: group.id,
        selectedLayerIds: [group.id],
      },
    });
  },
});
