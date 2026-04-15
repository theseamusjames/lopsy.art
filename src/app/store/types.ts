import type { StateCreator } from 'zustand';
import type { BlendMode, DocumentState, LayerEffects, Rect, TextLayer, ViewportState } from '../../types';
import type { StoredPath } from '../../types/paths';
import type { PathAnchor } from '../../tools/path/path';
import type { AlignEdge } from '../../tools/move/move';

export interface SelectionData {
  active: boolean;
  bounds: Rect | null;
  mask: Uint8ClampedArray | null;
  maskWidth: number;
  maskHeight: number;
}

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
  /** Stable id used by the History Brush tool to pin a source across
   *  new pushes and undo/redo. Every snapshot gets one at creation. */
  id: string;
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
  layerPixelData: Map<string, ImageData>;
  sparseLayerData: Map<string, SparseLayerEntry>;
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
  /** Stable id for the "Original" (blank) snapshot row in the history panel. */
  originSnapshotId: string;
  dirtyLayerIds: Set<string>;
  renderVersion: number;
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

  // Selection
  setSelection: (bounds: Rect, mask: Uint8ClampedArray, maskWidth: number, maskHeight: number) => void;
  clearSelection: () => void;

  // Clipboard
  copy: () => void;
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
