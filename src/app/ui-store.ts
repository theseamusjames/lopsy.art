import { create } from 'zustand';
import type { Color, Point, Rect, ToolId } from '../types';
import type { TransformHandle, TransformState } from '../tools/transform/transform';
import { DEFAULT_ADJUSTMENTS } from '../filters/image-adjustments';
import type { ImageAdjustments } from '../filters/image-adjustments';
import type { MeshWarpGrid } from '../filters/mesh-warp';
import type { DisplacementMap, LiquifySettings } from '../tools/liquify/liquify';
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

export interface TiltShiftSession {
  focusPosition: number;
  focusWidth: number;
  blurRadius: number;
  angle: number;
  dragging: 'line1' | 'line2' | 'center' | 'angle' | null;
  dragAnchor: number;
  previewActive: boolean;
}

/**
 * Active inline mesh warp session. The grid lives on the canvas as an overlay
 * (no modal). `bounds` is the document-space rect the grid covers — set from
 * the selection bounding box on activation, or the whole document.
 */
export interface MeshWarpSession {
  grid: MeshWarpGrid;
  gridSize: number;
  bounds: Rect;
  /** Index of the grid point currently being dragged, or null. */
  dragging: number | null;
  /** Index of the grid point currently hovered, or null. */
  hovered: number | null;
  /** Whether the user has armed live preview. */
  previewActive: boolean;
}

/**
 * Active Liquify session. The floating panel lives on top of the canvas.
 * The GPU engine holds a backup of the original layer texture (via
 * saveFilterPreview) — restored on Cancel or used as the warp source
 * during preview.
 */
export interface LiquifySession {
  layerId: string;
  layerWidth: number;
  layerHeight: number;
  displacementMap: DisplacementMap;
  encodedDisplacement: Uint8Array;
  settings: LiquifySettings;
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

export interface SnapLine {
  orientation: 'vertical' | 'horizontal';
  position: number;
}

export type ActiveChannel = 'rgb' | 'r' | 'g' | 'b' | 'a';

export interface ChannelVisibility {
  r: boolean;
  g: boolean;
  b: boolean;
  a: boolean;
}

interface UIState {
  activeTool: ToolId;
  showGrid: boolean;
  showPixelGrid: boolean;
  showRulers: boolean;
  showGuides: boolean;
  showSeamlessPattern: boolean;
  dimSeamlessPattern: boolean;
  snapToGrid: boolean;
  snapToLayers: boolean;
  /** Temporary snap alignment lines shown during move/transform. */
  snapLines: readonly SnapLine[];
  gridSize: number;
  guideColor: Color;
  sidebarCollapsed: boolean;
  pathAnchors: PathAnchor[];
  pathClosed: boolean;
  lassoPoints: Point[];
  cropRect: { x: number; y: number; width: number; height: number } | null;
  transform: TransformState | null;
  activeTransformHandle: TransformHandle | null;
  meshWarp: MeshWarpSession | null;
  tiltShift: TiltShiftSession | null;
  liquify: LiquifySession | null;
  maskEditMode: boolean;
  isQuickMaskMode: boolean;
  /** Active modal, or null when nothing is open. Only one at a time. */
  modal: ModalState | null;
  showEffectsDrawer: boolean;
  showReferenceModal: boolean;
  visiblePanels: Set<string>;
  cursorPosition: Point;
  cursorOnCanvas: boolean;
  gradientPreview: { start: Point; end: Point } | null;
  /** Index into undoStack (1-based, 0 = initial state) for the history brush source. null = unset. */
  historyBrushSourceIndex: number | null;
  setCursorPosition: (pos: Point) => void;
  setCursorOnCanvas: (onCanvas: boolean) => void;
  setMaskEditMode: (mode: boolean) => void;
  toggleQuickMaskMode: () => void;
  setHistoryBrushSourceIndex: (index: number | null) => void;
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
  setShowReferenceModal: (show: boolean) => void;
  togglePanel: (panelId: string) => void;
  setGradientPreview: (preview: { start: Point; end: Point } | null) => void;
  setActiveTool: (tool: ToolId) => void;
  toggleGrid: () => void;
  togglePixelGrid: () => void;
  toggleRulers: () => void;
  toggleGuides: () => void;
  toggleSeamlessPattern: () => void;
  toggleDimSeamlessPattern: () => void;
  toggleSnapToGrid: () => void;
  toggleSnapToLayers: () => void;
  setSnapLines: (lines: readonly SnapLine[]) => void;
  clearSnapLines: () => void;
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
  setMeshWarp: (session: MeshWarpSession | null) => void;
  updateMeshWarpGrid: (grid: MeshWarpGrid) => void;
  setMeshWarpDragging: (idx: number | null) => void;
  setMeshWarpHovered: (idx: number | null) => void;
  setMeshWarpPreview: (active: boolean) => void;
  setTiltShift: (session: TiltShiftSession | null) => void;
  updateTiltShift: (update: Partial<TiltShiftSession>) => void;
  setTiltShiftDragging: (target: TiltShiftSession['dragging'], anchor?: number) => void;
  setLiquify: (session: LiquifySession | null) => void;
  updateLiquifySettings: (settings: LiquifySettings) => void;
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
  channelVisibility: ChannelVisibility;
  activeChannel: ActiveChannel;
  toggleChannelVisibility: (channel: keyof ChannelVisibility) => void;
  setActiveChannel: (channel: ActiveChannel) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  activeTool: 'move',
  showGrid: false,
  showPixelGrid: true,
  showRulers: true,
  showGuides: true,
  showSeamlessPattern: false,
  dimSeamlessPattern: true,
  snapToGrid: false,
  snapToLayers: false,
  snapLines: [],
  gridSize: 16,
  guideColor: { r: 0, g: 180, b: 255, a: 1 },
  sidebarCollapsed: false,
  pathAnchors: [],
  pathClosed: false,
  lassoPoints: [],
  cropRect: null,
  transform: null,
  activeTransformHandle: null,
  meshWarp: null,
  tiltShift: null,
  liquify: null,
  maskEditMode: false,
  isQuickMaskMode: false,
  modal: null,
  showEffectsDrawer: false,
  showReferenceModal: false,
  visiblePanels: new Set(
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
      ? []
      : ['color', 'layers'],
  ),
  cursorPosition: { x: 0, y: 0 },
  cursorOnCanvas: false,
  adjustments: { ...DEFAULT_ADJUSTMENTS },
  adjustmentsEnabled: true,
  setAdjustments: (adj) => set({ adjustments: adj }),
  setAdjustmentsEnabled: (enabled) => set({ adjustmentsEnabled: enabled }),
  gradientPreview: null,
  historyBrushSourceIndex: null,
  setCursorPosition: (pos) => set({ cursorPosition: pos }),
  setCursorOnCanvas: (onCanvas) => set({ cursorOnCanvas: onCanvas }),
  setMaskEditMode: (mode) => set({ maskEditMode: mode }),
  toggleQuickMaskMode: () => set((state) => ({ isQuickMaskMode: !state.isQuickMaskMode })),
  setHistoryBrushSourceIndex: (index) => set({ historyBrushSourceIndex: index }),

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
  setShowReferenceModal: (show) => set({ showReferenceModal: show }),
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
    if (current.activeTool !== tool) {
      toolRegistry[current.activeTool]?.onDeactivate?.();
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
  togglePixelGrid: () => set((state) => ({ showPixelGrid: !state.showPixelGrid })),
  toggleRulers: () => set((state) => ({ showRulers: !state.showRulers })),
  toggleGuides: () => set((state) => ({ showGuides: !state.showGuides })),
  toggleSeamlessPattern: () => set((state) => ({ showSeamlessPattern: !state.showSeamlessPattern })),
  toggleDimSeamlessPattern: () => set((state) => ({ dimSeamlessPattern: !state.dimSeamlessPattern })),
  toggleSnapToGrid: () => set((state) => ({ snapToGrid: !state.snapToGrid })),
  toggleSnapToLayers: () => set((state) => ({ snapToLayers: !state.snapToLayers })),
  setSnapLines: (lines) => set({ snapLines: lines }),
  clearSnapLines: () => set({ snapLines: [] }),
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
  setMeshWarp: (session) => set({ meshWarp: session }),
  updateMeshWarpGrid: (grid) =>
    set((s) => (s.meshWarp ? { meshWarp: { ...s.meshWarp, grid } } : {})),
  setMeshWarpDragging: (idx) =>
    set((s) => (s.meshWarp ? { meshWarp: { ...s.meshWarp, dragging: idx } } : {})),
  setMeshWarpHovered: (idx) =>
    set((s) => (s.meshWarp ? { meshWarp: { ...s.meshWarp, hovered: idx } } : {})),
  setMeshWarpPreview: (active) =>
    set((s) => (s.meshWarp ? { meshWarp: { ...s.meshWarp, previewActive: active } } : {})),
  setTiltShift: (session) => set({ tiltShift: session }),
  updateTiltShift: (update) =>
    set((s) => (s.tiltShift ? { tiltShift: { ...s.tiltShift, ...update } } : {})),
  setTiltShiftDragging: (target, anchor) =>
    set((s) => (s.tiltShift ? { tiltShift: { ...s.tiltShift, dragging: target, dragAnchor: anchor ?? s.tiltShift.dragAnchor } } : {})),
  setLiquify: (session) => set({ liquify: session }),
  updateLiquifySettings: (settings) =>
    set((s) => (s.liquify ? { liquify: { ...s.liquify, settings } } : {})),
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
  channelVisibility: { r: true, g: true, b: true, a: true },
  activeChannel: 'rgb',
  toggleChannelVisibility: (channel) =>
    set((s) => ({
      channelVisibility: { ...s.channelVisibility, [channel]: !s.channelVisibility[channel] },
    })),
  setActiveChannel: (channel) => set({ activeChannel: channel }),
}));
