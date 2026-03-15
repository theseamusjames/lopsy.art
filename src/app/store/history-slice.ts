import { cloneImageData } from '../../engine/canvas-ops';
import type { HistorySnapshot, SliceCreator } from './types';

export interface HistorySlice {
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
  isDirty: boolean;
  undo: () => void;
  redo: () => void;
  pushHistory: (label?: string) => void;
  markClean: () => void;
}

function clonePixelDataMap(
  current: Map<string, ImageData>,
  dirtyIds: Set<string>,
  previous: HistorySnapshot | undefined,
): Map<string, ImageData> {
  const clone = new Map<string, ImageData>();
  for (const [id, data] of current) {
    if (dirtyIds.has(id) || !previous?.layerPixelData.has(id)) {
      clone.set(id, cloneImageData(data));
    } else {
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

export const createHistorySlice: SliceCreator<HistorySlice> = (set, get) => ({
  undoStack: [],
  redoStack: [],
  isDirty: false,

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
      dirtyLayerIds: new Set(previous.document.layerOrder),
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
      dirtyLayerIds: new Set(next.document.layerOrder),
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
});
