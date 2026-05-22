import type { InteractionState, InteractionContext } from './interaction-types';
import type { Point } from '../../types';
import type { SelectionToolId } from './selection-strategy';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { useToolSettingsStore } from '../tool-settings-store';
import {
  createRectSelection as tsCreateRectSelection,
  createEllipseSelection as tsCreateEllipseSelection,
  selectionBounds as tsSelectionBounds,
  featherSelection,
} from '../../selection/selection';
import {
  createRectSelection as wasmCreateRectSelection,
  createEllipseSelection as wasmCreateEllipseSelection,
  selectionBounds as wasmSelectionBounds,
  createPolygonMask as wasmCreatePolygonMask,
} from '../../engine-wasm/wasm-bridge';
import { createPolygonMask as tsCreatePolygonMask } from '../../tools/lasso/lasso';
import { createTransformState } from '../../tools/transform/transform';
import { marqueeStrategy } from '../../tools/marquee/marquee-strategy';
import { wandStrategy } from '../../tools/wand/wand-strategy';
import { lassoStrategy } from '../../tools/lasso/lasso-strategy';
import { magneticLassoStrategy } from '../../tools/magnetic-lasso/magnetic-lasso-strategy';
import type { SelectionToolStrategy } from './selection-strategy';

const STRATEGY_MAP: Record<SelectionToolId, SelectionToolStrategy> = {
  'marquee-rect': marqueeStrategy,
  'marquee-ellipse': marqueeStrategy,
  'wand': wandStrategy,
  'lasso': lassoStrategy,
  'lasso-magnetic': magneticLassoStrategy,
};

// ── Shared helpers used by strategies ────────────────────────────────────

export function constrainMarqueeSize(
  rawW: number,
  rawH: number,
  options: {
    metaPressed: boolean;
    aspectRatioLocked: boolean;
    aspectRatioW: number;
    aspectRatioH: number;
  },
): { w: number; h: number } {
  const w0 = Math.abs(rawW);
  const h0 = Math.abs(rawH);
  const useLock = options.metaPressed
    || (options.aspectRatioLocked && options.aspectRatioW > 0 && options.aspectRatioH > 0);
  if (!useLock) return { w: w0, h: h0 };
  const ratio = options.metaPressed
    ? 1
    : options.aspectRatioW / options.aspectRatioH;
  if (h0 === 0) return { w: 0, h: 0 };
  if (w0 / h0 > ratio) {
    return { w: h0 * ratio, h: h0 };
  }
  return { w: w0, h: w0 / ratio };
}

export function commitFeatheredSelection(
  bounds: { x: number; y: number; width: number; height: number },
  mask: Uint8ClampedArray,
  docW: number,
  docH: number,
): void {
  const featherRadius = useToolSettingsStore.getState().marqueeFeather;
  const editorState = useEditorStore.getState();
  if (featherRadius > 0) {
    const feathered = featherSelection(mask, docW, docH, featherRadius);
    const newBounds = selectionBounds(feathered, docW, docH);
    if (newBounds) {
      editorState.setSelection(newBounds, feathered, docW, docH);
      useUIStore.getState().setTransform(createTransformState(newBounds));
      return;
    }
  }
  editorState.setSelection(bounds, mask, docW, docH);
  useUIStore.getState().setTransform(createTransformState(bounds));
}

export function createRectSelection(
  rect: { x: number; y: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
): Uint8ClampedArray {
  try {
    const result = wasmCreateRectSelection(
      canvasWidth, canvasHeight,
      Math.floor(rect.x), Math.floor(rect.y),
      Math.ceil(rect.width), Math.ceil(rect.height),
    );
    return new Uint8ClampedArray(result);
  } catch {
    return tsCreateRectSelection(rect, canvasWidth, canvasHeight);
  }
}

export function createEllipseSelection(
  rect: { x: number; y: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
): Uint8ClampedArray {
  try {
    const result = wasmCreateEllipseSelection(
      canvasWidth, canvasHeight,
      Math.floor(rect.x), Math.floor(rect.y),
      Math.ceil(rect.width), Math.ceil(rect.height),
    );
    return new Uint8ClampedArray(result);
  } catch {
    return tsCreateEllipseSelection(rect, canvasWidth, canvasHeight);
  }
}

export function selectionBounds(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } | null {
  try {
    const u8Mask = new Uint8Array(mask.buffer, mask.byteOffset, mask.byteLength);
    const result = wasmSelectionBounds(u8Mask, width, height);
    if (result.length < 4) return null;
    return { x: result[0]!, y: result[1]!, width: result[2]!, height: result[3]! };
  } catch {
    return tsSelectionBounds(mask, width, height);
  }
}

export function createPolygonMask(
  points: Point[],
  width: number,
  height: number,
): Uint8ClampedArray {
  try {
    const flat = new Float64Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
      flat[i * 2] = points[i]!.x;
      flat[i * 2 + 1] = points[i]!.y;
    }
    const result = wasmCreatePolygonMask(flat, width, height);
    return new Uint8ClampedArray(result);
  } catch {
    return tsCreatePolygonMask(points, width, height);
  }
}

// ── Dispatchers ──────────────────────────────────────────────────────────

export function handleSelectionDown(
  ctx: InteractionContext,
  tool: SelectionToolId,
): InteractionState | undefined {
  return STRATEGY_MAP[tool].onDown(ctx, tool);
}

export function handleSelectionMove(
  state: InteractionState,
  canvasPos: Point,
  metaKey = false,
): void {
  const tool = state.tool as SelectionToolId;
  STRATEGY_MAP[tool]?.onMove?.(state, canvasPos, metaKey);
}

export function handleSelectionUp(
  state: InteractionState,
  _canvasPos: Point,
  screenToCanvas: (sx: number, sy: number) => Point,
  containerRef: React.RefObject<HTMLDivElement | null>,
  e: { clientX: number; clientY: number },
): void {
  const tool = state.tool as SelectionToolId;
  STRATEGY_MAP[tool]?.onUp?.(state, _canvasPos, { screenToCanvas, containerRef, event: e });
}
