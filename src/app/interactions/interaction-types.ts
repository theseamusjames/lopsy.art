import type { MutableRefObject } from 'react';
import type { Point, ToolId, Layer, Rect } from '../../types';
import type { TransformHandle, TransformState } from '../../tools/transform/transform';
import type { PixelBuffer, MaskedPixelBuffer } from '../../engine/pixel-data';

/**
 * Discriminated union describing which canvas gesture is active.
 * Replaces the previous bag-of-flags pattern where mutually-exclusive
 * states like `tiltShiftDragging` and `meshWarpDragging` could both
 * be true. The `kind` discriminant lets `switch` dispatch in the
 * move/up handlers with compile-time exhaustiveness checking.
 */
export type CanvasGesture =
  | { kind: 'idle' }
  | { kind: 'tool'; usedGpuStroke: boolean }
  | { kind: 'liquify' }
  | { kind: 'tiltShift' }
  | { kind: 'meshWarp' }
  | { kind: 'transform' };

/**
 * True when the active tool gesture is a paint stroke that started on
 * the GPU path (brush/pencil/eraser with engine available, outside
 * mask/quick-mask modes). Replaces the legacy `_usedGpuStroke?` flag
 * on InteractionState. Lives on the gesture variant so it can't be
 * set unless we're actually inside a `tool` gesture.
 */
export function gestureUsedGpuStroke(gesture: CanvasGesture): boolean {
  return gesture.kind === 'tool' && gesture.usedGpuStroke;
}

export const GESTURE_IDLE: CanvasGesture = { kind: 'idle' };

export interface InteractionState {
  drawing: boolean;
  gesture: CanvasGesture;
  lastPoint: Point | null;
  pixelBuffer: PixelBuffer | null;
  originalPixelBuffer: PixelBuffer | null;
  layerId: string | null;
  tool: ToolId | null;
  startPoint: Point | null;
  layerStartX: number;
  layerStartY: number;
  maskMode: boolean;
  quickMaskMode?: boolean;
  transformHandle: TransformHandle | null;
  transformStartState: TransformState | null;
  transformStartAngle: number;
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
  moveOriginalMask: Uint8ClampedArray | null;
  moveOriginalBounds: Rect | null;
  /** Quick-mask pixels captured at drag-start so we can translate the
   *  painted mask content with the marquee (#315). docW * docH bytes,
   *  single-channel (0..255). Only set when moving inside quick-mask mode
   *  with an active marquee. */
  quickMaskOriginalPixels?: Uint8Array | null;
  quickMaskOriginalWidth?: number;
  quickMaskOriginalHeight?: number;
  selectionOnlyTransform?: boolean;
  meshWarpDragging?: boolean;
  tiltShiftDragging?: boolean;
}

export const DEFAULT_TRANSFORM_FIELDS = {
  gesture: GESTURE_IDLE as CanvasGesture,
  maskMode: false,
  transformHandle: null as TransformHandle | null,
  transformStartState: null as TransformState | null,
  transformStartAngle: 0,
  originalSelectionMask: null as Uint8ClampedArray | null,
  originalSelectionMaskWidth: 0,
  originalSelectionMaskHeight: 0,
  moveOriginalMask: null as Uint8ClampedArray | null,
  moveOriginalBounds: null as Rect | null,
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
  pixelBuffer: PixelBuffer;
  paintSurface: PixelBuffer | MaskedPixelBuffer;
  clientX: number;
  clientY: number;
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
