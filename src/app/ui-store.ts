import { create } from 'zustand';
import type { Color, Point, ToolId } from '../types';
import type { TransformHandle, TransformState } from '../tools/transform/transform';

export interface PathAnchor {
  point: Point;
  handleIn: Point | null;
  handleOut: Point | null;
}

interface UIState {
  activeTool: ToolId;
  foregroundColor: Color;
  backgroundColor: Color;
  showGrid: boolean;
  showRulers: boolean;
  showGuides: boolean;
  sidebarCollapsed: boolean;
  pathAnchors: PathAnchor[];
  pathClosed: boolean;
  lassoPoints: Point[];
  cropRect: { x: number; y: number; width: number; height: number } | null;
  transform: TransformState | null;
  activeTransformHandle: TransformHandle | null;
  maskEditMode: boolean;
  showNewDocumentModal: boolean;
  gradientPreview: { start: Point; end: Point } | null;
  setMaskEditMode: (mode: boolean) => void;
  setShowNewDocumentModal: (show: boolean) => void;
  setGradientPreview: (preview: { start: Point; end: Point } | null) => void;
  setActiveTool: (tool: ToolId) => void;
  setForegroundColor: (color: Color) => void;
  setBackgroundColor: (color: Color) => void;
  swapColors: () => void;
  resetColors: () => void;
  toggleGrid: () => void;
  toggleRulers: () => void;
  toggleGuides: () => void;
  toggleSidebar: () => void;
  addPathAnchor: (anchor: PathAnchor) => void;
  updateLastPathAnchor: (anchor: PathAnchor) => void;
  closePath: () => void;
  clearPath: () => void;
  setLassoPoints: (points: Point[]) => void;
  clearLassoPoints: () => void;
  setCropRect: (rect: { x: number; y: number; width: number; height: number } | null) => void;
  setTransform: (transform: TransformState | null) => void;
  setActiveTransformHandle: (handle: TransformHandle | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeTool: 'move',
  foregroundColor: { r: 0, g: 0, b: 0, a: 1 },
  backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
  showGrid: false,
  showRulers: true,
  showGuides: true,
  sidebarCollapsed: false,
  pathAnchors: [],
  pathClosed: false,
  lassoPoints: [],
  cropRect: null,
  transform: null,
  activeTransformHandle: null,
  maskEditMode: false,
  showNewDocumentModal: false,
  gradientPreview: null,
  setMaskEditMode: (mode) => set({ maskEditMode: mode }),
  setShowNewDocumentModal: (show) => set({ showNewDocumentModal: show }),
  setGradientPreview: (preview) => set({ gradientPreview: preview }),

  setActiveTool: (tool) => {
    // Clear path when switching away from path tool
    const current = useUIStore.getState();
    if (current.activeTool === 'path' && tool !== 'path') {
      set({ activeTool: tool, pathAnchors: [], pathClosed: false });
    } else {
      set({ activeTool: tool });
    }
  },
  setForegroundColor: (color) => set({ foregroundColor: color }),
  setBackgroundColor: (color) => set({ backgroundColor: color }),
  swapColors: () =>
    set((state) => ({
      foregroundColor: state.backgroundColor,
      backgroundColor: state.foregroundColor,
    })),
  resetColors: () =>
    set({
      foregroundColor: { r: 0, g: 0, b: 0, a: 1 },
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  toggleRulers: () => set((state) => ({ showRulers: !state.showRulers })),
  toggleGuides: () => set((state) => ({ showGuides: !state.showGuides })),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  addPathAnchor: (anchor) => set((state) => ({ pathAnchors: [...state.pathAnchors, anchor] })),
  updateLastPathAnchor: (anchor) =>
    set((state) => {
      const anchors = [...state.pathAnchors];
      if (anchors.length > 0) {
        anchors[anchors.length - 1] = anchor;
      }
      return { pathAnchors: anchors };
    }),
  closePath: () => set({ pathClosed: true }),
  clearPath: () => set({ pathAnchors: [], pathClosed: false }),
  setLassoPoints: (points) => set({ lassoPoints: points }),
  clearLassoPoints: () => set({ lassoPoints: [] }),
  setCropRect: (rect) => set({ cropRect: rect }),
  setTransform: (transform) => set({ transform }),
  setActiveTransformHandle: (handle) => set({ activeTransformHandle: handle }),
}));
