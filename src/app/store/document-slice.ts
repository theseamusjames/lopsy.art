import type { BlendMode, LayerEffects, Layer, Rect, DocumentColorMode } from '../../types';
import type { AdjustmentNodeType, AdjustmentNode } from '../../types/adjustment-nodes';
import type { AlignEdge } from '../../tools/move/move';
import { createRasterLayer, createGroupLayer } from '../../layers/layer-model';
import { createDefaultNode, createDefaultAdjustments } from '../../filters/adjustment-node-utils';
import { createImageData } from '../../engine/color-space';
import { moveLayerToGroup as moveLayerToGroupUtil, getInsertionGroupId, getInsertionOrderIndex, addToGroup as addToGroupUtil, getDescendantIds as getDescendantIdsUtil, buildFlatDisplayList, findParentGroup, removeFromParentGroup } from '../../layers/group-utils';
import { sparseToImageData } from '../../engine/canvas-ops';
import { readLayerAsImageData } from '../../engine-wasm/gpu-pixel-access';
import { getEngine, clearEngine } from '../../engine-wasm/engine-state';
import { flushLayerSync } from '../../engine-wasm/engine-sync';
import { uploadLayerPixels, getLayerTextureDimensions, getLayerEngineBounds, removeTextLayerState } from '../../engine-wasm/wasm-bridge';
import { invalidateBitmapCache, clearBitmapCache } from '../../engine/bitmap-cache';
import { pixelDataManager } from '../../engine/pixel-data-manager';
import type { ActionResult, SliceCreator, SparseLayerEntry } from './types';
import type { IndexedConversionOptions } from './actions/convert-color-mode';
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
import { resolveRasterTextBounds } from './actions/resolve-raster-text-bounds';
import { computeCropCanvas } from './actions/crop-canvas';
import { computeResizeCanvas } from './actions/resize-canvas';
import { computeResizeImage } from './actions/resize-image';
import { computeConvertColorMode, layersWithPixels, paletteFromBytes, paletteToBytes } from './actions/convert-color-mode';
import { colorModeLabel, convertColorToDocMode } from '../../utils/color-mode';
import { getColorModeCapabilities } from '../../utils/color-mode-capabilities';
import { notifyInfo } from '../notifications-store';
import { convertLayerToGrayscale, quantizeCompositeToPalette, applyPaletteToLayer, convertLayerToLab, convertLayerFromLab } from '../../engine-wasm/wasm-bridge';
import { useToolSettingsStore } from '../tool-settings-store';
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
  // removedLayerIds is metadata for engine-side cleanup; the caller drives
  // those side effects before calling applyActionResult. Strip it so it
  // doesn't leak into the store state via the spread below.
  const { layerPixelData, sparseLayerData, removedLayerIds: _removedLayerIds, ...storeDelta } = result;
  if (layerPixelData !== undefined || sparseLayerData !== undefined) {
    pixelDataManager.replace(
      layerPixelData ?? new Map(),
      sparseLayerData ?? new Map(),
    );
  }
  set(storeDelta);
}

/**
 * Drop engine-side state held for every removed layer that was a text
 * layer. The Rust engine keeps a HashMap<String, TextLayerState> keyed
 * by layer id; entries linger if we forget to evict them on delete.
 * The document still has the pre-delete layer list (`doc`), so type
 * lookup is exact.
 */
function cleanupRemovedTextLayers(doc: { readonly layers: readonly Layer[] }, removedIds: readonly string[]): void {
  if (removedIds.length === 0) return;
  const eng = getEngine();
  if (!eng) return;
  for (const id of removedIds) {
    const layer = doc.layers.find((l) => l.id === id);
    if (layer?.type === 'text') {
      removeTextLayerState(eng, id);
    }
  }
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

/**
 * Indexed documents are a single flattened, palette-constrained surface
 * (Photoshop parity), so every layer-creating action is refused while that
 * mode is active. Returns true when the action may proceed.
 */
function allowLayerCreation(doc: { readonly colorMode: DocumentColorMode }): boolean {
  if (getColorModeCapabilities(doc.colorMode).canAddLayers) return true;
  notifyInfo(`${colorModeLabel(doc.colorMode)} mode does not support layers. Convert to RGB first.`);
  return false;
}

function createInitialDocument() {
  const bg = createRasterLayer({ name: 'Background', width: 800, height: 600 });
  const rootGroup = createGroupLayer({ name: 'Project', children: [bg.id], adjustments: createDefaultAdjustments() });
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
    colorMode: 'rgb' as DocumentColorMode,
    rootGroupId: rootGroup.id as string | null,
  };
}

export interface DocumentSlice {
  document: ReturnType<typeof createInitialDocument>;
  documentReady: boolean;
  createDocument: (width: number, height: number, transparentBg: boolean, colorMode?: DocumentColorMode) => void;
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
  convertColorMode: (newMode: DocumentColorMode, options?: IndexedConversionOptions) => void;

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

  createDocument: (width, height, transparentBg, colorMode) => {
    cancelLiquify();
    clearBitmapCache();
    clearEngine();
    const result = computeCreateDocument(width, height, transparentBg, colorMode);
    applyActionResult(set, result);
    // clearEngine() released the GPU clipboard texture; drop the stale JS
    // clipboard so a subsequent paste doesn't operate on a freed texture.
    set({ documentVersion: get().documentVersion + 1, clipboard: null });
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
    useUIStore.getState().clearGuides();
    get().fitToView();
  },

  openImageAsDocument: (imageData, name) => {
    cancelLiquify();
    clearBitmapCache();
    clearEngine();
    const result = computeOpenImage(imageData, name);
    applyActionResult(set, result);
    // See createDocument: the GPU clipboard texture is gone after clearEngine().
    set({ documentVersion: get().documentVersion + 1, clipboard: null });
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
    }
    useUIStore.getState().clearGuides();
  },

  addLayer: () => {
    finalizePendingStrokeGlobal();
    const s = get();
    if (!allowLayerCreation(s.document)) return;
    const result = computeAddLayer(s.document);
    if (!result) return;
    s.pushHistoryMetadata('Add Layer');
    set(result);
  },

  addTextLayer: (layer) => {
    const s = get();
    const result = computeAddTextLayer(s.document, layer);
    if (!result) return;
    s.pushHistoryMetadata('Add Text Layer');
    set(result);
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

    // Clean up text renderer state for every removed layer — when `id`
    // points to a group, every text descendant is gone too.
    cleanupRemovedTextLayers(s.document, result.removedLayerIds ?? []);

    // Close any cached ImageBitmap for every layer that's about to vanish.
    // Use result.removedLayerIds so the descendant walk for groups is the
    // same one computeRemoveLayer already did — and so we don't reference
    // a removedLayer variable that #478 dropped when introducing the
    // cleanupRemovedTextLayers helper above.
    for (const descId of result.removedLayerIds ?? [id]) {
      invalidateBitmapCache(descId);
      pixelDataManager.dropLayer(descId);
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
    s.pushHistoryMetadata('Toggle Visibility');
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
    if (!allowLayerCreation(doc)) return;
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
    const result = computeMoveLayer(s.document, s.renderVersion, fromIndex, toIndex);
    if (!result) return;
    s.pushHistoryMetadata('Reorder Layer');
    set(result);
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
    if (!allowLayerCreation(s.document)) return;
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
    const engineBounds = getLayerEngineBounds(engine, activeId);
    const bounds = resolveRasterTextBounds(
      engineBounds,
      layer.x,
      layer.y,
      dims[0] ?? 0,
      dims[1] ?? 0,
    );
    if (!bounds) return;

    s.pushHistory('Rasterize Layer');
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
                x: bounds.x,
                y: bounds.y,
                clipToBelow: l.clipToBelow,
                effects: l.effects,
                mask: l.mask,
                width: bounds.width,
                height: bounds.height,
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
    if (!skipHistory) s.pushHistoryMetadata('Edit Effect');
    set(computeUpdateEffects(s.document, s.renderVersion, id, effects));
  },

  addLayerMask: (id) => {
    const s = get();
    const result = computeAddLayerMask(s.document, s.renderVersion, id);
    if (!result) return;
    s.pushHistoryMetadata('Add Mask');
    set(result);
  },

  removeLayerMask: (id) => {
    const s = get();
    const result = computeRemoveLayerMask(s.document, s.renderVersion, id);
    if (!result) return;
    s.pushHistoryMetadata('Remove Mask');
    set(result);
  },

  toggleLayerMask: (id) => {
    const s = get();
    const result = computeToggleMask(s.document, s.renderVersion, id);
    if (!result) return;
    s.pushHistoryMetadata('Toggle Mask');
    set(result);
  },

  updateLayerMaskData: (layerId, maskData) => {
    set(computeUpdateMaskData(get().document, get().renderVersion, layerId, maskData));
  },

  cropCanvas: (rect) => {
    const s = get();
    const doc = s.document;
    const x1 = Math.max(0, Math.round(rect.x));
    const y1 = Math.max(0, Math.round(rect.y));
    const x2 = Math.min(doc.width, Math.round(rect.x + rect.width));
    const y2 = Math.min(doc.height, Math.round(rect.y + rect.height));
    if (x2 - x1 <= 0 || y2 - y1 <= 0) return;
    s.pushHistory('Crop Canvas');
    const result = computeCropCanvas(
      doc,
      resolveAllPixelData(doc.layerOrder, doc.layers),
      s.renderVersion, rect,
    );
    if (!result) return;
    applyActionResult(set, result);
    if (result.layerPixelData && result.document) {
      syncPixelDataToGpu(result.layerPixelData, result.document.layers);
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

  convertColorMode: (newMode, options) => {
    const s = get();
    if (s.document.colorMode === newMode) return;

    // Bake in-flight strokes into layer textures first, then snapshot — the
    // conversion overwrites those textures in place, so history must capture
    // the pre-bake pixels.
    flushLayerSync(s);
    s.pushHistory(`Convert to ${colorModeLabel(newMode)}`);

    // Indexed is a single flat palette-constrained surface, so the layer stack
    // collapses before quantizing. This runs under the snapshot above, making
    // flatten + convert one undo step. Flattening goes through the export
    // compositor, which already decodes native modes — so the flattened layer
    // is plain sRGB and must not be decoded again below.
    let doc = s.document;
    let pixelsAreEncoded = doc.colorMode === 'lab';
    if (newMode === 'indexed') {
      const flattened = computeFlattenImage(doc, resolveAllPixelData(doc.layerOrder, doc.layers));
      if (flattened?.document) {
        applyActionResult(set, flattened);
        doc = flattened.document;
        pixelsAreEncoded = false;
      }
    }

    const result = computeConvertColorMode(doc, newMode);
    if (!result?.document) return;
    let nextDocument = result.document;

    const engine = getEngine();
    if (engine) {
      const palette =
        newMode === 'indexed'
          ? paletteFromBytes(quantizeCompositeToPalette(engine, options?.maxColors ?? 256))
          : undefined;
      if (palette) {
        nextDocument = { ...nextDocument, indexedPalette: palette };
      }
      const paletteBytes = palette ? paletteToBytes(palette) : undefined;

      const dirtyIds = new Set(s.dirtyLayerIds);
      for (const id of layersWithPixels(doc)) {
        // Decode out of the old mode before encoding into the new one, so a
        // bake never runs on values from the previous color space.
        if (pixelsAreEncoded) convertLayerFromLab(engine, id);
        if (newMode === 'grayscale') convertLayerToGrayscale(engine, id);
        if (newMode === 'lab') convertLayerToLab(engine, id);
        if (paletteBytes) applyPaletteToLayer(engine, id, paletteBytes, options?.dither ?? false);
        // GPU is now source of truth — drop stale JS pixel data.
        invalidateBitmapCache(id);
        pixelDataManager.remove(id);
        dirtyIds.add(id);
      }
      set({ dirtyLayerIds: dirtyIds });
    }

    applyActionResult(set, { ...result, document: nextDocument });

    // Keep the toolbox swatches in the document's value space so the next
    // stroke's color matches what the picker shows.
    const ts = useToolSettingsStore.getState();
    const palette = nextDocument.indexedPalette;
    ts.setForegroundColor(convertColorToDocMode(ts.foregroundColor, newMode, palette));
    ts.setBackgroundColor(convertColorToDocMode(ts.backgroundColor, newMode, palette));

    s.notifyRender();
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

    // Close cached ImageBitmaps for every layer that's about to vanish —
    // walk the pre-delete doc so descendants of groups are reachable.
    for (const id of toRemove) {
      const layer = doc.layers.find((l) => l.id === id);
      invalidateBitmapCache(id);
      if (layer && layer.type === 'group') {
        for (const descId of getDescendantIdsUtil(doc.layers, id)) {
          invalidateBitmapCache(descId);
        }
      }
    }

    let currentDoc = doc;
    // Accumulate every removed id across the per-selection iterations so
    // we can run engine-side text-layer cleanup once at the end, against
    // the pre-delete document (text-layer type is only knowable there).
    const allRemovedIds: string[] = [];
    for (const id of toRemove) {
      const result = computeRemoveLayer(
        currentDoc,
        pixelDataManager.denseMap() as Map<string, ImageData>,
        pixelDataManager.sparseMap() as Map<string, SparseLayerEntry>,
        id,
      );
      if (!result || !result.document) continue;
      currentDoc = result.document as typeof doc;
      if (result.removedLayerIds) allRemovedIds.push(...result.removedLayerIds);
    }
    cleanupRemovedTextLayers(doc, allRemovedIds);
    for (const removedId of allRemovedIds) {
      invalidateBitmapCache(removedId);
      pixelDataManager.dropLayer(removedId);
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

    s.pushHistoryMetadata('Group Layers');
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
