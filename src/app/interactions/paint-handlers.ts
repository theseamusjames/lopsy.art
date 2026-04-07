import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { createMaskSurface } from '../../engine/mask-utils';
import { generateBrushStamp, interpolatePoints, applyBrushDab, interpolatePointsWithScatter, resetScatterSpacingRemainder } from '../../tools/brush/brush';
import { drawPencilLine } from '../../tools/pencil/pencil';
import { setActiveMaskEditBuffer } from './mask-buffer';
import type { InteractionContext, InteractionState } from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  applyBrushDab as gpuBrushDab,
  applyBrushDabBatch as gpuBrushDabBatch,
  applyEraserDab as gpuEraserDab,
  applyEraserDabBatch as gpuEraserDabBatch,
  drawPencilLine as gpuDrawPencilLine,
} from '../../engine-wasm/wasm-bridge';
import type { SymmetryConfig } from '../../tools/symmetry';
import { getMirroredPoints, mirrorBatchPoints, isSymmetryActive } from '../../tools/symmetry';

type PaintTool = 'brush' | 'pencil' | 'eraser';

function getSymmetryConfig(): SymmetryConfig {
  const { symmetryHorizontal, symmetryVertical } = useToolSettingsStore.getState();
  const doc = useEditorStore.getState().document;
  return {
    horizontal: symmetryHorizontal,
    vertical: symmetryVertical,
    centerX: doc.width / 2,
    centerY: doc.height / 2,
  };
}

export function handlePaintDown(
  ctx: InteractionContext,
  tool: PaintTool,
): InteractionState | undefined {
  const { layerPos, activeLayer, activeLayerId, shiftKey, lastPaintPointRef } = ctx;
  const toolSettings = useToolSettingsStore.getState();

  const shiftLine = shiftKey
    && lastPaintPointRef.current
    && lastPaintPointRef.current.layerId === activeLayerId;
  const lineFrom = shiftLine ? lastPaintPointRef.current!.point : layerPos;

  const editorState = useEditorStore.getState();
  const maskEditMode = useUIStore.getState().maskEditMode;

  // Mask edit mode stays on CPU — small surface, infrequent
  if (maskEditMode && activeLayer.mask) {
    editorState.pushHistory();
    const maskBuf = createMaskSurface(activeLayer.mask.data, activeLayer.mask.width, activeLayer.mask.height);
    const maskColor = tool === 'eraser'
      ? { r: 255, g: 255, b: 255, a: 1 }
      : { r: 0, g: 0, b: 0, a: 1 };

    const state: InteractionState = {
      drawing: true,
      lastPoint: layerPos,
      pixelBuffer: maskBuf,
      originalPixelBuffer: null,
      layerId: activeLayerId,
      tool,
      startPoint: null,
      layerStartX: activeLayer.x,
      layerStartY: activeLayer.y,
      ...DEFAULT_TRANSFORM_FIELDS,
      maskMode: true,
    };

    if (tool === 'brush') {
      const size = toolSettings.brushSize;
      const hardness = toolSettings.brushHardness / 100;
      const opacity = toolSettings.brushOpacity / 100;
      const stamp = generateBrushStamp(size, hardness);
      if (shiftLine) {
        const spacing = Math.max(1, size * 0.25);
        const pts = interpolatePoints(lineFrom, layerPos, spacing);
        for (const pt of pts) {
          applyBrushDab(maskBuf, pt, stamp, size, maskColor, opacity, 1);
        }
      } else {
        applyBrushDab(maskBuf, layerPos, stamp, size, maskColor, opacity, 1);
      }
    } else if (tool === 'pencil') {
      const size = toolSettings.pencilSize;
      drawPencilLine(maskBuf, lineFrom, layerPos, maskColor, size);
    } else {
      const size = toolSettings.eraserSize;
      const hardness = 0.8;
      const opacity = toolSettings.eraserOpacity / 100;
      const stamp = generateBrushStamp(size, hardness);
      if (shiftLine) {
        const spacing = Math.max(1, size * 0.25);
        const pts = interpolatePoints(lineFrom, layerPos, spacing);
        for (const pt of pts) {
          applyBrushDab(maskBuf, pt, stamp, size, maskColor, opacity, 1);
        }
      } else {
        applyBrushDab(maskBuf, layerPos, stamp, size, maskColor, opacity, 1);
      }
    }

    setActiveMaskEditBuffer({ layerId: activeLayerId, buf: maskBuf, maskWidth: activeLayer.mask.width, maskHeight: activeLayer.mask.height });
    editorState.notifyRender();
    return state;
  }

  if (!ctx.isStrokeContinuation) {
    editorState.pushHistory();
  }
  resetScatterSpacingRemainder();

  const engine = getEngine();

  const state: InteractionState = {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool,
    startPoint: null,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
    strokeDistance: 0,
    spacingRemainder: 0,
  };

  if (!engine) return state;

  const sym = getSymmetryConfig();

  if (tool === 'brush') {
    const size = toolSettings.brushSize;
    const hardness = toolSettings.brushHardness / 100;
    const opacity = toolSettings.brushOpacity / 100;
    const brushSpacing = toolSettings.brushSpacing;
    const brushScatter = toolSettings.brushScatter;
    const brushFade = toolSettings.brushFade;
    const color = useUIStore.getState().foregroundColor;
    useUIStore.getState().addRecentColor(color);
    const r = color.r / 255;
    const g = color.g / 255;
    const b = color.b / 255;
    const spacing = Math.max(1, size * brushSpacing / 100);

    if (shiftLine) {
      if (brushScatter > 0) {
        const scatterPts = interpolatePointsWithScatter(lineFrom, layerPos, spacing, brushScatter, size);
        if (brushFade > 0) {
          emitDabsWithFade(engine, activeLayerId, scatterPts, lineFrom, size, hardness, r, g, b, color.a, opacity, brushFade, state, sym);
        } else {
          const arr = new Float64Array(scatterPts.length * 2);
          for (let i = 0; i < scatterPts.length; i++) {
            arr[i * 2] = scatterPts[i]!.x;
            arr[i * 2 + 1] = scatterPts[i]!.y;
          }
          gpuBrushDabBatch(engine, activeLayerId, arr, size, hardness, r, g, b, color.a, opacity, 1);
          for (const m of mirrorBatchPoints(arr, sym)) {
            gpuBrushDabBatch(engine, activeLayerId, m, size, hardness, r, g, b, color.a, opacity, 1);
          }
        }
      } else {
        const { points: pts, remainder: spacingRem } = interpolateWithSpacing(lineFrom, layerPos, spacing, state.spacingRemainder ?? 0);
        state.spacingRemainder = spacingRem;
        if (brushFade > 0) {
          emitFlatDabsWithFade(engine, activeLayerId, pts, size, hardness, r, g, b, color.a, opacity, brushFade, state, sym);
        } else {
          gpuBrushDabBatch(engine, activeLayerId, pts, size, hardness, r, g, b, color.a, opacity, 1);
          for (const m of mirrorBatchPoints(pts, sym)) {
            gpuBrushDabBatch(engine, activeLayerId, m, size, hardness, r, g, b, color.a, opacity, 1);
          }
        }
      }
    } else {
      const fadedOpacity = brushFade > 0 ? opacity * Math.max(0, 1 - (state.strokeDistance ?? 0) / brushFade) : opacity;
      if (fadedOpacity > 0) {
        gpuBrushDab(engine, activeLayerId, layerPos.x, layerPos.y, size, hardness, r, g, b, color.a, fadedOpacity, 1);
        for (const mp of getMirroredPoints(layerPos.x, layerPos.y, sym)) {
          gpuBrushDab(engine, activeLayerId, mp.x, mp.y, size, hardness, r, g, b, color.a, fadedOpacity, 1);
        }
      }
    }
  } else if (tool === 'pencil') {
    const color = useUIStore.getState().foregroundColor;
    useUIStore.getState().addRecentColor(color);
    const size = toolSettings.pencilSize;
    gpuDrawPencilLine(engine, activeLayerId,
      lineFrom.x, lineFrom.y, layerPos.x, layerPos.y,
      color.r / 255, color.g / 255, color.b / 255, color.a, size);
    if (isSymmetryActive(sym)) {
      const mFrom = getMirroredPoints(lineFrom.x, lineFrom.y, sym);
      const mTo = getMirroredPoints(layerPos.x, layerPos.y, sym);
      for (let i = 0; i < mFrom.length; i++) {
        gpuDrawPencilLine(engine, activeLayerId,
          mFrom[i]!.x, mFrom[i]!.y, mTo[i]!.x, mTo[i]!.y,
          color.r / 255, color.g / 255, color.b / 255, color.a, size);
      }
    }
  } else {
    const size = toolSettings.eraserSize;
    const hardness = 0.8;
    const opacity = toolSettings.eraserOpacity / 100;

    if (shiftLine) {
      const spacing = Math.max(1, size * 0.25);
      const { points: pts, remainder: spacingRem } = interpolateWithSpacing(lineFrom, layerPos, spacing, state.spacingRemainder ?? 0);
      state.spacingRemainder = spacingRem;
      gpuEraserDabBatch(engine, activeLayerId, pts, size, hardness, opacity);
      for (const m of mirrorBatchPoints(pts, sym)) {
        gpuEraserDabBatch(engine, activeLayerId, m, size, hardness, opacity);
      }
    } else {
      gpuEraserDab(engine, activeLayerId, layerPos.x, layerPos.y, size, hardness, opacity);
      for (const mp of getMirroredPoints(layerPos.x, layerPos.y, sym)) {
        gpuEraserDab(engine, activeLayerId, mp.x, mp.y, size, hardness, opacity);
      }
    }
  }

  editorState.notifyRender();
  return state;
}

interface InterpolateResult {
  points: Float64Array;
  remainder: number;
}

/**
 * Flatten two Points into a flat [x,y,...] array for the WASM batch API.
 * Tracks spacing remainder across move events via the returned value.
 * Returns empty points when no dabs are due.
 */
function interpolateWithSpacing(
  from: { x: number; y: number },
  to: { x: number; y: number },
  spacing: number,
  prevRemainder: number,
): InterpolateResult {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-6) return { points: new Float64Array(0), remainder: prevRemainder };

  const startOffset = spacing - prevRemainder;
  if (startOffset > dist) {
    return { points: new Float64Array(0), remainder: prevRemainder + dist };
  }

  const pts: number[] = [];
  let d = startOffset;
  while (d <= dist) {
    const t = d / dist;
    pts.push(from.x + dx * t, from.y + dy * t);
    d += spacing;
  }
  return { points: new Float64Array(pts), remainder: dist - (d - spacing) };
}

/**
 * Emit individual brush dabs from a flat [x,y,...] array, applying per-dab
 * fade based on cumulative stroke distance. Updates state.strokeDistance.
 */
function emitFlatDabsWithFade(
  engine: ReturnType<typeof getEngine>,
  layerId: string,
  pts: Float64Array,
  size: number,
  hardness: number,
  r: number, g: number, b: number, a: number,
  baseOpacity: number,
  fadeDistance: number,
  state: InteractionState,
  sym: SymmetryConfig,
): void {
  if (!engine) return;
  let dist = state.strokeDistance ?? 0;
  let prevX = state.lastPoint?.x ?? 0;
  let prevY = state.lastPoint?.y ?? 0;

  for (let i = 0; i < pts.length; i += 2) {
    const px = pts[i]!;
    const py = pts[i + 1]!;
    const dx = px - prevX;
    const dy = py - prevY;
    dist += Math.sqrt(dx * dx + dy * dy);
    prevX = px;
    prevY = py;

    if (dist >= fadeDistance) {
      state.strokeDistance = dist;
      return;
    }

    const fadeFactor = Math.max(0, 1 - dist / fadeDistance);
    const fadedOp = baseOpacity * fadeFactor;
    gpuBrushDab(engine, layerId, px, py, size, hardness, r, g, b, a, fadedOp, 1);
    for (const mp of getMirroredPoints(px, py, sym)) {
      gpuBrushDab(engine, layerId, mp.x, mp.y, size, hardness, r, g, b, a, fadedOp, 1);
    }
  }
  state.strokeDistance = dist;
}

/**
 * Emit individual brush dabs from a Point array (scatter path), applying
 * per-dab fade. Uses approximate distance along the original from→to segment.
 */
function emitDabsWithFade(
  engine: ReturnType<typeof getEngine>,
  layerId: string,
  points: Array<{ x: number; y: number }>,
  from: { x: number; y: number },
  size: number,
  hardness: number,
  r: number, g: number, b: number, a: number,
  baseOpacity: number,
  fadeDistance: number,
  state: InteractionState,
  sym: SymmetryConfig,
): void {
  if (!engine) return;
  let dist = state.strokeDistance ?? 0;
  let prevX = from.x;
  let prevY = from.y;

  for (const pt of points) {
    const dx = pt.x - prevX;
    const dy = pt.y - prevY;
    dist += Math.sqrt(dx * dx + dy * dy);
    prevX = pt.x;
    prevY = pt.y;

    if (dist >= fadeDistance) {
      state.strokeDistance = dist;
      return;
    }

    const fadeFactor = Math.max(0, 1 - dist / fadeDistance);
    const fadedOp = baseOpacity * fadeFactor;
    gpuBrushDab(engine, layerId, pt.x, pt.y, size, hardness, r, g, b, a, fadedOp, 1);
    for (const mp of getMirroredPoints(pt.x, pt.y, sym)) {
      gpuBrushDab(engine, layerId, mp.x, mp.y, size, hardness, r, g, b, a, fadedOp, 1);
    }
  }
  state.strokeDistance = dist;
}

export function handlePaintMove(
  ctx: InteractionContext,
  state: InteractionState,
): void {
  if (!state.lastPoint || !state.layerId) return;

  const toolSettings = useToolSettingsStore.getState();
  const layerLocalPos = ctx.layerPos;

  // Mask edit mode stays on CPU
  if (state.maskMode) {
    if (!state.pixelBuffer) return;
    handleMaskPaintMove(state, layerLocalPos, toolSettings);
    return;
  }

  const engine = getEngine();
  if (!engine) return;

  const sym = getSymmetryConfig();

  switch (state.tool) {
    case 'brush': {
      const size = toolSettings.brushSize;
      const hardness = toolSettings.brushHardness / 100;
      const opacity = toolSettings.brushOpacity / 100;
      const brushScatter = toolSettings.brushScatter;
      const brushFade = toolSettings.brushFade;
      const color = useUIStore.getState().foregroundColor;
      const spacing = Math.max(1, size * toolSettings.brushSpacing / 100);
      const r = color.r / 255;
      const g = color.g / 255;
      const b = color.b / 255;

      if (brushFade > 0 && (state.strokeDistance ?? 0) >= brushFade) {
        state.lastPoint = layerLocalPos;
        break;
      }

      if (brushScatter > 0) {
        const scatterPts = interpolatePointsWithScatter(state.lastPoint, layerLocalPos, spacing, brushScatter, size);
        if (brushFade > 0) {
          emitDabsWithFade(engine, state.layerId, scatterPts, state.lastPoint, size, hardness, r, g, b, color.a, opacity, brushFade, state, sym);
        } else {
          const pts = new Float64Array(scatterPts.length * 2);
          for (let i = 0; i < scatterPts.length; i++) {
            pts[i * 2] = scatterPts[i]!.x;
            pts[i * 2 + 1] = scatterPts[i]!.y;
          }
          gpuBrushDabBatch(engine, state.layerId, pts, size, hardness, r, g, b, color.a, opacity, 1);
          for (const m of mirrorBatchPoints(pts, sym)) {
            gpuBrushDabBatch(engine, state.layerId, m, size, hardness, r, g, b, color.a, opacity, 1);
          }
        }
      } else {
        const { points: pts, remainder: spacingRem } = interpolateWithSpacing(state.lastPoint, layerLocalPos, spacing, state.spacingRemainder ?? 0);
        state.spacingRemainder = spacingRem;
        if (brushFade > 0) {
          emitFlatDabsWithFade(engine, state.layerId, pts, size, hardness, r, g, b, color.a, opacity, brushFade, state, sym);
        } else {
          gpuBrushDabBatch(engine, state.layerId, pts, size, hardness, r, g, b, color.a, opacity, 1);
          for (const m of mirrorBatchPoints(pts, sym)) {
            gpuBrushDabBatch(engine, state.layerId, m, size, hardness, r, g, b, color.a, opacity, 1);
          }
        }
      }

      // Update stroke distance for non-fade path (fade helpers update it internally)
      if (brushFade <= 0) {
        const sdx = layerLocalPos.x - state.lastPoint.x;
        const sdy = layerLocalPos.y - state.lastPoint.y;
        state.strokeDistance = (state.strokeDistance ?? 0) + Math.sqrt(sdx * sdx + sdy * sdy);
      }
      state.lastPoint = layerLocalPos;
      useEditorStore.getState().notifyRender();
      break;
    }

    case 'pencil': {
      const color = useUIStore.getState().foregroundColor;
      const size = toolSettings.pencilSize;
      gpuDrawPencilLine(engine, state.layerId,
        state.lastPoint.x, state.lastPoint.y, layerLocalPos.x, layerLocalPos.y,
        color.r / 255, color.g / 255, color.b / 255, color.a, size);
      if (isSymmetryActive(sym)) {
        const mFrom = getMirroredPoints(state.lastPoint.x, state.lastPoint.y, sym);
        const mTo = getMirroredPoints(layerLocalPos.x, layerLocalPos.y, sym);
        for (let i = 0; i < mFrom.length; i++) {
          gpuDrawPencilLine(engine, state.layerId,
            mFrom[i]!.x, mFrom[i]!.y, mTo[i]!.x, mTo[i]!.y,
            color.r / 255, color.g / 255, color.b / 255, color.a, size);
        }
      }
      state.lastPoint = layerLocalPos;
      useEditorStore.getState().notifyRender();
      break;
    }

    case 'eraser': {
      const size = toolSettings.eraserSize;
      const hardness = 0.8;
      const opacity = toolSettings.eraserOpacity / 100;
      const spacing = Math.max(1, size * 0.25);
      const { points: pts, remainder: spacingRem } = interpolateWithSpacing(state.lastPoint, layerLocalPos, spacing, state.spacingRemainder ?? 0);
      state.spacingRemainder = spacingRem;
      gpuEraserDabBatch(engine, state.layerId, pts, size, hardness, opacity);
      for (const m of mirrorBatchPoints(pts, sym)) {
        gpuEraserDabBatch(engine, state.layerId, m, size, hardness, opacity);
      }
      state.lastPoint = layerLocalPos;
      useEditorStore.getState().notifyRender();
      break;
    }

    default:
      break;
  }
}

/** CPU-only mask painting (small internal surface). */
function handleMaskPaintMove(
  state: InteractionState,
  layerLocalPos: { x: number; y: number },
  toolSettings: ReturnType<typeof useToolSettingsStore.getState>,
): void {
  if (!state.pixelBuffer || !state.lastPoint) return;

  switch (state.tool) {
    case 'brush': {
      const size = toolSettings.brushSize;
      const hardness = toolSettings.brushHardness / 100;
      const opacity = toolSettings.brushOpacity / 100;
      const spacing = Math.max(1, size * 0.25);
      const stamp = generateBrushStamp(size, hardness);
      const color = { r: 0, g: 0, b: 0, a: 1 };
      const points = interpolatePoints(state.lastPoint, layerLocalPos, spacing);
      for (const pt of points) {
        applyBrushDab(state.pixelBuffer, pt, stamp, size, color, opacity, 1);
      }
      break;
    }
    case 'pencil': {
      const color = { r: 0, g: 0, b: 0, a: 1 };
      const size = toolSettings.pencilSize;
      drawPencilLine(state.pixelBuffer, state.lastPoint, layerLocalPos, color, size);
      break;
    }
    case 'eraser': {
      const size = toolSettings.eraserSize;
      const hardness = 0.8;
      const opacity = toolSettings.eraserOpacity / 100;
      const spacing = Math.max(1, size * 0.25);
      const stamp = generateBrushStamp(size, hardness);
      const maskColor = { r: 255, g: 255, b: 255, a: 1 };
      const points = interpolatePoints(state.lastPoint, layerLocalPos, spacing);
      for (const pt of points) {
        applyBrushDab(state.pixelBuffer, pt, stamp, size, maskColor, opacity, 1);
      }
      break;
    }
    default:
      break;
  }
  state.lastPoint = layerLocalPos;
  useEditorStore.getState().notifyRender();
}
