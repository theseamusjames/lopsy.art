import type { StateCreator } from 'zustand';
import type { BlendMode, DocumentState, LayerEffects, Rect, TextLayer, ViewportState } from '../../types';
import type { StoredPath } from '../../types/paths';
import type { PathAnchor } from '../../tools/path/path';
import type { AlignEdge } from '../../tools/move/move';

/**
 * Selection state — discriminated by `active`. When inactive, every
 * companion field is structurally null/zero so callers cannot read mask
 * data without first narrowing. When active, bounds + mask + dimensions
 * are guaranteed non-null. Replaces the previous shape that allowed
 * `active: true; mask: null` as a representable bug.
 */
export type SelectionData =
  | {
      readonly active: false;
      readonly bounds: null;
      readonly mask: null;
      readonly maskWidth: 0;
      readonly maskHeight: 0;
    }
  | {
      readonly active: true;
      readonly bounds: Rect;
      readonly mask: Uint8ClampedArray;
      readonly maskWidth: number;
      readonly maskHeight: number;
    };

export const EMPTY_SELECTION: SelectionData = {
  active: false,
  bounds: null,
  mask: null,
  maskWidth: 0,
  maskHeight: 0,
};

export interface CropInfo {
  x: number;
  y: number;
  fullWidth: number;
  fullHeight: number;
}

export interface SparseLayerEntry {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly sparse: import('../../engine/canvas-ops').SparsePixelData;
}

export interface HistorySnapshot {
  document: DocumentState;
  /** Compressed GPU pixel snapshots per layer (RLE-encoded RGBA blobs). */
  gpuSnapshots: Map<string, Uint8Array>;
  /** Legacy CPU pixel data — kept for backward compat during transition. */
  layerPixelData: Map<string, ImageData>;
  layerCropInfo: Map<string, CropInfo>;
  sparseLayerData: Map<string, SparseLayerEntry>;
  label: string;
  /** When true, only document metadata changed (effects, opacity, etc.) —
   *  pixel data maps are empty and should not replace current pixel state. */
  metadataOnly: boolean;
}

export interface ClipboardData {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  gpuResident: true;
}

export interface EditorState {
  document: DocumentState;
  viewport: ViewportState;
  // layerPixelData + sparseLayerData live in the PixelDataManager
  // (src/engine/pixel-data-manager.ts), not the store. See pixel-data-slice.
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
  dirtyLayerIds: Set<string>;
  renderVersion: number;
  documentVersion: number;
  selection: SelectionData;
  documentReady: boolean;
  isDirty: boolean;
  clipboard: ClipboardData | null;

  // Paths
  paths: StoredPath[];
  selectedPathId: string | null;
  addPath: (anchors: readonly PathAnchor[], closed: boolean) => void;
  removePath: (id: string) => void;
  selectPath: (id: string | null) => void;
  renamePath: (id: string, name: string) => void;
  updatePathAnchors: (id: string, anchors: readonly PathAnchor[], closed: boolean) => void;

  // Document creation
  createDocument: (width: number, height: number, transparentBg: boolean) => void;
  openImageAsDocument: (imageData: ImageData, name: string) => void;

  // Document mutations
  addLayer: () => void;
  addTextLayer: (layer: TextLayer) => void;
  updateTextLayerProperties: (id: string, props: Partial<Omit<TextLayer, 'id' | 'type'>>) => void;
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
  addAdjustmentNode: (groupId: string, nodeType: import('../../types/adjustment-nodes').AdjustmentNodeType) => void;
  removeAdjustmentNode: (groupId: string, nodeId: string) => void;
  updateAdjustmentNode: (groupId: string, nodeId: string, params: Partial<import('../../types/adjustment-nodes').AdjustmentNode>) => void;
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
  updateLayerEffects: (id: string, effects: Partial<LayerEffects>, skipHistory?: boolean) => void;
  addLayerMask: (id: string) => void;
  removeLayerMask: (id: string) => void;
  toggleLayerMask: (id: string) => void;
  updateLayerMaskData: (layerId: string, maskData: Uint8ClampedArray) => void;

  // Multi-select
  toggleLayerSelection: (id: string) => void;
  addLayerToSelection: (id: string) => void;
  setLayerSelection: (ids: string[]) => void;
  clearLayerSelection: () => void;
  selectLayerRange: (fromId: string, toId: string) => void;
  removeSelectedLayers: () => void;
  groupSelectedLayers: () => void;

  // Selection
  setSelection: (bounds: Rect, mask: Uint8ClampedArray, maskWidth: number, maskHeight: number) => void;
  clearSelection: () => void;

  // Clipboard
  copy: () => void;
  copyMerged: () => void;
  cut: () => void;
  paste: () => void;
  pasteImageData: (imageData: ImageData) => void;
  pasteGpuLayer: (layerId: string, width: number, height: number) => void;

  // Pixel data
  getOrCreateLayerPixelData: (layerId: string) => ImageData;
  updateLayerPixelData: (layerId: string, data: ImageData) => void;
  notifyRender: () => void;
  cropLayerToContent: (layerId: string) => void;
  expandLayerForEditing: (layerId: string) => ImageData;
  resolvePixelData: (layerId: string) => ImageData | undefined;

  // Canvas
  cropCanvas: (rect: Rect) => void;
  resizeCanvas: (newWidth: number, newHeight: number, anchorX: number, anchorY: number) => void;
  resizeImage: (newWidth: number, newHeight: number) => void;

  // Viewport
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setViewportSize: (width: number, height: number) => void;
  fitToView: () => void;

  // History
  undo: () => void;
  redo: () => void;
  pushHistory: (label?: string) => void;
  markClean: () => void;
}

export type SliceCreator<T> = StateCreator<EditorState, [], [], T>;

/**
 * Shape returned by `compute*` action helpers. Most of them build both a
 * store state delta AND new pixel-data maps; the Maps no longer live in
 * the store (they're in PixelDataManager), so callers extract the pixel
 * fields, push them to the manager, and spread the remaining EditorState
 * delta into `set()`.
 */
export type ActionResult = Partial<EditorState> & {
  layerPixelData?: Map<string, ImageData>;
  sparseLayerData?: Map<string, SparseLayerEntry>;
};
