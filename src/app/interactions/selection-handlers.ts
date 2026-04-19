import type { InteractionState, InteractionContext } from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';
import type { Point } from '../../types';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { useToolSettingsStore } from '../tool-settings-store';
import {
  createRectSelection as tsCreateRectSelection,
  createEllipseSelection as tsCreateEllipseSelection,
  selectionBounds as tsSelectionBounds,
  getSelectionMaskValue,
} from '../../selection/selection';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  floodFill as wasmFloodFill,
  readLayerPixelsForFill as wasmReadLayerPixelsForFill,
  magneticLassoBegin as wasmMagneticLassoBegin,
  magneticLassoSnap as wasmMagneticLassoSnap,
  magneticLassoSnapPoint as wasmMagneticLassoSnapPoint,
  magneticLassoEnd as wasmMagneticLassoEnd,
  hasFloat,
  dropFloat,
} from '../../engine-wasm/wasm-bridge';
import { createPolygonMask as tsCreatePolygonMask } from '../../tools/lasso/lasso';
import {
  beginLasso,
  updateCursor as magneticUpdateCursor,
  addAnchor as magneticAddAnchor,
  closeLasso as magneticCloseLasso,
  flattenPolyline as magneticFlatten,
  pointsFromFloat32,
  shouldAutoAnchor,
  type MagneticLassoState,
  type SnapFn,
} from '../../tools/magnetic-lasso/magnetic-lasso';
import { createTransformState } from '../../tools/transform/transform';
import { snapPositionToGrid } from '../../tools/move/move';
import {
  createRectSelection as wasmCreateRectSelection,
  createEllipseSelection as wasmCreateEllipseSelection,
  selectionBounds as wasmSelectionBounds,
  createPolygonMask as wasmCreatePolygonMask,
} from '../../engine-wasm/wasm-bridge';

/**
 * Active magnetic lasso trace. Kept as a module-local to avoid cluttering
 * the shared InteractionState — only this handler family reads it.
 */
let magneticLassoTrace: MagneticLassoState | null = null;

function makeMagneticSnapFn(): SnapFn {
  const engine = getEngine();
  const settings = useToolSettingsStore.getState();
  const radius = settings.magneticLassoWidth;
  // Map 1..100 contrast → ~5..255 edge threshold (log-like curve so the low
  // end is usable).
  const threshold = Math.max(1, Math.min(255, Math.round(settings.magneticLassoContrast * 2.55)));
  return (from, to) => {
    if (!engine) return [from, to];
    const flat = wasmMagneticLassoSnap(engine, from.x, from.y, to.x, to.y, radius, threshold);
    return pointsFromFloat32(flat);
  };
}

function updateMagneticLassoPreview(state: MagneticLassoState): void {
  const points = magneticFlatten(state);
  useUIStore.getState().setLassoPoints(points);
  useEditorStore.getState().notifyRender();
}

/** Create a rect selection mask via WASM, falling back to TS. */
function createRectSelection(
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

/** Create an ellipse selection mask via WASM, falling back to TS. */
function createEllipseSelection(
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

/** Compute selection bounds via WASM, falling back to TS. */
function selectionBounds(
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

/** Create a polygon mask via WASM, falling back to TS. */
function createPolygonMask(
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

export function handleSelectionDown(
  ctx: InteractionContext,
  tool: 'marquee-rect' | 'marquee-ellipse' | 'wand' | 'lasso' | 'lasso-magnetic',
): InteractionState | undefined {
  const { canvasPos, activeLayerId } = ctx;

  if (tool === 'marquee-rect' || tool === 'marquee-ellipse') {
    const editorState = useEditorStore.getState();
    const sel = editorState.selection;
    const cx = Math.round(canvasPos.x);
    const cy = Math.round(canvasPos.y);
    if (sel.active && sel.mask && getSelectionMaskValue(sel, cx, cy) > 0) {
      const engine = getEngine();
      if (engine && hasFloat(engine)) {
        dropFloat(engine);
      }
      ctx.floatingSelectionRef.current = null;
      ctx.persistentTransformRef.current = null;
      return {
        drawing: true,
        lastPoint: canvasPos,
        pixelBuffer: null,
        originalPixelBuffer: null,
        layerId: activeLayerId,
        tool,
        startPoint: canvasPos,
        layerStartX: 0,
        layerStartY: 0,
        ...DEFAULT_TRANSFORM_FIELDS,
        moveOriginalMask: new Uint8ClampedArray(sel.mask),
        moveOriginalBounds: sel.bounds ? { ...sel.bounds } : null,
      };
    }
    useUIStore.getState().setTransform(null);
    ctx.persistentTransformRef.current = null;
    ctx.floatingSelectionRef.current = null;
    return {
      drawing: true,
      lastPoint: canvasPos,
      pixelBuffer: null,
      originalPixelBuffer: null,
      layerId: activeLayerId,
      tool,
      startPoint: canvasPos,
      layerStartX: 0,
      layerStartY: 0,
      ...DEFAULT_TRANSFORM_FIELDS,
    };
  }

  if (tool === 'wand') {
    const engine = getEngine();
    if (!engine) return undefined;
    const toolSettings = useToolSettingsStore.getState();
    const wandTolerance = toolSettings.wandTolerance;
    const wandContiguous = toolSettings.wandContiguous;
    const editorState = useEditorStore.getState();
    const { width: docW, height: docH } = editorState.document;
    // Read layer pixels from GPU for flood fill region detection
    const pixelData = wasmReadLayerPixelsForFill(engine, activeLayerId);
    const cx = Math.round(canvasPos.x);
    const cy = Math.round(canvasPos.y);
    const wandMaskRaw = wasmFloodFill(
      pixelData, docW, docH,
      cx, cy, 0, 0, 0, 0,
      wandTolerance, wandContiguous,
    );
    const wandMask = new Uint8ClampedArray(wandMaskRaw.buffer, wandMaskRaw.byteOffset, wandMaskRaw.byteLength);
    const wandBounds = selectionBounds(wandMask, docW, docH);
    if (wandBounds) {
      editorState.setSelection(wandBounds, wandMask, docW, docH);
      useUIStore.getState().setTransform(createTransformState(wandBounds));
    }
    return undefined;
  }

  if (tool === 'lasso-magnetic') {
    const engine = getEngine();
    if (!engine) return undefined;
    try {
      wasmMagneticLassoBegin(engine, activeLayerId);
    } catch {
      return undefined;
    }
    // Snap the initial anchor onto the nearest edge so the closing segment
    // doesn't drag the path back out to an unsnapped cursor position.
    const settings = useToolSettingsStore.getState();
    const radius = settings.magneticLassoWidth;
    const threshold = Math.max(1, Math.min(255, Math.round(settings.magneticLassoContrast * 2.55)));
    const snapped = wasmMagneticLassoSnapPoint(engine, canvasPos.x, canvasPos.y, radius, threshold);
    const startPoint = snapped.length >= 2
      ? { x: snapped[0]!, y: snapped[1]! }
      : canvasPos;
    magneticLassoTrace = beginLasso(startPoint);
    updateMagneticLassoPreview(magneticLassoTrace);
    return {
      drawing: true,
      lastPoint: canvasPos,
      pixelBuffer: null,
      originalPixelBuffer: null,
      layerId: activeLayerId,
      tool: 'lasso-magnetic',
      startPoint: canvasPos,
      layerStartX: 0,
      layerStartY: 0,
      ...DEFAULT_TRANSFORM_FIELDS,
    };
  }

  // lasso
  useUIStore.getState().setLassoPoints([canvasPos]);
  return {
    drawing: true,
    lastPoint: canvasPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'lasso',
    startPoint: canvasPos,
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleSelectionMove(
  state: InteractionState,
  canvasPos: Point,
): void {
  if (state.tool === 'marquee-rect' || state.tool === 'marquee-ellipse') {
    if (!state.startPoint) return;

    if (state.moveOriginalMask && state.moveOriginalBounds) {
      const dx = Math.round(canvasPos.x - state.startPoint.x);
      const dy = Math.round(canvasPos.y - state.startPoint.y);
      const orig = state.moveOriginalBounds;
      const editorState = useEditorStore.getState();
      const { width: docW, height: docH } = editorState.document;
      const srcMask = state.moveOriginalMask;
      const newMask = new Uint8ClampedArray(srcMask.length);
      for (let y = 0; y < docH; y++) {
        for (let x = 0; x < docW; x++) {
          const sx = x - dx;
          const sy = y - dy;
          if (sx >= 0 && sx < docW && sy >= 0 && sy < docH) {
            newMask[y * docW + x] = srcMask[sy * docW + sx]!;
          }
        }
      }
      const newBounds = { x: orig.x + dx, y: orig.y + dy, width: orig.width, height: orig.height };
      editorState.setSelection(newBounds, newMask, docW, docH);
      useUIStore.getState().setTransform(createTransformState(newBounds));
      return;
    }

    const editorState = useEditorStore.getState();
    let mStart = state.startPoint;
    let mEnd = canvasPos;
    const uiMarquee = useUIStore.getState();
    if (uiMarquee.showGrid && uiMarquee.snapToGrid) {
      const { width: dw, height: dh } = editorState.document;
      mStart = snapPositionToGrid(mStart.x, mStart.y, uiMarquee.gridSize, dw, dh);
      mEnd = snapPositionToGrid(mEnd.x, mEnd.y, uiMarquee.gridSize, dw, dh);
    }
    const toolSettings = useToolSettingsStore.getState();
    let w = Math.abs(mEnd.x - mStart.x);
    let h = Math.abs(mEnd.y - mStart.y);
    if (toolSettings.aspectRatioLocked && toolSettings.aspectRatioW > 0 && toolSettings.aspectRatioH > 0) {
      const ratio = toolSettings.aspectRatioW / toolSettings.aspectRatioH;
      if (w / h > ratio) {
        w = h * ratio;
      } else {
        h = w / ratio;
      }
    }
    const x = mEnd.x >= mStart.x ? mStart.x : mStart.x - w;
    const y = mEnd.y >= mStart.y ? mStart.y : mStart.y - h;

    if (w > 0 && h > 0) {
      const selRect = { x, y, width: w, height: h };
      const mask = state.tool === 'marquee-rect'
        ? createRectSelection(selRect, editorState.document.width, editorState.document.height)
        : createEllipseSelection(selRect, editorState.document.width, editorState.document.height);
      editorState.setSelection(selRect, mask, editorState.document.width, editorState.document.height);
      useUIStore.getState().setTransform(createTransformState(selRect));
    }
    return;
  }

  if (state.tool === 'lasso') {
    const lassoPoints = useUIStore.getState().lassoPoints;
    useUIStore.getState().setLassoPoints([...lassoPoints, canvasPos]);
    useEditorStore.getState().notifyRender();
  }

  if (state.tool === 'lasso-magnetic' && magneticLassoTrace) {
    const snap = makeMagneticSnapFn();
    let trace = magneticUpdateCursor(magneticLassoTrace, canvasPos, snap);
    const frequency = useToolSettingsStore.getState().magneticLassoFrequency;
    if (shouldAutoAnchor(trace, frequency)) {
      // Anchor at a locally-snapped point so the committed polyline stays
      // glued to edges instead of jumping back out to the raw cursor at
      // every auto-anchor. `snap_segment` does not snap its endpoints, so
      // we pull the cursor onto the nearest edge explicitly.
      trace = magneticAddAnchor(trace, snapCursorToEdge(canvasPos), snap);
    }
    magneticLassoTrace = trace;
    updateMagneticLassoPreview(trace);
  }
}

function snapCursorToEdge(p: Point): Point {
  const engine = getEngine();
  if (!engine) return p;
  const settings = useToolSettingsStore.getState();
  const radius = settings.magneticLassoWidth;
  const threshold = Math.max(1, Math.min(255, Math.round(settings.magneticLassoContrast * 2.55)));
  const snapped = wasmMagneticLassoSnapPoint(engine, p.x, p.y, radius, threshold);
  return snapped.length >= 2 ? { x: snapped[0]!, y: snapped[1]! } : p;
}

export function handleSelectionUp(
  state: InteractionState,
  _canvasPos: Point,
  screenToCanvas: (sx: number, sy: number) => Point,
  containerRef: React.RefObject<HTMLDivElement | null>,
  e: { clientX: number; clientY: number },
): void {
  if (state.tool === 'marquee-rect' || state.tool === 'marquee-ellipse') {
    if (state.moveOriginalMask) return;
    if (state.startPoint) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const upPos = screenToCanvas(screenX, screenY);
        const dx = Math.abs(upPos.x - state.startPoint.x);
        const dy = Math.abs(upPos.y - state.startPoint.y);
        if (dx < 2 && dy < 2) {
          useEditorStore.getState().clearSelection();
          useUIStore.getState().setTransform(null);
        }
      }
    }
    return;
  }

  if (state.tool === 'lasso') {
    const lassoPoints = useUIStore.getState().lassoPoints;
    if (lassoPoints.length >= 3) {
      const editorState = useEditorStore.getState();
      const { width: docW, height: docH } = editorState.document;
      const lassoMask = createPolygonMask(lassoPoints, docW, docH);
      const lassoBounds = selectionBounds(lassoMask, docW, docH);
      if (lassoBounds) {
        editorState.setSelection(lassoBounds, lassoMask, docW, docH);
        useUIStore.getState().setTransform(createTransformState(lassoBounds));
      }
    }
    useUIStore.getState().clearLassoPoints();
  }

  if (state.tool === 'lasso-magnetic') {
    const engine = getEngine();
    if (magneticLassoTrace && engine) {
      const snap = makeMagneticSnapFn();
      // Commit a final anchor at the mouseup cursor (snapped onto the nearest
      // edge) so the closing path has real geometry even when no auto-anchor
      // ever fired. `snap_segment` keeps its endpoints unsnapped, so without
      // this the polyline would include the raw cursor at the final corner.
      const endPoint = magneticLassoTrace.liveSegment[magneticLassoTrace.liveSegment.length - 1];
      const final = endPoint
        ? magneticAddAnchor(magneticLassoTrace, snapCursorToEdge(endPoint), snap)
        : magneticLassoTrace;
      const polyline = magneticCloseLasso(final, snap);
      if (polyline.length >= 3) {
        const editorState = useEditorStore.getState();
        const { width: docW, height: docH } = editorState.document;
        const mask = createPolygonMask(polyline, docW, docH);
        const bounds = selectionBounds(mask, docW, docH);
        if (bounds) {
          editorState.setSelection(bounds, mask, docW, docH);
          useUIStore.getState().setTransform(createTransformState(bounds));
        }
      }
    }
    if (engine) wasmMagneticLassoEnd(engine);
    magneticLassoTrace = null;
    useUIStore.getState().clearLassoPoints();
  }
}
