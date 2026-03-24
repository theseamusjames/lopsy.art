import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { createMaskSurface } from '../../engine/mask-utils';
import { generateBrushStamp, interpolatePoints, applyBrushDab } from '../../tools/brush/brush';
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

type PaintTool = 'brush' | 'pencil' | 'eraser';

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

  editorState.pushHistory();

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
  };

  if (!engine) return state;

  if (tool === 'brush') {
    const size = toolSettings.brushSize;
    const hardness = toolSettings.brushHardness / 100;
    const opacity = toolSettings.brushOpacity / 100;
    const color = useUIStore.getState().foregroundColor;
    useUIStore.getState().addRecentColor(color);
    const r = color.r / 255;
    const g = color.g / 255;
    const b = color.b / 255;

    if (shiftLine) {
      const spacing = Math.max(1, size * 0.25);
      const pts = lopsy_core_interpolate(lineFrom, layerPos, spacing);
      gpuBrushDabBatch(engine, activeLayerId, pts, size, hardness, r, g, b, color.a, opacity, 1);
    } else {
      gpuBrushDab(engine, activeLayerId, layerPos.x, layerPos.y, size, hardness, r, g, b, color.a, opacity, 1);
    }
  } else if (tool === 'pencil') {
    const color = useUIStore.getState().foregroundColor;
    useUIStore.getState().addRecentColor(color);
    const size = toolSettings.pencilSize;
    gpuDrawPencilLine(engine, activeLayerId,
      lineFrom.x, lineFrom.y, layerPos.x, layerPos.y,
      color.r / 255, color.g / 255, color.b / 255, color.a, size);
  } else {
    const size = toolSettings.eraserSize;
    const hardness = 0.8;
    const opacity = toolSettings.eraserOpacity / 100;

    if (shiftLine) {
      const spacing = Math.max(1, size * 0.25);
      const pts = lopsy_core_interpolate(lineFrom, layerPos, spacing);
      gpuEraserDabBatch(engine, activeLayerId, pts, size, hardness, opacity);
    } else {
      gpuEraserDab(engine, activeLayerId, layerPos.x, layerPos.y, size, hardness, opacity);
    }
  }

  editorState.notifyRender();
  return state;
}

/** Flatten two Points into a flat [x,y,...] array for the WASM batch API. */
function lopsy_core_interpolate(from: { x: number; y: number }, to: { x: number; y: number }, spacing: number): Float64Array {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < spacing) return new Float64Array([to.x, to.y]);
  const steps = Math.floor(dist / spacing);
  const arr = new Float64Array(steps * 2);
  for (let i = 0; i < steps; i++) {
    const t = (i + 1) * spacing / dist;
    arr[i * 2] = from.x + dx * t;
    arr[i * 2 + 1] = from.y + dy * t;
  }
  return arr;
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

  switch (state.tool) {
    case 'brush': {
      const size = toolSettings.brushSize;
      const hardness = toolSettings.brushHardness / 100;
      const opacity = toolSettings.brushOpacity / 100;
      const color = useUIStore.getState().foregroundColor;
      const spacing = Math.max(1, size * 0.25);
      const pts = lopsy_core_interpolate(state.lastPoint, layerLocalPos, spacing);
      gpuBrushDabBatch(engine, state.layerId, pts, size, hardness,
        color.r / 255, color.g / 255, color.b / 255, color.a, opacity, 1);
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
      state.lastPoint = layerLocalPos;
      useEditorStore.getState().notifyRender();
      break;
    }

    case 'eraser': {
      const size = toolSettings.eraserSize;
      const hardness = 0.8;
      const opacity = toolSettings.eraserOpacity / 100;
      const spacing = Math.max(1, size * 0.25);
      const pts = lopsy_core_interpolate(state.lastPoint, layerLocalPos, spacing);
      gpuEraserDabBatch(engine, state.layerId, pts, size, hardness, opacity);
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
