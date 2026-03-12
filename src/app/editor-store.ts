import { create } from 'zustand';
import type { DocumentState, Layer, Rect, RasterLayer, ViewportState } from '../types';

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
}

function clonePixelDataMap(map: Map<string, ImageData>): Map<string, ImageData> {
  const clone = new Map<string, ImageData>();
  for (const [id, data] of map) {
    const copy = new ImageData(data.width, data.height);
    copy.data.set(data.data);
    clone.set(id, copy);
  }
  return clone;
}

interface EditorState {
  document: DocumentState;
  viewport: ViewportState;
  layerPixelData: Map<string, ImageData>;
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
  renderVersion: number;
  selection: SelectionData;

  // Document mutations
  addLayer: () => void;
  removeLayer: (id: string) => void;
  setActiveLayer: (id: string) => void;
  toggleLayerVisibility: (id: string) => void;
  updateLayerOpacity: (id: string, opacity: number) => void;
  moveLayer: (fromIndex: number, toIndex: number) => void;
  updateLayerPosition: (id: string, x: number, y: number) => void;
  duplicateLayer: () => void;
  mergeDown: () => void;
  flattenImage: () => void;

  // Selection
  setSelection: (bounds: Rect, mask: Uint8ClampedArray, maskWidth: number, maskHeight: number) => void;
  clearSelection: () => void;

  // Pixel data
  getOrCreateLayerPixelData: (layerId: string) => ImageData;
  updateLayerPixelData: (layerId: string, data: ImageData) => void;
  notifyRender: () => void;

  // Canvas
  cropCanvas: (rect: Rect) => void;

  // Viewport
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setViewportSize: (width: number, height: number) => void;

  // History
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
}

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
    maskId: null,
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
  renderVersion: 0,
  selection: { active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 },

  addLayer: () => {
    const state = get();
    state.pushHistory();
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
      maskId: null,
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
    state.pushHistory();

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
    state.pushHistory();
    const order = [...state.document.layerOrder];
    const [moved] = order.splice(fromIndex, 1);
    if (moved === undefined) return;
    order.splice(toIndex, 0, moved);
    set({ document: { ...state.document, layerOrder: order } });
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

  duplicateLayer: () => {
    const state = get();
    const activeId = state.document.activeLayerId;
    if (!activeId) return;
    const layer = state.document.layers.find((l) => l.id === activeId);
    if (!layer) return;
    state.pushHistory();
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
    state.pushHistory();

    const topData = state.getOrCreateLayerPixelData(activeId);
    const bottomData = state.getOrCreateLayerPixelData(belowId);
    const topLayer = state.document.layers.find((l) => l.id === activeId);
    const bottomLayer = state.document.layers.find((l) => l.id === belowId);
    if (!topLayer || !bottomLayer) return;

    // Composite top onto bottom
    const result = new ImageData(bottomData.width, bottomData.height);
    result.data.set(bottomData.data);
    const topOpacity = topLayer.opacity;
    for (let y = 0; y < topData.height; y++) {
      for (let x = 0; x < topData.width; x++) {
        const destX = x + topLayer.x - bottomLayer.x;
        const destY = y + topLayer.y - bottomLayer.y;
        if (destX < 0 || destX >= result.width || destY < 0 || destY >= result.height) continue;
        const si = (y * topData.width + x) * 4;
        const di = (destY * result.width + destX) * 4;
        const sa = ((topData.data[si + 3] ?? 0) / 255) * topOpacity;
        if (sa <= 0) continue;
        const da = (result.data[di + 3] ?? 0) / 255;
        const outA = sa + da * (1 - sa);
        if (outA > 0) {
          result.data[di] = Math.round(((topData.data[si] ?? 0) * sa + (result.data[di] ?? 0) * da * (1 - sa)) / outA);
          result.data[di + 1] = Math.round(((topData.data[si + 1] ?? 0) * sa + (result.data[di + 1] ?? 0) * da * (1 - sa)) / outA);
          result.data[di + 2] = Math.round(((topData.data[si + 2] ?? 0) * sa + (result.data[di + 2] ?? 0) * da * (1 - sa)) / outA);
          result.data[di + 3] = Math.round(outA * 255);
        }
      }
    }

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
    state.pushHistory();

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
      const layerOpacity = layer.opacity;
      for (let y = 0; y < data.height; y++) {
        for (let x = 0; x < data.width; x++) {
          const destX = x + layer.x;
          const destY = y + layer.y;
          if (destX < 0 || destX >= width || destY < 0 || destY >= height) continue;
          const si = (y * data.width + x) * 4;
          const di = (destY * width + destX) * 4;
          const sa = ((data.data[si + 3] ?? 0) / 255) * layerOpacity;
          if (sa <= 0) continue;
          const da = (result.data[di + 3] ?? 0) / 255;
          const outA = sa + da * (1 - sa);
          if (outA > 0) {
            result.data[di] = Math.round(((data.data[si] ?? 0) * sa + (result.data[di] ?? 0) * da * (1 - sa)) / outA);
            result.data[di + 1] = Math.round(((data.data[si + 1] ?? 0) * sa + (result.data[di + 1] ?? 0) * da * (1 - sa)) / outA);
            result.data[di + 2] = Math.round(((data.data[si + 2] ?? 0) * sa + (result.data[di + 2] ?? 0) * da * (1 - sa)) / outA);
            result.data[di + 3] = Math.round(outA * 255);
          }
        }
      }
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
      maskId: null,
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

  setSelection: (bounds: Rect, mask: Uint8ClampedArray, maskWidth: number, maskHeight: number) => {
    set({ selection: { active: true, bounds, mask, maskWidth, maskHeight }, renderVersion: get().renderVersion + 1 });
  },

  clearSelection: () => {
    set({ selection: { active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 }, renderVersion: get().renderVersion + 1 });
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
    set({ layerPixelData: pixelData, renderVersion: state.renderVersion + 1 });
  },

  notifyRender: () => {
    set((state) => ({ renderVersion: state.renderVersion + 1 }));
  },

  cropCanvas: (rect: Rect) => {
    const state = get();
    state.pushHistory();
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
      layerPixelData: clonePixelDataMap(state.layerPixelData),
    };
    set({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, currentSnapshot],
      document: previous.document,
      layerPixelData: previous.layerPixelData,
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
      layerPixelData: clonePixelDataMap(state.layerPixelData),
    };
    set({
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, currentSnapshot],
      document: next.document,
      layerPixelData: next.layerPixelData,
      renderVersion: state.renderVersion + 1,
    });
  },

  pushHistory: () => {
    const state = get();
    const snapshot: HistorySnapshot = {
      document: state.document,
      layerPixelData: clonePixelDataMap(state.layerPixelData),
    };
    set({
      undoStack: [...state.undoStack.slice(-49), snapshot],
      redoStack: [],
    });
  },
}));
