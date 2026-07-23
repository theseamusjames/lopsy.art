import type { MutableRefObject } from 'react';
import type { Point, ToolId, Layer, Rect } from '../../types';
import type { TransformHandle, TransformState } from '../../tools/transform/transform';

/**
 * Discriminated union describing which canvas gesture is active.
 * Replaces the previous bag-of-flags pattern where mutually-exclusive
 * states like `tiltShiftDragging` and `meshWarpDragging` could both
 * be true. The `kind` discriminant lets `switch` dispatch in the
 * move/up handlers with compile-time exhaustiveness checking.
 *
 * Per-gesture data lives on its variant so the type system guarantees
 * the data is present whenever the discriminant says so — handlers can
 * narrow on `kind` and drop the `!` non-null assertions that the old
 * bag-of-flags shape forced (see transform-handlers.ts).
 */
export type CanvasGesture =
  | { kind: 'idle' }
  | { kind: 'paint'; usedGpuStroke: boolean }
  | {
      /**
       * Move-tool drag. #444 — split out from the catch-all `tool` variant
       * so the move-specific payload (marquee snapshot, quick-mask pixel
       * snapshot) lives inline on the gesture instead of hanging on
       * InteractionState as optional fields.
       */
      kind: 'move';
      originalMask: Uint8ClampedArray | null;
      originalBounds: Rect | null;
      /** Quick-mask pixels captured at drag-start so we can translate the
       *  painted mask content with the marquee (#315). docW*docH bytes,
       *  single-channel. Null when not moving in quick-mask mode. */
      quickMaskOriginalPixels: Uint8Array | null;
      quickMaskOriginalWidth: number;
      quickMaskOriginalHeight: number;
    }
  | { kind: 'tool' }
  | { kind: 'liquify'; lastPoint: Point }
  | { kind: 'tiltShift' }
  | { kind: 'meshWarp' }
  | {
      kind: 'transform';
      handle: TransformHandle;
      startState: TransformState;
      startAngle: number;
      selectionOnly: boolean;
    };

/**
 * True when the active gesture is a paint stroke that started on the
 * GPU path (brush/pencil/eraser with engine available, outside mask/
 * quick-mask modes). Structurally scoped to the `paint` variant so
 * non-paint tool gestures can't accidentally claim a GPU stroke.
 * Replaces the legacy `_usedGpuStroke?` flag on InteractionState (#444).
 */
export function gestureUsedGpuStroke(gesture: CanvasGesture): boolean {
  return gesture.kind === 'paint' && gesture.usedGpuStroke;
}

/**
 * Construct a paint-gesture InteractionState from a paint-tool down
 * handler's freshly-returned state, without mutating the input. Only
 * paint tools (brush/pencil/eraser) carry the `usedGpuStroke` flag;
 * splitting them out from the generic `tool` variant means the type
 * system now guarantees a `tool` gesture can't claim a GPU stroke (#444).
 */
export function withPaintGesture(state: InteractionState, usedGpuStroke: boolean): InteractionState {
  return { ...state, gesture: { kind: 'paint', usedGpuStroke } };
}

/**
 * Construct a non-paint tool-gesture InteractionState from a down
 * handler's freshly-returned state, without mutating the input. The
 * dispatcher used to write `newState.gesture = { kind: 'tool', … }`
 * directly on the returned object — the audit issue (#444) calls out
 * post-return mutation as the bag-of-flags smell.
 */
export function withToolGesture(state: InteractionState): InteractionState {
  return { ...state, gesture: { kind: 'tool' } };
}

/**
 * Construct an InteractionState for the move-tool drag, packing the marquee
 * snapshot and quick-mask pixel snapshot inline on the gesture variant.
 * The optional `moveOriginal*` / `quickMaskOriginal*` fields on
 * InteractionState were removed in favour of this payload (#444).
 */
export function withMoveGesture(
  state: InteractionState,
  payload: {
    originalMask?: Uint8ClampedArray | null;
    originalBounds?: Rect | null;
    quickMaskOriginalPixels?: Uint8Array | null;
    quickMaskOriginalWidth?: number;
    quickMaskOriginalHeight?: number;
  },
): InteractionState {
  return {
    ...state,
    gesture: {
      kind: 'move',
      originalMask: payload.originalMask ?? null,
      originalBounds: payload.originalBounds ?? null,
      quickMaskOriginalPixels: payload.quickMaskOriginalPixels ?? null,
      quickMaskOriginalWidth: payload.quickMaskOriginalWidth ?? 0,
      quickMaskOriginalHeight: payload.quickMaskOriginalHeight ?? 0,
    },
  };
}

/**
 * Decide which gesture variant a down handler's freshly-returned state
 * should carry. Paint tools always get the paint variant (it is the
 * dispatcher, not the handler, that knows whether the stroke went down
 * the GPU path). Every other tool keeps whatever variant its handler
 * already chose — `handleMoveDown` packs the marquee and quick-mask
 * snapshots inline on the `move` variant, and blanket-wrapping it in the
 * generic `tool` gesture silently discarded them, leaving the selection
 * marquee pinned in place while the pixels moved under it.
 */
export function resolveDownGesture(
  state: InteractionState,
  opts: { isPaintTool: boolean; usedGpuStroke: boolean },
): InteractionState {
  if (opts.isPaintTool) return withPaintGesture(state, opts.usedGpuStroke);
  if (state.gesture.kind !== 'idle') return state;
  return withToolGesture(state);
}

export const GESTURE_IDLE: CanvasGesture = { kind: 'idle' };

/**
 * Baseline InteractionState used both for stateRef initialization and as
 * a template for handlers that need to return a fresh state with a single
 * gesture variant slotted in. Exported so pre-tool down handlers can
 * construct their own state — see PRE_TOOL_DOWN_GUARDS in
 * useCanvasInteraction.ts.
 */
export const INITIAL_INTERACTION_STATE: InteractionState = {
  drawing: false,
  gesture: GESTURE_IDLE,
  lastPoint: null,
  layerId: null,
  tool: null,
  startPoint: null,
  layerStartX: 0,
  layerStartY: 0,
  maskMode: false,
  originalSelectionMask: null,
  originalSelectionMaskWidth: 0,
  originalSelectionMaskHeight: 0,
};

/**
 * Signature shared by all pre-tool down guards (liquify, tilt-shift,
 * mesh-warp). Each guard inspects ambient session state, decides whether
 * to claim the gesture, and either returns a fully-populated
 * InteractionState (its variant constructed inline) or `null` to fall
 * through to the next guard. Replaces the priority-encoded if-ladder
 * that previously lived in useCanvasInteraction.ts (#444).
 */
export type PreToolDownGuard = (
  canvasPos: Point,
  activeLayerId: string,
) => InteractionState | null;

export interface InteractionState {
  drawing: boolean;
  gesture: CanvasGesture;
  lastPoint: Point | null;
  layerId: string | null;
  tool: ToolId | null;
  startPoint: Point | null;
  layerStartX: number;
  layerStartY: number;
  maskMode: boolean;
  quickMaskMode?: boolean;
  originalSelectionMask: Uint8ClampedArray | null;
  originalSelectionMaskWidth: number;
  originalSelectionMaskHeight: number;
  strokeDistance?: number;
  spacingRemainder?: number;
  symmetryCenter?: Point;
  strokePoints?: Array<{ x: number; y: number }>;
  strokeColor?: { r: number; g: number; b: number; a: number };
  lastPointTime?: number;
  smoothedSpeed?: number;
  speedHistory?: number[];
  speedSizeCurrent?: number;
  sizeJitterCurrent?: number;
  sizeJitterTarget?: number;
  sizeJitterPrevTarget?: number;
  sizeJitterTransitionDist?: number;
  sizeJitterDistTraveled?: number;
  hardnessJitterCurrent?: number;
  hardnessJitterTarget?: number;
  hardnessJitterPrevTarget?: number;
  hardnessJitterTransitionDist?: number;
  hardnessJitterDistTraveled?: number;
  /**
   * NOTE (#444): move-tool fields (`moveOriginalMask`, `moveOriginalBounds`,
   * `quickMaskOriginal*`) used to live here as optional top-level fields.
   * They now live inline on the `move` variant of `CanvasGesture` — see
   * `withMoveGesture`. Access via `state.gesture.kind === 'move' &&
   * state.gesture.originalMask` etc. so the type system enforces they're
   * only touched during a move gesture.
   */
}

export const DEFAULT_TRANSFORM_FIELDS = {
  gesture: GESTURE_IDLE as CanvasGesture,
  maskMode: false,
  originalSelectionMask: null as Uint8ClampedArray | null,
  originalSelectionMaskWidth: 0,
  originalSelectionMaskHeight: 0,
};

export interface FloatingSelection {
  offsetX: number;
  offsetY: number;
  originalMask: Uint8ClampedArray;
  originalBounds: Rect;
  gpuResident: true;
}

export interface PersistentTransform {
  originalMask: Uint8ClampedArray;
  maskWidth: number;
  maskHeight: number;
}

export interface LastPaintPoint {
  point: Point;
  layerId: string;
}

export interface InteractionContext {
  canvasPos: Point;
  layerPos: Point;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  activeLayerId: string;
  activeLayer: Layer;
  clientX: number;
  clientY: number;
  /** Click count (MouseEvent.detail); 2 for a double-click. */
  clickDetail?: number;
  screenToCanvas?: (sx: number, sy: number) => Point;
  containerRef?: MutableRefObject<HTMLDivElement | null>;
  stateRef: MutableRefObject<InteractionState>;
  floatingSelectionRef: MutableRefObject<FloatingSelection | null>;
  persistentTransformRef: MutableRefObject<PersistentTransform | null>;
  stampSourceRef: MutableRefObject<Point | null>;
  stampOffsetRef: MutableRefObject<Point | null>;
  lastPaintPointRef: MutableRefObject<LastPaintPoint | null>;
  /** True when this mousedown continues a previous stroke via shift-click. */
  isStrokeContinuation?: boolean;
}

export interface ToolHandler {
  down?: (ctx: InteractionContext) => InteractionState | undefined;
  move?: (ctx: InteractionContext, state: InteractionState) => void;
  up?: (ctx: InteractionContext, state: InteractionState) => void;
}
