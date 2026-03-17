import type { MutableRefObject } from 'react';
import type { Point, ToolId, Layer, Rect } from '../../types';
import type { TransformHandle, TransformState } from '../../tools/transform/transform';
import type { PixelBuffer, MaskedPixelBuffer } from '../../engine/pixel-data';

export interface InteractionState {
  drawing: boolean;
  lastPoint: Point | null;
  pixelBuffer: PixelBuffer | null;
  originalPixelBuffer: PixelBuffer | null;
  layerId: string | null;
  tool: ToolId | null;
  startPoint: Point | null;
  layerStartX: number;
  layerStartY: number;
  maskMode: boolean;
  transformHandle: TransformHandle | null;
  transformStartState: TransformState | null;
  transformStartAngle: number;
  originalSelectionMask: Uint8ClampedArray | null;
  originalSelectionMaskWidth: number;
  originalSelectionMaskHeight: number;
  transformCanvas: HTMLCanvasElement | null;
  baseCanvas: HTMLCanvasElement | null;
  _scratchCanvas?: HTMLCanvasElement;
  _usedGpuStroke?: boolean;
  moveOriginalMask: Uint8ClampedArray | null;
  moveOriginalBounds: Rect | null;
}

export const DEFAULT_TRANSFORM_FIELDS = {
  maskMode: false,
  transformHandle: null as TransformHandle | null,
  transformStartState: null as TransformState | null,
  transformStartAngle: 0,
  originalSelectionMask: null as Uint8ClampedArray | null,
  originalSelectionMaskWidth: 0,
  originalSelectionMaskHeight: 0,
  transformCanvas: null as HTMLCanvasElement | null,
  baseCanvas: null as HTMLCanvasElement | null,
  moveOriginalMask: null as Uint8ClampedArray | null,
  moveOriginalBounds: null as Rect | null,
};

export interface FloatingSelection {
  floated: PixelBuffer;
  base: PixelBuffer;
  offsetX: number;
  offsetY: number;
  originalMask: Uint8ClampedArray;
  originalBounds: Rect;
}

export interface PersistentTransform {
  transformCanvas: HTMLCanvasElement;
  baseCanvas: HTMLCanvasElement;
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
}

export interface ToolHandler {
  down?: (ctx: InteractionContext) => InteractionState | undefined;
  move?: (ctx: InteractionContext, state: InteractionState) => void;
  up?: (ctx: InteractionContext, state: InteractionState) => void;
}
