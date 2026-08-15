import { create } from 'zustand';
import type { Color, Point, Rect, ToolId } from '../types';
import type { TransformHandle, TransformState } from '../tools/transform/transform';
import { DEFAULT_ADJUSTMENTS } from '../filters/image-adjustments';
import type { ImageAdjustments } from '../filters/image-adjustments';
import type { MeshWarpGrid } from '../filters/mesh-warp';
import type { LiquifySettings } from '../tools/liquify/liquify';
import { toolRegistry } from '../tools/tool-registry';
import { setVisiblePanelsSink, togglePanelById } from '../panels/dock/dock-ui-bridge';

export interface TextEditingState {
  layerId: string;
  bounds: { x: number; y: number; width: number | null; height: number | null };
  text: string;
  cursorPos: number;
  /**
   * The other end of an active selection (the fixed anchor; `cursorPos` is the
   * moving end). `null` when there is no selection. The selected range is
   * `[min(anchor, cursorPos), max(anchor, cursorPos))`. Offsets are UTF-16
   * string indices, matching `cursorPos`.
   */
  selectionAnchor: number | null;
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
  /**
   * True when Cmd/Ctrl is held: `position` is snapped to a fraction of
   * the document dimension, and the ruler label should render as the
   * fraction (e.g. "1/2") instead of a pixel value.
   */
  snap: boolean;
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
  | { kind: 'loading'; message: string }
  | { kind: 'adjustmentLayerInfo' };

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
  /** When enabled alongside `showSeamlessPattern`, layer compositing wraps
   *  at the document edges — content moved off one side reappears on the
   *  opposite side. The layer texture is left untouched so repeated moves
   *  operate on the original pixels, not on the already-wrapped result. */
  wrapSeamlessPattern: boolean;
  snapToGrid: boolean;
  snapToLayers: boolean;
  /** Temporary snap alignment lines shown during move/transform. */
  snapLines: readonly SnapLine[];
  gridSize: number;
  guideColor: Color;
  /** In-progress path being drawn with the path tool. null when the tool
   *  is inactive or has been cleared. `closed` is only meaningful while
   *  draft exists; closing without anchors was previously representable
   *  but nonsense. */
  pathDraft: { anchors: PathAnchor[]; closed: boolean } | null;
  lassoPoints: Point[];
  cropRect: { x: number; y: number; width: number; height: number } | null;
  /** When set, the crop tool is in perspective mode with 4 draggable corners. */
  perspectiveCropQuad: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  } | null;
  /** Index of the perspective crop corner being dragged (0=TL,1=TR,2=BR,3=BL), or null. */
  perspectiveCropDragging: 0 | 1 | 2 | 3 | null;
  transform: TransformState | null;
  activeTransformHandle: TransformHandle | null;
  meshWarp: MeshWarpSession | null;
  tiltShift: TiltShiftSession | null;
  liquify: LiquifySession | null;
  /** Discriminates between editing a layer mask, editing the global quick
   *  mask, and neither. Replaces the prior pair of mutually-exclusive
   *  booleans (maskEditMode + isQuickMaskMode) — the illegal "both true"
   *  combination is now unrepresentable. */
  maskMode: 'off' | 'layerMask' | 'quickMask';
  /** Active modal, or null when nothing is open. Only one at a time. */
  modal: ModalState | null;
  showEffectsDrawer: boolean;
  showReferenceModal: boolean;
  visiblePanels: Set<string>;
  cursorPosition: Point;
  cursorOnCanvas: boolean;
  gradientPreview: { start: Point; end: Point } | null;
  /**
   * #666 — Origin of the next shift-click line for paint tools (brush,
   * pencil, eraser). The paint handlers set this on pointer-up so the
   * pointer-move handler can materialize a preview line while shift is
   * held. `point` is layer-local; `layerId` is the layer it was painted
   * on (so we suppress the preview when the active layer changes).
   */
  lastPaintPoint: { point: Point; layerId: string } | null;
  /**
   * #666 — Preview line drawn while the user is hovering with shift held
   * after painting a point. `snapped` is true when meta/cmd is also held
   * and the line has been locked to the nearest 15° angle. Points are in
   * layer-local coords (matches `lastPaintPoint.point`).
   */
  paintLinePreview: { start: Point; end: Point; snapped: boolean } | null;
  setCursorPosition: (pos: Point) => void;
  setCursorOnCanvas: (onCanvas: boolean) => void;
  setLastPaintPoint: (p: { point: Point; layerId: string } | null) => void;
  setPaintLinePreview: (preview: { start: Point; end: Point; snapped: boolean } | null) => void;
  setMaskEditMode: (mode: boolean) => void;
  toggleQuickMaskMode: () => void;
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
  toggleWrapSeamlessPattern: () => void;
  toggleSnapToGrid: () => void;
  toggleSnapToLayers: () => void;
  setSnapLines: (lines: readonly SnapLine[]) => void;
  clearSnapLines: () => void;
  setGridSize: (size: number) => void;
  setGuideColor: (color: Color) => void;
  addPathAnchor: (anchor: PathAnchor) => void;
  updateLastPathAnchor: (anchor: PathAnchor) => void;
  closePath: () => void;
  clearPath: () => void;
  setLassoPoints: (points: Point[]) => void;
  clearLassoPoints: () => void;
  setCropRect: (rect: { x: number; y: number; width: number; height: number } | null) => void;
  setPerspectiveCropQuad: (quad: UIState['perspectiveCropQuad']) => void;
  setPerspectiveCropDragging: (idx: 0 | 1 | 2 | 3 | null) => void;
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
  updateTextEditingSelection: (
    text: string,
    cursorPos: number,
    selectionAnchor: number | null,
  ) => void;
  updateTextEditingBounds: (bounds: TextEditingState['bounds']) => void;
  commitTextEditing: () => void;
  cancelTextEditing: () => void;
  setTextDrag: (drag: TextDragState | null) => void;
  channelVisibility: ChannelVisibility;
  activeChannel: ActiveChannel;
  toggleChannelVisibility: (channel: keyof ChannelVisibility) => void;
  setActiveChannel: (channel: ActiveChannel) => void;
  /** True while a paint stroke (brush/pencil/eraser) is in progress. Used by
   *  panels that read back from the GPU (e.g. NavigatorPanel) to skip
   *  expensive readback during the brush hot path. */
  isStroking: boolean;
  setIsStroking: (stroking: boolean) => void;
  /** True while ANY pointer gesture is active — tool drag, pan, or pinch/zoom
   *  — not just paint strokes. Set by useCanvasPointerHandlers on any
   *  interaction start and cleared when the last active pointer ends. Panels
   *  that read back from the GPU key off this instead of `isStroking` so the
   *  readback is paused during every drag, not only paint strokes (#682). */
  isInteracting: boolean;
  setIsInteracting: (interacting: boolean) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  activeTool: 'move',
  showGrid: false,
  showPixelGrid: true,
  showRulers: true,
  showGuides: true,
  showSeamlessPattern: false,
  dimSeamlessPattern: true,
  wrapSeamlessPattern: false,
  snapToGrid: false,
  snapToLayers: false,
  snapLines: [],
  gridSize: 16,
  guideColor: { r: 0, g: 180, b: 255, a: 1 },
  pathDraft: null,
  lassoPoints: [],
  cropRect: null,
  perspectiveCropQuad: null,
  perspectiveCropDragging: null,
  transform: null,
  activeTransformHandle: null,
  meshWarp: null,
  tiltShift: null,
  liquify: null,
  maskMode: 'off',
  modal: null,
  showEffectsDrawer: false,
  showReferenceModal: false,
  visiblePanels: new Set(
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
      ? []
      : ['color', 'info', 'layers', 'channels'],
  ),
  cursorPosition: { x: 0, y: 0 },
  cursorOnCanvas: false,
  adjustments: { ...DEFAULT_ADJUSTMENTS },
  adjustmentsEnabled: true,
  setAdjustments: (adj) => set({ adjustments: adj }),
  setAdjustmentsEnabled: (enabled) => set({ adjustmentsEnabled: enabled }),
  gradientPreview: null,
  lastPaintPoint: null,
  paintLinePreview: null,
  setCursorPosition: (pos) => set({ cursorPosition: pos }),
  setCursorOnCanvas: (onCanvas) => set({ cursorOnCanvas: onCanvas }),
  setLastPaintPoint: (p) => set({ lastPaintPoint: p, paintLinePreview: null }),
  setPaintLinePreview: (preview) => set({ paintLinePreview: preview }),
  setMaskEditMode: (mode) => set({ maskMode: mode ? 'layerMask' : 'off' }),
  toggleQuickMaskMode: () => set((state) => ({
    maskMode: state.maskMode === 'quickMask' ? 'off' : 'quickMask',
  })),

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
  // The dock store owns panel layout; `visiblePanels` here is a read-only
  // mirror it maintains. Toggling delegates through a bridge (no import cycle).
  togglePanel: (panelId) => togglePanelById(panelId),
  setGradientPreview: (preview) => set({ gradientPreview: preview }),

  setActiveTool: (tool) => {
    const current = useUIStore.getState();
    if (current.activeTool === tool) return;
    toolRegistry[current.activeTool]?.onDeactivate?.();
    // #666 — leaving a paint tool means the shift-line origin is stale.
    // Suppress the preview until the user paints a fresh point.
    const preview = null;
    if (current.activeTool === 'path' && tool !== 'path') {
      set({ activeTool: tool, pathDraft: null, paintLinePreview: preview });
    } else if (current.activeTool === 'crop' && tool !== 'crop') {
      set({ activeTool: tool, perspectiveCropQuad: null, perspectiveCropDragging: null, paintLinePreview: preview });
    } else {
      set({ activeTool: tool, paintLinePreview: preview });
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
  toggleWrapSeamlessPattern: () => set((state) => ({ wrapSeamlessPattern: !state.wrapSeamlessPattern })),
  toggleSnapToGrid: () => set((state) => ({ snapToGrid: !state.snapToGrid })),
  toggleSnapToLayers: () => set((state) => ({ snapToLayers: !state.snapToLayers })),
  setSnapLines: (lines) => set({ snapLines: lines }),
  clearSnapLines: () => set({ snapLines: [] }),
  setGridSize: (size) => set({ gridSize: size }),
  setGuideColor: (color) => set({ guideColor: color }),
  addPathAnchor: (anchor) =>
    set((state) => {
      const prev = state.pathDraft;
      const anchors = prev ? [...prev.anchors, anchor] : [anchor];
      return { pathDraft: { anchors, closed: prev?.closed ?? false } };
    }),
  updateLastPathAnchor: (anchor) =>
    set((state) => {
      const prev = state.pathDraft;
      if (!prev || prev.anchors.length === 0) return {};
      const anchors = [...prev.anchors];
      anchors[anchors.length - 1] = anchor;
      return { pathDraft: { anchors, closed: prev.closed } };
    }),
  closePath: () =>
    set((state) => {
      const prev = state.pathDraft;
      if (!prev) return {};
      return { pathDraft: { anchors: prev.anchors, closed: true } };
    }),
  clearPath: () => set({ pathDraft: null }),
  setLassoPoints: (points) => set({ lassoPoints: points }),
  clearLassoPoints: () => set({ lassoPoints: [] }),
  setCropRect: (rect) => set({ cropRect: rect }),
  setPerspectiveCropQuad: (quad) => set({ perspectiveCropQuad: quad }),
  setPerspectiveCropDragging: (idx) => set({ perspectiveCropDragging: idx }),
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
    set((s) => s.textEditing
      ? { textEditing: { ...s.textEditing, text, cursorPos, selectionAnchor: null } }
      : {}),
  updateTextEditingSelection: (text, cursorPos, selectionAnchor) =>
    set((s) => s.textEditing
      ? { textEditing: { ...s.textEditing, text, cursorPos, selectionAnchor } }
      : {}),
  updateTextEditingBounds: (bounds) =>
    // Moving/resizing the box drops any active selection.
    set((s) => s.textEditing
      ? { textEditing: { ...s.textEditing, bounds, selectionAnchor: null } }
      : {}),
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
  isStroking: false,
  setIsStroking: (stroking) => {
    if (get().isStroking !== stroking) set({ isStroking: stroking });
  },
  isInteracting: false,
  setIsInteracting: (interacting) => {
    if (get().isInteracting !== interacting) set({ isInteracting: interacting });
  },
}));

// The dock store owns which panels are open; mirror its published set into
// `visiblePanels` (registered via the bridge to avoid an import cycle).
setVisiblePanelsSink((panels) => useUIStore.setState({ visiblePanels: panels }));
