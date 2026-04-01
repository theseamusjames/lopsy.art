import { create } from 'zustand';
import type { Color, Point, ToolId } from '../types';
import type { TransformHandle, TransformState } from '../tools/transform/transform';
import { useToolSettingsStore } from './tool-settings-store';
import { DEFAULT_ADJUSTMENTS } from '../filters/image-adjustments';
import type { ImageAdjustments } from '../filters/image-adjustments';

export interface PathAnchor {
  point: Point;
  handleIn: Point | null;
  handleOut: Point | null;
}

export interface Guide {
  id: string;
  orientation: 'horizontal' | 'vertical';
  position: number;
}

export interface RulerHover {
  orientation: 'horizontal' | 'vertical';
  position: number;
  screenX: number;
  screenY: number;
}

const MAX_RECENT_COLORS = 20;

function colorsEqual(a: Color, b: Color): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

interface UIState {
  activeTool: ToolId;
  foregroundColor: Color;
  backgroundColor: Color;
  recentColors: readonly Color[];
  showGrid: boolean;
  showRulers: boolean;
  showGuides: boolean;
  snapToGrid: boolean;
  gridSize: number;
  sidebarCollapsed: boolean;
  pathAnchors: PathAnchor[];
  pathClosed: boolean;
  lassoPoints: Point[];
  cropRect: { x: number; y: number; width: number; height: number } | null;
  transform: TransformState | null;
  activeTransformHandle: TransformHandle | null;
  maskEditMode: boolean;
  showNewDocumentModal: boolean;
  showEffectsDrawer: boolean;
  visiblePanels: Set<string>;
  cursorPosition: Point;
  gradientPreview: { start: Point; end: Point } | null;
  setCursorPosition: (pos: Point) => void;
  setMaskEditMode: (mode: boolean) => void;
  setShowNewDocumentModal: (show: boolean) => void;
  setShowEffectsDrawer: (show: boolean) => void;
  togglePanel: (panelId: string) => void;
  setGradientPreview: (preview: { start: Point; end: Point } | null) => void;
  addRecentColor: (color: Color) => void;
  setActiveTool: (tool: ToolId) => void;
  setForegroundColor: (color: Color) => void;
  setBackgroundColor: (color: Color) => void;
  swapColors: () => void;
  resetColors: () => void;
  toggleGrid: () => void;
  toggleRulers: () => void;
  toggleGuides: () => void;
  toggleSnapToGrid: () => void;
  setGridSize: (size: number) => void;
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
  pendingShapeClick: { center: Point; layerId: string; layerX: number; layerY: number } | null;
  setPendingShapeClick: (pending: { center: Point; layerId: string; layerX: number; layerY: number } | null) => void;
  adjustments: ImageAdjustments;
  adjustmentsEnabled: boolean;
  setAdjustments: (adj: ImageAdjustments) => void;
  setAdjustmentsEnabled: (enabled: boolean) => void;
  guides: Guide[];
  selectedGuideId: string | null;
  hoveredGuideId: string | null;
  rulerHover: RulerHover | null;
  addGuide: (orientation: 'horizontal' | 'vertical', position: number) => void;
  removeGuide: (id: string) => void;
  selectGuide: (id: string | null) => void;
  setHoveredGuide: (id: string | null) => void;
  setRulerHover: (hover: RulerHover | null) => void;
  clearGuides: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeTool: 'move',
  foregroundColor: { r: 0, g: 0, b: 0, a: 1 },
  backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
  recentColors: Array.from({ length: MAX_RECENT_COLORS }, () => ({ r: 46, g: 46, b: 46, a: 1 })),
  showGrid: false,
  showRulers: true,
  showGuides: true,
  snapToGrid: false,
  gridSize: 16,
  sidebarCollapsed: false,
  pathAnchors: [],
  pathClosed: false,
  lassoPoints: [],
  cropRect: null,
  transform: null,
  activeTransformHandle: null,
  maskEditMode: false,
  showNewDocumentModal: false,
  showEffectsDrawer: false,
  visiblePanels: new Set(['color', 'layers']),
  cursorPosition: { x: 0, y: 0 },
  pendingShapeClick: null,
  setPendingShapeClick: (pending) => set({ pendingShapeClick: pending }),
  adjustments: { ...DEFAULT_ADJUSTMENTS },
  adjustmentsEnabled: true,
  setAdjustments: (adj) => set({ adjustments: adj }),
  setAdjustmentsEnabled: (enabled) => set({ adjustmentsEnabled: enabled }),
  gradientPreview: null,
  setCursorPosition: (pos) => set({ cursorPosition: pos }),
  setMaskEditMode: (mode) => set({ maskEditMode: mode }),
  setShowNewDocumentModal: (show) => set({ showNewDocumentModal: show }),
  setShowEffectsDrawer: (show) => set({ showEffectsDrawer: show }),
  togglePanel: (panelId) =>
    set((state) => {
      const next = new Set(state.visiblePanels);
      if (next.has(panelId)) {
        next.delete(panelId);
      } else {
        next.add(panelId);
      }
      return { visiblePanels: next };
    }),
  setGradientPreview: (preview) => set({ gradientPreview: preview }),

  addRecentColor: (color) =>
    set((state) => {
      const filtered = state.recentColors.filter((c) => !colorsEqual(c, color));
      return { recentColors: [color, ...filtered].slice(0, MAX_RECENT_COLORS) };
    }),

  setActiveTool: (tool) => {
    // Clear path when switching away from path tool
    const current = useUIStore.getState();
    if (current.activeTool === 'path' && tool !== 'path') {
      set({ activeTool: tool, pathAnchors: [], pathClosed: false });
    } else {
      set({ activeTool: tool });
    }
    if (tool === 'shape') {
      useToolSettingsStore.getState().setShapeFillColor(current.foregroundColor);
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
  toggleGrid: () => set((state) => {
    const showGrid = !state.showGrid;
    return showGrid ? { showGrid, snapToGrid: true } : { showGrid };
  }),
  toggleRulers: () => set((state) => ({ showRulers: !state.showRulers })),
  toggleGuides: () => set((state) => ({ showGuides: !state.showGuides })),
  toggleSnapToGrid: () => set((state) => ({ snapToGrid: !state.snapToGrid })),
  setGridSize: (size) => set({ gridSize: size }),
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
  guides: [],
  selectedGuideId: null,
  hoveredGuideId: null,
  rulerHover: null,
  addGuide: (orientation, position) =>
    set((state) => ({
      guides: [...state.guides, { id: crypto.randomUUID(), orientation, position }],
    })),
  removeGuide: (id) =>
    set((state) => ({
      guides: state.guides.filter((g) => g.id !== id),
      selectedGuideId: state.selectedGuideId === id ? null : state.selectedGuideId,
    })),
  selectGuide: (id) => set({ selectedGuideId: id }),
  setHoveredGuide: (id) => set({ hoveredGuideId: id }),
  setRulerHover: (hover) => set({ rulerHover: hover }),
  clearGuides: () => set({ guides: [], selectedGuideId: null }),
}));
