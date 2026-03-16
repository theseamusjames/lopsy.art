import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { createMaskSurface } from '../../engine/mask-utils';
import { generateBrushStamp, interpolatePoints, applyBrushDab } from '../../tools/brush/brush';
import { drawPencilLine } from '../../tools/pencil/pencil';
import { applyEraserDab } from '../../tools/eraser/eraser';
import { markPaintDirty } from '../../engine/bitmap-cache';
import { setActiveMaskEditBuffer } from './mask-buffer';
import { wrapWithSelectionMask } from './selection-mask-wrap';
import type { InteractionContext, InteractionState } from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';

type PaintTool = 'brush' | 'pencil' | 'eraser';

export function handlePaintDown(
  ctx: InteractionContext,
  tool: PaintTool,
): InteractionState | undefined {
  const { pixelBuffer, paintSurface, layerPos, activeLayer, activeLayerId, shiftKey, lastPaintPointRef } = ctx;
  const toolSettings = useToolSettingsStore.getState();

  // Shift+click: draw a line from the last paint point to here
  const shiftLine = shiftKey
    && lastPaintPointRef.current
    && lastPaintPointRef.current.layerId === activeLayerId;
  const lineFrom = shiftLine ? lastPaintPointRef.current!.point : layerPos;

  const editorState = useEditorStore.getState();
  const maskEditMode = useUIStore.getState().maskEditMode;

  if (maskEditMode && activeLayer.mask) {
    editorState.pushHistory();
    const maskBuf = createMaskSurface(activeLayer.mask.data, activeLayer.mask.width, activeLayer.mask.height);
    // Paint tools hide (0), eraser reveals (255)
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

  const state: InteractionState = {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool,
    startPoint: null,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };

  if (tool === 'brush') {
    const size = toolSettings.brushSize;
    const hardness = toolSettings.brushHardness / 100;
    const opacity = toolSettings.brushOpacity / 100;
    const stamp = generateBrushStamp(size, hardness);
    const color = useUIStore.getState().foregroundColor;
    useUIStore.getState().addRecentColor(color);
    if (shiftLine) {
      const spacing = Math.max(1, size * 0.25);
      const pts = interpolatePoints(lineFrom, layerPos, spacing);
      for (const pt of pts) {
        applyBrushDab(paintSurface, pt, stamp, size, color, opacity, 1);
      }
    } else {
      applyBrushDab(paintSurface, layerPos, stamp, size, color, opacity, 1);
    }
  } else if (tool === 'pencil') {
    const color = useUIStore.getState().foregroundColor;
    useUIStore.getState().addRecentColor(color);
    const size = toolSettings.pencilSize;
    drawPencilLine(paintSurface, lineFrom, layerPos, color, size);
  } else {
    const size = toolSettings.eraserSize;
    const hardness = 0.8;
    const opacity = toolSettings.eraserOpacity / 100;
    const stamp = generateBrushStamp(size, hardness);
    if (shiftLine) {
      const spacing = Math.max(1, size * 0.25);
      const pts = interpolatePoints(lineFrom, layerPos, spacing);
      for (const pt of pts) {
        applyEraserDab(paintSurface, pt, stamp, size, opacity);
      }
    } else {
      applyEraserDab(paintSurface, layerPos, stamp, size, opacity);
    }
  }

  editorState.notifyRender();
  return state;
}

function markStrokeDirty(layerId: string, from: { x: number; y: number }, to: { x: number; y: number }, brushSize: number): void {
  const half = Math.ceil(brushSize / 2) + 1;
  const x = Math.min(from.x, to.x) - half;
  const y = Math.min(from.y, to.y) - half;
  const x2 = Math.max(from.x, to.x) + half;
  const y2 = Math.max(from.y, to.y) + half;
  markPaintDirty(layerId, x, y, x2 - x, y2 - y);
}

export function handlePaintMove(
  ctx: InteractionContext,
  state: InteractionState,
): void {
  if (!state.pixelBuffer || !state.lastPoint || !state.layerId) return;

  const toolSettings = useToolSettingsStore.getState();

  // Convert canvas coords to layer-local coords
  const layerLocalPos = ctx.layerPos;

  switch (state.tool) {
    case 'brush': {
      const size = toolSettings.brushSize;
      const hardness = toolSettings.brushHardness / 100;
      const opacity = toolSettings.brushOpacity / 100;
      const spacing = Math.max(1, size * 0.25);
      const stamp = generateBrushStamp(size, hardness);
      const color = state.maskMode
        ? { r: 0, g: 0, b: 0, a: 1 }
        : useUIStore.getState().foregroundColor;
      const brushSurface = state.maskMode
        ? state.pixelBuffer
        : wrapWithSelectionMask(state.pixelBuffer, state.layerStartX, state.layerStartY);
      const points = interpolatePoints(state.lastPoint, layerLocalPos, spacing);
      for (const pt of points) {
        applyBrushDab(brushSurface, pt, stamp, size, color, opacity, 1);
      }
      if (!state.maskMode) markStrokeDirty(state.layerId, state.lastPoint, layerLocalPos, size);
      state.lastPoint = layerLocalPos;
      useEditorStore.getState().notifyRender();
      break;
    }

    case 'pencil': {
      const color = state.maskMode
        ? { r: 0, g: 0, b: 0, a: 1 }
        : useUIStore.getState().foregroundColor;
      const pencilSurface = state.maskMode
        ? state.pixelBuffer
        : wrapWithSelectionMask(state.pixelBuffer, state.layerStartX, state.layerStartY);
      const size = toolSettings.pencilSize;
      drawPencilLine(pencilSurface, state.lastPoint, layerLocalPos, color, size);
      if (!state.maskMode) markStrokeDirty(state.layerId, state.lastPoint, layerLocalPos, size);
      state.lastPoint = layerLocalPos;
      useEditorStore.getState().notifyRender();
      break;
    }

    case 'eraser': {
      const size = toolSettings.eraserSize;
      const hardness = 0.8;
      const opacity = toolSettings.eraserOpacity / 100;
      const spacing = Math.max(1, size * 0.25);
      const stamp = generateBrushStamp(size, hardness);
      const points = interpolatePoints(state.lastPoint, layerLocalPos, spacing);
      if (state.maskMode) {
        const maskColor = { r: 255, g: 255, b: 255, a: 1 };
        for (const pt of points) {
          applyBrushDab(state.pixelBuffer, pt, stamp, size, maskColor, opacity, 1);
        }
      } else {
        const eraserSurface = wrapWithSelectionMask(state.pixelBuffer, state.layerStartX, state.layerStartY);
        for (const pt of points) {
          applyEraserDab(eraserSurface, pt, stamp, size, opacity);
        }
        markStrokeDirty(state.layerId, state.lastPoint, layerLocalPos, size);
      }
      state.lastPoint = layerLocalPos;
      useEditorStore.getState().notifyRender();
      break;
    }

    default:
      break;
  }
}
