import { create } from 'zustand';
import type { DocumentState, Layer, LayerEffects, LayerMask, Rect, RasterLayer, ViewportState } from '../types';
import { compositeOver } from '../engine/compositing';
import { computeAlign, getContentBounds, type AlignEdge } from '../tools/move/move';

interface SelectionData {
  active: boolean;
  bounds: Rect | null;
  mask: Uint8ClampedArray | null;
  maskWidth: number;
  maskHeight: number;
}

interface HistorySnapshot {
  document: DocumentState;
  layerPixelData: Map<string, ImageData>;
  label: string;
}

function cloneImageData(data: ImageData): ImageData {
  const copy = new ImageData(data.width, data.height);
  copy.data.set(data.data);
  return copy;
}

function clonePixelDataMap(
  current: Map<string, ImageData>,
  dirtyIds: Set<string>,
  previous: HistorySnapshot | undefined,
): Map<string, ImageData> {
  const clone = new Map<string, ImageData>();
  for (const [id, data] of current) {
    if (dirtyIds.has(id) || !previous?.layerPixelData.has(id)) {
      // Layer was modified or is new — deep clone
      clone.set(id, cloneImageData(data));
    } else {
      // Layer unchanged — share reference (structural sharing)
      clone.set(id, previous.layerPixelData.get(id)!);
    }
  }
  return clone;
}

function clonePixelDataMapFull(map: Map<string, ImageData>): Map<string, ImageData> {
  const clone = new Map<string, ImageData>();
  for (const [id, data] of map) {
    clone.set(id, cloneImageData(data));
  }
  return clone;
}

interface ClipboardData {
  imageData: ImageData;
  offsetX: number;
  offsetY: number;
}

interface EditorState {
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

  // Canvas
  cropCanvas: (rect: Rect) => void;
  resizeCanvas: (newWidth: number, newHeight: number, anchorX: number, anchorY: number) => void;
  resizeImage: (newWidth: number, newHeight: number) => void;

  // Viewport
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setViewportSize: (width: number, height: number) => void;

  // History
  undo: () => void;
  redo: () => void;
  pushHistory: (label?: string) => void;
  markClean: () => void;
}

const DEFAULT_EFFECTS: LayerEffects = {
  stroke: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 }, width: 2, position: 'outside' },
  dropShadow: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0.75 }, offsetX: 4, offsetY: 4, blur: 8, spread: 0 },
  outerGlow: { enabled: false, color: { r: 255, g: 255, b: 100, a: 1 }, size: 10, spread: 0, opacity: 0.75 },
  innerGlow: { enabled: false, color: { r: 255, g: 255, b: 100, a: 1 }, size: 10, spread: 0, opacity: 0.75 },
};

function generateId(): string {
  return crypto.randomUUID();
}

function createDefaultLayer(): RasterLayer {
  return {
    id: generateId(),
    name: 'Background',
    type: 'raster',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    clipToBelow: false,
    effects: DEFAULT_EFFECTS,
    mask: null,
    width: 800,
    height: 600,
  };
}

function createInitialDocument(): DocumentState {
  const bg = createDefaultLayer();
  return {
    id: generateId(),
    name: 'Untitled',
    width: 800,
    height: 600,
    layers: [bg],
    layerOrder: [bg.id],
    activeLayerId: bg.id,
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
  };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  document: createInitialDocument(),
  viewport: {
    zoom: 1,
    panX: 0,
    panY: 0,
    width: 0,
    height: 0,
  },
  layerPixelData: new Map(),
  undoStack: [],
  redoStack: [],
  dirtyLayerIds: new Set(),
  renderVersion: 0,
  selection: { active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 },
  documentReady: false,
  isDirty: false,
  clipboard: null,

  createDocument: (width: number, height: number, transparentBg: boolean) => {
    const bgLayer: RasterLayer = {
      id: generateId(),
      name: 'Background',
      type: 'raster',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      clipToBelow: false,
      effects: DEFAULT_EFFECTS,
      mask: null,
      width,
      height,
    };
    const bgColor = transparentBg
      ? { r: 0, g: 0, b: 0, a: 0 }
      : { r: 255, g: 255, b: 255, a: 1 };
    const pixelData = new Map<string, ImageData>();
    const imgData = new ImageData(width, height);
    if (!transparentBg) {
      for (let i = 0; i < imgData.data.length; i += 4) {
        imgData.data[i] = 255;
        imgData.data[i + 1] = 255;
        imgData.data[i + 2] = 255;
        imgData.data[i + 3] = 255;
      }
    }
    pixelData.set(bgLayer.id, imgData);
    set({
      document: {
        id: generateId(),
        name: 'Untitled',
        width,
        height,
        layers: [bgLayer],
        layerOrder: [bgLayer.id],
        activeLayerId: bgLayer.id,
        backgroundColor: bgColor,
      },
      layerPixelData: pixelData,
      undoStack: [],
      redoStack: [],
      renderVersion: 0,
      selection: { active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 },
      documentReady: true,
      isDirty: false,
    });
  },

  openImageAsDocument: (imageData: ImageData, name: string) => {
    const layer: RasterLayer = {
      id: generateId(),
      name: 'Background',
      type: 'raster',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      clipToBelow: false,
      effects: DEFAULT_EFFECTS,
      mask: null,
      width: imageData.width,
      height: imageData.height,
    };
    const pixelData = new Map<string, ImageData>();
    pixelData.set(layer.id, imageData);
    set({
      document: {
        id: generateId(),
        name,
        width: imageData.width,
        height: imageData.height,
        layers: [layer],
        layerOrder: [layer.id],
        activeLayerId: layer.id,
        backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
      },
      layerPixelData: pixelData,
      undoStack: [],
      redoStack: [],
      renderVersion: 0,
      selection: { active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 },
      documentReady: true,
      isDirty: false,
    });
  },

  addLayer: () => {
    const state = get();
    state.pushHistory('Add Layer');
    const newLayer: RasterLayer = {
      id: generateId(),
      name: `Layer ${state.document.layers.length + 1}`,
      type: 'raster',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      clipToBelow: false,
      effects: DEFAULT_EFFECTS,
      mask: null,
      width: state.document.width,
      height: state.document.height,
    };
    const pixelData = new Map(state.layerPixelData);
    pixelData.set(newLayer.id, new ImageData(newLayer.width, newLayer.height));
    set({
      document: {
        ...state.document,
        layers: [...state.document.layers, newLayer],
        layerOrder: [...state.document.layerOrder, newLayer.id],
        activeLayerId: newLayer.id,
      },
      layerPixelData: pixelData,
    });
  },

  removeLayer: (id: string) => {
    const state = get();
    if (state.document.layers.length <= 1) return;
    state.pushHistory('Delete Layer');

    const layers = state.document.layers.filter((l) => l.id !== id);
    const layerOrder = state.document.layerOrder.filter((lid) => lid !== id);
    const activeLayerId =
      state.document.activeLayerId === id
        ? (layerOrder[layerOrder.length - 1] ?? null)
        : state.document.activeLayerId;

    const pixelData = new Map(state.layerPixelData);
    pixelData.delete(id);

    set({
      document: { ...state.document, layers, layerOrder, activeLayerId },
      layerPixelData: pixelData,
    });
  },

  setActiveLayer: (id: string) => {
    set((state) => ({
      document: { ...state.document, activeLayerId: id },
    }));
  },

  toggleLayerVisibility: (id: string) => {
    set((state) => ({
      document: {
        ...state.document,
        layers: state.document.layers.map((l) =>
          l.id === id ? ({ ...l, visible: !l.visible } as Layer) : l,
        ),
      },
    }));
  },

  updateLayerOpacity: (id: string, opacity: number) => {
    set((state) => ({
      document: {
        ...state.document,
        layers: state.document.layers.map((l) =>
          l.id === id ? ({ ...l, opacity } as Layer) : l,
        ),
      },
    }));
  },

  moveLayer: (fromIndex: number, toIndex: number) => {
    const state = get();
    state.pushHistory('Reorder Layer');
    const layers = [...state.document.layers];
    const order = [...state.document.layerOrder];
    const [movedLayer] = layers.splice(fromIndex, 1);
    const [movedOrder] = order.splice(fromIndex, 1);
    if (movedLayer === undefined || movedOrder === undefined) return;
    layers.splice(toIndex, 0, movedLayer);
    order.splice(toIndex, 0, movedOrder);
    set({ document: { ...state.document, layers, layerOrder: order }, renderVersion: state.renderVersion + 1 });
  },

  updateLayerPosition: (id: string, x: number, y: number) => {
    set((state) => ({
      document: {
        ...state.document,
        layers: state.document.layers.map((l) =>
          l.id === id ? ({ ...l, x, y } as Layer) : l,
        ),
      },
      renderVersion: state.renderVersion + 1,
    }));
  },

  alignLayer: (edge: AlignEdge) => {
    const state = get();
    const activeId = state.document.activeLayerId;
    if (!activeId) return;
    const layer = state.document.layers.find((l) => l.id === activeId);
    if (!layer) return;
    const pixelData = state.layerPixelData.get(activeId);
    if (!pixelData) return;

    let bounds: Rect | null;
    if (state.selection.active && state.selection.bounds) {
      bounds = state.selection.bounds;
    } else {
      bounds = getContentBounds(pixelData, layer.x, layer.y);
    }
    if (!bounds) return;

    state.pushHistory('Align Layer');
    const pos = computeAlign(edge, bounds, state.document.width, state.document.height, layer.x, layer.y);
    set((s) => ({
      document: {
        ...s.document,
        layers: s.document.layers.map((l) =>
          l.id === activeId ? ({ ...l, x: pos.x, y: pos.y } as Layer) : l,
        ),
      },
      renderVersion: s.renderVersion + 1,
    }));
  },

  duplicateLayer: () => {
    const state = get();
    const activeId = state.document.activeLayerId;
    if (!activeId) return;
    const layer = state.document.layers.find((l) => l.id === activeId);
    if (!layer) return;
    state.pushHistory('Duplicate Layer');
    const newId = generateId();
    const newLayer = { ...layer, id: newId, name: `${layer.name} copy` } as Layer;
    const pixelData = new Map(state.layerPixelData);
    const existingData = state.layerPixelData.get(activeId);
    if (existingData) {
      const copy = new ImageData(existingData.width, existingData.height);
      copy.data.set(existingData.data);
      pixelData.set(newId, copy);
    }
    const orderIdx = state.document.layerOrder.indexOf(activeId);
    const newOrder = [...state.document.layerOrder];
    newOrder.splice(orderIdx + 1, 0, newId);
    set({
      document: {
        ...state.document,
        layers: [...state.document.layers, newLayer],
        layerOrder: newOrder,
        activeLayerId: newId,
      },
      layerPixelData: pixelData,
    });
  },

  mergeDown: () => {
    const state = get();
    const activeId = state.document.activeLayerId;
    if (!activeId) return;
    const orderIdx = state.document.layerOrder.indexOf(activeId);
    if (orderIdx <= 0) return; // No layer below
    const belowId = state.document.layerOrder[orderIdx - 1];
    if (!belowId) return;
    state.pushHistory('Merge Down');

    const topData = state.getOrCreateLayerPixelData(activeId);
    const bottomData = state.getOrCreateLayerPixelData(belowId);
    const topLayer = state.document.layers.find((l) => l.id === activeId);
    const bottomLayer = state.document.layers.find((l) => l.id === belowId);
    if (!topLayer || !bottomLayer) return;

    // Composite top onto bottom
    const result = new ImageData(bottomData.width, bottomData.height);
    result.data.set(bottomData.data);
    compositeOver(
      topData.data, bottomData.data,
      topData.width, topData.height,
      bottomData.width, bottomData.height,
      topLayer.x - bottomLayer.x, topLayer.y - bottomLayer.y,
      topLayer.opacity, result.data,
    );

    const pixelData = new Map(state.layerPixelData);
    pixelData.set(belowId, result);
    pixelData.delete(activeId);

    set({
      document: {
        ...state.document,
        layers: state.document.layers.filter((l) => l.id !== activeId),
        layerOrder: state.document.layerOrder.filter((id) => id !== activeId),
        activeLayerId: belowId,
      },
      layerPixelData: pixelData,
      renderVersion: state.renderVersion + 1,
    });
  },

  flattenImage: () => {
    const state = get();
    if (state.document.layers.length <= 1) return;
    state.pushHistory('Flatten Image');

    const { width, height, backgroundColor } = state.document;
    const result = new ImageData(width, height);
    // Fill with background color
    for (let i = 0; i < result.data.length; i += 4) {
      result.data[i] = backgroundColor.r;
      result.data[i + 1] = backgroundColor.g;
      result.data[i + 2] = backgroundColor.b;
      result.data[i + 3] = Math.round(backgroundColor.a * 255);
    }

    // Composite layers bottom to top
    for (const layerId of state.document.layerOrder) {
      const layer = state.document.layers.find((l) => l.id === layerId);
      if (!layer || !layer.visible) continue;
      const data = state.layerPixelData.get(layerId);
      if (!data) continue;
      compositeOver(
        data.data, result.data,
        data.width, data.height,
        width, height,
        layer.x, layer.y,
        layer.opacity, result.data,
      );
    }

    const newId = generateId();
    const flatLayer: RasterLayer = {
      id: newId,
      name: 'Background',
      type: 'raster',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      clipToBelow: false,
      effects: DEFAULT_EFFECTS,
      mask: null,
      width,
      height,
    };
    const pixelData = new Map<string, ImageData>();
    pixelData.set(newId, result);
    set({
      document: {
        ...state.document,
        layers: [flatLayer],
        layerOrder: [newId],
        activeLayerId: newId,
      },
      layerPixelData: pixelData,
      renderVersion: state.renderVersion + 1,
    });
  },

  updateLayerEffects: (id: string, effects: LayerEffects) => {
    set((state) => ({
      document: {
        ...state.document,
        layers: state.document.layers.map((l) =>
          l.id === id ? ({ ...l, effects } as Layer) : l,
        ),
      },
      renderVersion: state.renderVersion + 1,
    }));
  },

  addLayerMask: (id: string) => {
    const state = get();
    const layer = state.document.layers.find((l) => l.id === id);
    if (!layer) return;
    const width = layer.type === 'raster' || layer.type === 'shape' ? layer.width : state.document.width;
    const height = layer.type === 'raster' || layer.type === 'shape' ? layer.height : state.document.height;
    const maskData = new Uint8ClampedArray(width * height);
    maskData.fill(255);
    const layerMask: LayerMask = {
      id: generateId(),
      enabled: true,
      data: maskData,
      width,
      height,
    };
    set((s) => ({
      document: {
        ...s.document,
        layers: s.document.layers.map((l) =>
          l.id === id ? ({ ...l, mask: layerMask } as Layer) : l,
        ),
      },
      renderVersion: s.renderVersion + 1,
    }));
  },

  removeLayerMask: (id: string) => {
    set((state) => ({
      document: {
        ...state.document,
        layers: state.document.layers.map((l) =>
          l.id === id ? ({ ...l, mask: null } as Layer) : l,
        ),
      },
      renderVersion: state.renderVersion + 1,
    }));
  },

  toggleLayerMask: (id: string) => {
    set((state) => ({
      document: {
        ...state.document,
        layers: state.document.layers.map((l) => {
          if (l.id !== id || !l.mask) return l;
          return { ...l, mask: { ...l.mask, enabled: !l.mask.enabled } } as Layer;
        }),
      },
      renderVersion: state.renderVersion + 1,
    }));
  },

  updateLayerMaskData: (layerId: string, maskData: Uint8ClampedArray) => {
    set((state) => ({
      document: {
        ...state.document,
        layers: state.document.layers.map((l) => {
          if (l.id !== layerId || !l.mask) return l;
          return { ...l, mask: { ...l.mask, data: maskData } } as Layer;
        }),
      },
      renderVersion: state.renderVersion + 1,
    }));
  },

  setSelection: (bounds: Rect, mask: Uint8ClampedArray, maskWidth: number, maskHeight: number) => {
    set({ selection: { active: true, bounds, mask, maskWidth, maskHeight }, renderVersion: get().renderVersion + 1 });
  },

  clearSelection: () => {
    set({ selection: { active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 }, renderVersion: get().renderVersion + 1 });
  },

  copy: () => {
    const state = get();
    const activeId = state.document.activeLayerId;
    if (!activeId) return;
    const layerData = state.layerPixelData.get(activeId);
    if (!layerData) return;
    const layer = state.document.layers.find((l) => l.id === activeId);
    if (!layer) return;

    const sel = state.selection;
    if (sel.active && sel.bounds && sel.mask) {
      const b = sel.bounds;
      const w = Math.round(b.width);
      const h = Math.round(b.height);
      const bx = Math.round(b.x);
      const by = Math.round(b.y);
      const copied = new ImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const docX = bx + x;
          const docY = by + y;
          const maskVal = sel.mask[docY * sel.maskWidth + docX] ?? 0;
          if (maskVal < 128) continue;
          const srcX = docX - layer.x;
          const srcY = docY - layer.y;
          if (srcX < 0 || srcX >= layerData.width || srcY < 0 || srcY >= layerData.height) continue;
          const si = (srcY * layerData.width + srcX) * 4;
          const di = (y * w + x) * 4;
          copied.data[di] = layerData.data[si] ?? 0;
          copied.data[di + 1] = layerData.data[si + 1] ?? 0;
          copied.data[di + 2] = layerData.data[si + 2] ?? 0;
          copied.data[di + 3] = layerData.data[si + 3] ?? 0;
        }
      }
      set({ clipboard: { imageData: copied, offsetX: bx, offsetY: by } });
    } else {
      const copied = cloneImageData(layerData);
      set({ clipboard: { imageData: copied, offsetX: layer.x, offsetY: layer.y } });
    }
  },

  cut: () => {
    const state = get();
    const activeId = state.document.activeLayerId;
    if (!activeId) return;

    // Copy first
    state.copy();

    // Then clear the selected region
    state.pushHistory('Cut');
    const layerData = state.getOrCreateLayerPixelData(activeId);
    const layer = state.document.layers.find((l) => l.id === activeId);
    if (!layer) return;
    const result = cloneImageData(layerData);
    const sel = state.selection;

    if (sel.active && sel.bounds && sel.mask) {
      for (let y = 0; y < sel.maskHeight; y++) {
        for (let x = 0; x < sel.maskWidth; x++) {
          if ((sel.mask[y * sel.maskWidth + x] ?? 0) < 128) continue;
          const srcX = x - layer.x;
          const srcY = y - layer.y;
          if (srcX < 0 || srcX >= result.width || srcY < 0 || srcY >= result.height) continue;
          const idx = (srcY * result.width + srcX) * 4;
          result.data[idx] = 0;
          result.data[idx + 1] = 0;
          result.data[idx + 2] = 0;
          result.data[idx + 3] = 0;
        }
      }
    } else {
      result.data.fill(0);
    }
    state.updateLayerPixelData(activeId, result);
  },

  paste: () => {
    const state = get();
    const clip = state.clipboard;
    if (!clip) return;
    state.pushHistory('Paste');

    const newId = generateId();
    const newLayer: RasterLayer = {
      id: newId,
      name: 'Pasted Layer',
      type: 'raster',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: clip.offsetX,
      y: clip.offsetY,
      clipToBelow: false,
      effects: DEFAULT_EFFECTS,
      mask: null,
      width: clip.imageData.width,
      height: clip.imageData.height,
    };

    const pixelData = new Map(state.layerPixelData);
    pixelData.set(newId, cloneImageData(clip.imageData));

    const orderIdx = state.document.activeLayerId
      ? state.document.layerOrder.indexOf(state.document.activeLayerId) + 1
      : state.document.layerOrder.length;
    const newOrder = [...state.document.layerOrder];
    newOrder.splice(orderIdx, 0, newId);

    set({
      document: {
        ...state.document,
        layers: [...state.document.layers, newLayer],
        layerOrder: newOrder,
        activeLayerId: newId,
      },
      layerPixelData: pixelData,
      renderVersion: state.renderVersion + 1,
    });
  },

  pasteImageData: (imageData: ImageData) => {
    const state = get();
    state.pushHistory('Paste');

    const newId = generateId();
    const newLayer: RasterLayer = {
      id: newId,
      name: 'Pasted Layer',
      type: 'raster',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      clipToBelow: false,
      effects: DEFAULT_EFFECTS,
      mask: null,
      width: imageData.width,
      height: imageData.height,
    };

    const pixelData = new Map(state.layerPixelData);
    pixelData.set(newId, imageData);

    const orderIdx = state.document.activeLayerId
      ? state.document.layerOrder.indexOf(state.document.activeLayerId) + 1
      : state.document.layerOrder.length;
    const newOrder = [...state.document.layerOrder];
    newOrder.splice(orderIdx, 0, newId);

    set({
      document: {
        ...state.document,
        layers: [...state.document.layers, newLayer],
        layerOrder: newOrder,
        activeLayerId: newId,
      },
      layerPixelData: pixelData,
      renderVersion: state.renderVersion + 1,
    });
  },

  getOrCreateLayerPixelData: (layerId: string) => {
    const state = get();
    const existing = state.layerPixelData.get(layerId);
    if (existing) return existing;

    const layer = state.document.layers.find((l) => l.id === layerId);
    const width = layer?.type === 'raster' || layer?.type === 'shape' ? layer.width : state.document.width;
    const height = layer?.type === 'raster' || layer?.type === 'shape' ? layer.height : state.document.height;
    const imageData = new ImageData(width, height);
    const pixelData = new Map(state.layerPixelData);
    pixelData.set(layerId, imageData);
    set({ layerPixelData: pixelData });
    return imageData;
  },

  updateLayerPixelData: (layerId: string, data: ImageData) => {
    const state = get();
    const pixelData = new Map(state.layerPixelData);
    pixelData.set(layerId, data);
    const dirtyLayerIds = new Set(state.dirtyLayerIds);
    dirtyLayerIds.add(layerId);
    set({ layerPixelData: pixelData, dirtyLayerIds, renderVersion: state.renderVersion + 1 });
  },

  notifyRender: () => {
    set((state) => ({ renderVersion: state.renderVersion + 1 }));
  },

  cropCanvas: (rect: Rect) => {
    const state = get();
    state.pushHistory('Crop Canvas');
    const cx = Math.round(rect.x);
    const cy = Math.round(rect.y);
    const cw = Math.round(rect.width);
    const ch = Math.round(rect.height);
    if (cw <= 0 || ch <= 0) return;

    const pixelData = new Map<string, ImageData>();
    const newLayers: Layer[] = [];

    for (const layer of state.document.layers) {
      if (layer.type !== 'raster') {
        newLayers.push(layer);
        continue;
      }
      const oldData = state.layerPixelData.get(layer.id);
      const newData = new ImageData(cw, ch);
      if (oldData) {
        for (let y = 0; y < ch; y++) {
          for (let x = 0; x < cw; x++) {
            const srcX = x + cx - layer.x;
            const srcY = y + cy - layer.y;
            if (srcX < 0 || srcX >= oldData.width || srcY < 0 || srcY >= oldData.height) continue;
            const si = (srcY * oldData.width + srcX) * 4;
            const di = (y * cw + x) * 4;
            newData.data[di] = oldData.data[si] ?? 0;
            newData.data[di + 1] = oldData.data[si + 1] ?? 0;
            newData.data[di + 2] = oldData.data[si + 2] ?? 0;
            newData.data[di + 3] = oldData.data[si + 3] ?? 0;
          }
        }
      }
      pixelData.set(layer.id, newData);
      newLayers.push({ ...layer, x: 0, y: 0, width: cw, height: ch } as Layer);
    }

    set({
      document: {
        ...state.document,
        width: cw,
        height: ch,
        layers: newLayers,
      },
      layerPixelData: pixelData,
      renderVersion: state.renderVersion + 1,
    });
  },

  resizeCanvas: (newWidth: number, newHeight: number, anchorX: number, anchorY: number) => {
    const state = get();
    state.pushHistory('Resize Canvas');
    const oldW = state.document.width;
    const oldH = state.document.height;
    const offsetX = Math.round((newWidth - oldW) * anchorX);
    const offsetY = Math.round((newHeight - oldH) * anchorY);

    const pixelData = new Map<string, ImageData>();
    const newLayers: Layer[] = [];

    for (const layer of state.document.layers) {
      if (layer.type !== 'raster') {
        newLayers.push(layer);
        continue;
      }
      const oldData = state.layerPixelData.get(layer.id);
      const newData = new ImageData(newWidth, newHeight);
      if (oldData) {
        const lx = layer.x + offsetX;
        const ly = layer.y + offsetY;
        for (let y = 0; y < oldData.height; y++) {
          for (let x = 0; x < oldData.width; x++) {
            const dx = x + lx;
            const dy = y + ly;
            if (dx < 0 || dx >= newWidth || dy < 0 || dy >= newHeight) continue;
            const si = (y * oldData.width + x) * 4;
            const di = (dy * newWidth + dx) * 4;
            newData.data[di] = oldData.data[si] ?? 0;
            newData.data[di + 1] = oldData.data[si + 1] ?? 0;
            newData.data[di + 2] = oldData.data[si + 2] ?? 0;
            newData.data[di + 3] = oldData.data[si + 3] ?? 0;
          }
        }
      }
      pixelData.set(layer.id, newData);
      newLayers.push({ ...layer, x: 0, y: 0, width: newWidth, height: newHeight } as Layer);
    }

    set({
      document: {
        ...state.document,
        width: newWidth,
        height: newHeight,
        layers: newLayers,
      },
      layerPixelData: pixelData,
      renderVersion: state.renderVersion + 1,
    });
  },

  resizeImage: (newWidth: number, newHeight: number) => {
    const state = get();
    state.pushHistory('Resize Image');
    const oldW = state.document.width;
    const oldH = state.document.height;

    const scaleX = newWidth / oldW;
    const scaleY = newHeight / oldH;

    const tmpCanvas = document.createElement('canvas');
    const tmpCtx = tmpCanvas.getContext('2d');
    if (!tmpCtx) return;

    const pixelData = new Map<string, ImageData>();
    const newLayers: Layer[] = [];

    for (const layer of state.document.layers) {
      if (layer.type !== 'raster') {
        newLayers.push(layer);
        continue;
      }
      const oldData = state.layerPixelData.get(layer.id);
      if (oldData) {
        tmpCanvas.width = oldData.width;
        tmpCanvas.height = oldData.height;
        tmpCtx.putImageData(oldData, 0, 0);

        const scaledCanvas = document.createElement('canvas');
        scaledCanvas.width = newWidth;
        scaledCanvas.height = newHeight;
        const scaledCtx = scaledCanvas.getContext('2d');
        if (!scaledCtx) continue;
        scaledCtx.imageSmoothingEnabled = true;
        scaledCtx.imageSmoothingQuality = 'high';
        scaledCtx.drawImage(tmpCanvas, 0, 0, oldData.width, oldData.height, 0, 0, newWidth, newHeight);
        pixelData.set(layer.id, scaledCtx.getImageData(0, 0, newWidth, newHeight));
      } else {
        pixelData.set(layer.id, new ImageData(newWidth, newHeight));
      }
      newLayers.push({
        ...layer,
        x: Math.round(layer.x * scaleX),
        y: Math.round(layer.y * scaleY),
        width: newWidth,
        height: newHeight,
      } as Layer);
    }

    set({
      document: {
        ...state.document,
        width: newWidth,
        height: newHeight,
        layers: newLayers,
      },
      layerPixelData: pixelData,
      renderVersion: state.renderVersion + 1,
    });
  },

  setZoom: (zoom: number) => {
    set((state) => ({
      viewport: { ...state.viewport, zoom: Math.max(0.01, Math.min(64, zoom)) },
    }));
  },

  setPan: (x: number, y: number) => {
    set((state) => ({
      viewport: { ...state.viewport, panX: x, panY: y },
    }));
  },

  setViewportSize: (width: number, height: number) => {
    set((state) => ({
      viewport: { ...state.viewport, width, height },
    }));
  },

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;
    const previous = state.undoStack[state.undoStack.length - 1];
    if (!previous) return;
    const currentSnapshot: HistorySnapshot = {
      document: state.document,
      layerPixelData: clonePixelDataMapFull(state.layerPixelData),
      label: previous.label,
    };
    set({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, currentSnapshot],
      document: previous.document,
      layerPixelData: clonePixelDataMapFull(previous.layerPixelData),
      dirtyLayerIds: new Set(),
      renderVersion: state.renderVersion + 1,
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const next = state.redoStack[state.redoStack.length - 1];
    if (!next) return;
    const currentSnapshot: HistorySnapshot = {
      document: state.document,
      layerPixelData: clonePixelDataMapFull(state.layerPixelData),
      label: next.label,
    };
    set({
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, currentSnapshot],
      document: next.document,
      layerPixelData: clonePixelDataMapFull(next.layerPixelData),
      dirtyLayerIds: new Set(),
      renderVersion: state.renderVersion + 1,
    });
  },

  pushHistory: (label = 'Edit') => {
    const state = get();
    const prevSnapshot = state.undoStack[state.undoStack.length - 1];
    const snapshot: HistorySnapshot = {
      document: state.document,
      layerPixelData: clonePixelDataMap(state.layerPixelData, state.dirtyLayerIds, prevSnapshot),
      label,
    };
    set({
      undoStack: [...state.undoStack.slice(-49), snapshot],
      redoStack: [],
      dirtyLayerIds: new Set(),
      isDirty: true,
    });
  },

  markClean: () => {
    set({ isDirty: false });
  },
}));
