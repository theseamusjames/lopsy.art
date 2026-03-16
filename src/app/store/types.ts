import type { StateCreator } from 'zustand';
import type { DocumentState, LayerEffects, Rect, ViewportState } from '../../types';
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

export interface HistorySnapshot {
  document: DocumentState;
  layerPixelData: Map<string, ImageData>;
  layerCropInfo: Map<string, CropInfo>;
  label: string;
}

export interface ClipboardData {
  imageData: ImageData;
  offsetX: number;
  offsetY: number;
}

export interface EditorState {
  document: DocumentState;
  viewport: ViewportState;
  layerPixelData: Map<string, ImageData>;
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
  dirtyLayerIds: Set<string>;
  renderVersion: number;
  selection: SelectionData;
  documentReady: boolean;
  isDirty: boolean;
  clipboard: ClipboardData | null;

  // Document creation
  createDocument: (width: number, height: number, transparentBg: boolean) => void;
  openImageAsDocument: (imageData: ImageData, name: string) => void;

  // Document mutations
  addLayer: () => void;
  removeLayer: (id: string) => void;
  setActiveLayer: (id: string) => void;
  toggleLayerVisibility: (id: string) => void;
  updateLayerOpacity: (id: string, opacity: number) => void;
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

  // Pixel data
  getOrCreateLayerPixelData: (layerId: string) => ImageData;
  updateLayerPixelData: (layerId: string, data: ImageData) => void;
  notifyRender: () => void;
  cropLayerToContent: (layerId: string) => void;
  expandLayerForEditing: (layerId: string) => ImageData;

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
