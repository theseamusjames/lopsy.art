import { create } from 'zustand';
import type { Color, Point, ToolId } from '../types';
import type { TransformHandle, TransformState } from '../tools/transform/transform';
import { DEFAULT_ADJUSTMENTS } from '../filters/image-adjustments';
import type { ImageAdjustments } from '../filters/image-adjustments';
import { toolRegistry } from '../tools/tool-registry';

export interface TextEditingState {
  layerId: string;
  bounds: { x: number; y: number; width: number | null; height: number | null };
  text: string;
  cursorPos: number;
  isNew: boolean;
  originalVisible: boolean;
}

export interface TextDragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

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

export interface ShapeSizeClick {
  center: Point;
  layerId: string;
  layerX: number;
  layerY: number;
}

/**
 * One-at-a-time modal slot. Only one kind can be open; opening a new kind
 * replaces whatever was there. Payloads ride on the variant so data and
 * visibility can't drift apart (the old pattern had parallel booleans +
 * separate data fields — five different ways to say "is a modal open?").
 */
export type ModalState =
  | { kind: 'newDocument' }
  | { kind: 'shapeSize'; click: ShapeSizeClick }
  | { kind: 'strokePath'; pathId: string }
  | { kind: 'guideColor' }
  | { kind: 'brush' }
  | { kind: 'loading'; message: string };

interface UIState {
  activeTool: ToolId;
  showGrid: boolean;
  showRulers: boolean;
  showGuides: boolean;
  showSeamlessPattern: boolean;
  dimSeamlessPattern: boolean;
  snapToGrid: boolean;
  gridSize: number;
  guideColor: Color;
  sidebarCollapsed: boolean;
  pathAnchors: PathAnchor[];
  pathClosed: boolean;
  lassoPoints: Point[];
  cropRect: { x: number; y: number; width: number; height: number } | null;
  transform: TransformState | null;
  activeTransformHandle: TransformHandle | null;
  maskEditMode: boolean;
  /** Active modal, or null when nothing is open. Only one at a time. */
  modal: ModalState | null;
  showEffectsDrawer: boolean;
  visiblePanels: Set<string>;
  cursorPosition: Point;
  gradientPreview: { start: Point; end: Point } | null;
  setCursorPosition: (pos: Point) => void;
  setMaskEditMode: (mode: boolean) => void;
  /** Open a modal, replacing any that was already open. */
  openModal: (next: ModalState) => void;
  /** Close whatever modal is open. */
  closeModal: () => void;
  /** Close only if the currently-open modal matches this kind (no-op otherwise). */
  closeModalOfKind: (kind: ModalState['kind']) => void;
  /** Backward-compat setter — use openModal/closeModalOfKind for new code. */
  setShowNewDocumentModal: (show: boolean) => void;
  /** Backward-compat setter — use openModal/closeModalOfKind for new code. */
  setShowBrushModal: (show: boolean) => void;
  setShowEffectsDrawer: (show: boolean) => void;
  togglePanel: (panelId: string) => void;
  setGradientPreview: (preview: { start: Point; end: Point } | null) => void;
  setActiveTool: (tool: ToolId) => void;
  toggleGrid: () => void;
  toggleRulers: () => void;
  toggleGuides: () => void;
  toggleSeamlessPattern: () => void;
  toggleDimSeamlessPattern: () => void;
  toggleSnapToGrid: () => void;
  setGridSize: (size: number) => void;
  setGuideColor: (color: Color) => void;
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
  /** Backward-compat setter. Reads should use modal directly:
   *  `modal?.kind === 'shapeSize' ? modal.click : null` */
  setPendingShapeClick: (pending: ShapeSizeClick | null) => void;
  adjustments: ImageAdjustments;
  adjustmentsEnabled: boolean;
  setAdjustments: (adj: ImageAdjustments) => void;
  setAdjustmentsEnabled: (enabled: boolean) => void;
  /** Backward-compat setter. Reads should use modal directly:
   *  `modal?.kind === 'strokePath' ? modal.pathId : null` */
  setStrokeModalPathId: (id: string | null) => void;
  editingAnchorIndex: number | null;
  setEditingAnchorIndex: (index: number | null) => void;
  convertingAnchorToSpline: boolean;
  setConvertingAnchorToSpline: (converting: boolean) => void;
  draggingHandle: { anchorIndex: number; handle: 'in' | 'out' } | null;
  setDraggingHandle: (handle: { anchorIndex: number; handle: 'in' | 'out' } | null) => void;
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
  textEditing: TextEditingState | null;
  textDrag: TextDragState | null;
  startTextEditing: (state: TextEditingState) => void;
  updateTextEditingText: (text: string, cursorPos: number) => void;
  updateTextEditingBounds: (bounds: TextEditingState['bounds']) => void;
  commitTextEditing: () => void;
  cancelTextEditing: () => void;
  setTextDrag: (drag: TextDragState | null) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  activeTool: 'move',
  showGrid: false,
  showRulers: true,
  showGuides: true,
  showSeamlessPattern: false,
  dimSeamlessPattern: true,
  snapToGrid: false,
  gridSize: 16,
  guideColor: { r: 0, g: 180, b: 255, a: 1 },
  sidebarCollapsed: false,
  pathAnchors: [],
  pathClosed: false,
  lassoPoints: [],
  cropRect: null,
  transform: null,
  activeTransformHandle: null,
  maskEditMode: false,
  modal: null,
  showEffectsDrawer: false,
  visiblePanels: new Set(
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
      ? []
      : ['color', 'layers'],
  ),
  cursorPosition: { x: 0, y: 0 },
  adjustments: { ...DEFAULT_ADJUSTMENTS },
  adjustmentsEnabled: true,
  setAdjustments: (adj) => set({ adjustments: adj }),
  setAdjustmentsEnabled: (enabled) => set({ adjustmentsEnabled: enabled }),
  gradientPreview: null,
  setCursorPosition: (pos) => set({ cursorPosition: pos }),
  setMaskEditMode: (mode) => set({ maskEditMode: mode }),

  // ─── Modal slot ────────────────────────────────────────────────────────
  openModal: (next) => set({ modal: next }),
  closeModal: () => set({ modal: null }),
  closeModalOfKind: (kind) => {
    if (get().modal?.kind === kind) set({ modal: null });
  },
  setShowNewDocumentModal: (show) => {
    if (show) get().openModal({ kind: 'newDocument' });
    else get().closeModalOfKind('newDocument');
  },
  setPendingShapeClick: (click) => {
    if (click) get().openModal({ kind: 'shapeSize', click });
    else get().closeModalOfKind('shapeSize');
  },
  setStrokeModalPathId: (id) => {
    if (id) get().openModal({ kind: 'strokePath', pathId: id });
    else get().closeModalOfKind('strokePath');
  },
  setShowBrushModal: (show) => {
    if (show) get().openModal({ kind: 'brush' });
    else get().closeModalOfKind('brush');
  },

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

  setActiveTool: (tool) => {
    const current = useUIStore.getState();
    // When switching away from text tool during editing, the editing session
    // is committed by the interaction handler (commitTextEditing) before
    // the tool switch occurs. Clear any stale editing state as a safety net.
    if (current.activeTool === 'text' && tool !== 'text' && current.textEditing) {
      set({ textEditing: null });
    }
    // Clear path when switching away from path tool
    if (current.activeTool === 'path' && tool !== 'path') {
      set({ activeTool: tool, pathAnchors: [], pathClosed: false });
    } else {
      set({ activeTool: tool });
    }
    toolRegistry[tool]?.onActivate?.();
  },
  toggleGrid: () => set((state) => {
    const showGrid = !state.showGrid;
    return showGrid ? { showGrid, snapToGrid: true } : { showGrid };
  }),
  toggleRulers: () => set((state) => ({ showRulers: !state.showRulers })),
  toggleGuides: () => set((state) => ({ showGuides: !state.showGuides })),
  toggleSeamlessPattern: () => set((state) => ({ showSeamlessPattern: !state.showSeamlessPattern })),
  toggleDimSeamlessPattern: () => set((state) => ({ dimSeamlessPattern: !state.dimSeamlessPattern })),
  toggleSnapToGrid: () => set((state) => ({ snapToGrid: !state.snapToGrid })),
  setGridSize: (size) => set({ gridSize: size }),
  setGuideColor: (color) => set({ guideColor: color }),
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
  editingAnchorIndex: null,
  setEditingAnchorIndex: (index) => set({ editingAnchorIndex: index }),
  convertingAnchorToSpline: false,
  setConvertingAnchorToSpline: (converting) => set({ convertingAnchorToSpline: converting }),
  draggingHandle: null,
  setDraggingHandle: (handle) => set({ draggingHandle: handle }),
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
  textEditing: null,
  textDrag: null,
  startTextEditing: (state) => set({ textEditing: state }),
  updateTextEditingText: (text, cursorPos) =>
    set((s) => s.textEditing ? { textEditing: { ...s.textEditing, text, cursorPos } } : {}),
  updateTextEditingBounds: (bounds) =>
    set((s) => s.textEditing ? { textEditing: { ...s.textEditing, bounds } } : {}),
  commitTextEditing: () => set({ textEditing: null }),
  cancelTextEditing: () => set({ textEditing: null }),
  setTextDrag: (drag) => set({ textDrag: drag }),
}));
