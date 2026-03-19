import type { MutableRefObject } from 'react';
import type { InteractionState, InteractionContext } from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';
import type { Point } from '../../types';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { wrapWithSelectionMask } from './selection-mask-wrap';
import { rasterizePathToLayer } from './path-stroke';
import { floodFill, applyFill } from '../../tools/fill/fill';
import { sampleColor } from '../../tools/eyedropper/eyedropper';
import { applyDodgeBurn } from '../../tools/dodge/dodge';
import { applyStampDab } from '../../tools/stamp/stamp';
import { renderText } from '../../tools/text/text';
import { drawShape } from '../../tools/shape/shape';
import { interpolateGradient, computeLinearGradientT, computeRadialGradientT } from '../../tools/gradient/gradient';
import { interpolatePoints } from '../../tools/brush/brush';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  floodFill as wasmFloodFill,
  applyFillToLayer as wasmApplyFillToLayer,
  readLayerPixelsForFill as wasmReadLayerPixelsForFill,
  sampleColor as wasmSampleColor,
  applyDodgeBurnDab as gpuDodgeBurnDab,
  applyDodgeBurnDabBatch as gpuDodgeBurnDabBatch,
  applyStampDab as gpuStampDab,
  applyStampDabBatch as gpuStampDabBatch,
  renderLinearGradient as gpuRenderLinearGradient,
  renderRadialGradient as gpuRenderRadialGradient,
  renderShape as gpuRenderShape,
} from '../../engine-wasm/wasm-bridge';

/**
 * Reset a layer's position in the document model.
 * Used before updateLayerPixelData when passing full-canvas-size data
 * to prevent cropLayerToContent from accumulating position offsets.
 */
function resetLayerPosition(layerId: string, x: number, y: number): void {
  const state = useEditorStore.getState();
  const layer = state.document.layers.find((l) => l.id === layerId);
  if (layer && (layer.x !== x || layer.y !== y)) {
    useEditorStore.setState({
      document: {
        ...state.document,
        layers: state.document.layers.map((l) =>
          l.id === layerId ? { ...l, x, y } : l,
        ),
      },
    });
  }
}

export function handleFillDown(ctx: InteractionContext): void {
  const { layerPos, activeLayerId, pixelBuffer, paintSurface } = ctx;
  const editorState = useEditorStore.getState();
  editorState.pushHistory();
  const color = useUIStore.getState().foregroundColor;
  useUIStore.getState().addRecentColor(color);
  const toolSettings = useToolSettingsStore.getState();
  const tolerance = toolSettings.fillTolerance;
  const contiguous = toolSettings.fillContiguous;

  const engine = getEngine();
  const hasSelection = editorState.selection.active;

  if (engine && !hasSelection) {
    // GPU path: read layer pixels from GPU, run WASM flood fill, apply fill via GPU shader
    const pixelData = wasmReadLayerPixelsForFill(engine, activeLayerId);
    const { width: docW, height: docH } = editorState.document;
    // The flood fill click point must be in canvas space for the GPU texture
    const layer = editorState.document.layers.find((l) => l.id === activeLayerId);
    const canvasX = Math.round(layerPos.x + (layer?.x ?? 0));
    const canvasY = Math.round(layerPos.y + (layer?.y ?? 0));
    const fillMask = wasmFloodFill(
      pixelData, docW, docH,
      canvasX, canvasY,
      color.r, color.g, color.b, Math.round(color.a * 255),
      tolerance, contiguous,
    );
    wasmApplyFillToLayer(
      engine, activeLayerId,
      color.r / 255, color.g / 255, color.b / 255, color.a,
      fillMask, docW, docH,
    );
    // Clear stale JS pixel data so subsequent reads come from GPU
    const pixelDataMap = new Map(editorState.layerPixelData);
    pixelDataMap.delete(activeLayerId);
    const sparseMap = new Map(editorState.sparseLayerData);
    sparseMap.delete(activeLayerId);
    const dirtyIds = new Set(editorState.dirtyLayerIds);
    dirtyIds.add(activeLayerId);
    useEditorStore.setState({ layerPixelData: pixelDataMap, sparseLayerData: sparseMap, dirtyLayerIds: dirtyIds });
    editorState.notifyRender();
  } else {
    // CPU fallback: used when selection is active (GPU doesn't clip to selection mask)
    const pixels = floodFill(pixelBuffer, layerPos.x, layerPos.y, color, tolerance, contiguous);
    applyFill(paintSurface, pixels, color);
    editorState.updateLayerPixelData(activeLayerId, pixelBuffer.toImageData());
  }
}

function gpuSampleColorAt(canvasX: number, canvasY: number): { r: number; g: number; b: number; a: number } | null {
  const engine = getEngine();
  if (!engine) return null;
  const rgba = wasmSampleColor(engine, canvasX, canvasY, 1);
  if (rgba.length < 4) return null;
  return { r: rgba[0]!, g: rgba[1]!, b: rgba[2]!, a: rgba[3]! / 255 };
}

export function handleEyedropperDown(ctx: InteractionContext): InteractionState {
  const { layerPos, canvasPos, activeLayerId, activeLayer, pixelBuffer } = ctx;

  // GPU path: sample directly from the composite framebuffer (sees all layers)
  const gpuColor = gpuSampleColorAt(canvasPos.x, canvasPos.y);
  if (gpuColor) {
    useUIStore.getState().setForegroundColor(gpuColor);
  } else {
    const color = sampleColor(pixelBuffer, layerPos.x, layerPos.y, 'point');
    useUIStore.getState().setForegroundColor(color);
  }

  return {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'eyedropper',
    startPoint: null,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleEyedropperMove(state: InteractionState, layerLocalPos: Point): void {
  // GPU path: sample from composite framebuffer
  const canvasX = layerLocalPos.x + state.layerStartX;
  const canvasY = layerLocalPos.y + state.layerStartY;
  const gpuColor = gpuSampleColorAt(canvasX, canvasY);
  if (gpuColor) {
    useUIStore.getState().setForegroundColor(gpuColor);
    return;
  }
  // CPU fallback
  if (!state.pixelBuffer) return;
  const eyeColor = sampleColor(state.pixelBuffer, layerLocalPos.x, layerLocalPos.y, 'point');
  useUIStore.getState().setForegroundColor(eyeColor);
}

/** Map dodge/burn mode string to GPU enum (0 = dodge, 1 = burn). */
function dodgeModeToU32(mode: 'dodge' | 'burn'): number {
  return mode === 'dodge' ? 0 : 1;
}

/** Flatten two Points into a flat [x,y,...] array for the WASM batch API. */
function interpolateFlat(from: Point, to: Point, spacing: number): Float64Array {
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

export function handleDodgeDown(ctx: InteractionContext): InteractionState {
  const { layerPos, activeLayerId, activeLayer, pixelBuffer, paintSurface, shiftKey } = ctx;
  const editorState = useEditorStore.getState();
  editorState.pushHistory();
  const toolSettings = useToolSettingsStore.getState();
  const dodgeMode = toolSettings.dodgeMode;
  const exposure = toolSettings.dodgeExposure / 100;
  const dodgeSize = toolSettings.brushSize;
  const dodgeShiftLine = shiftKey
    && ctx.lastPaintPointRef.current
    && ctx.lastPaintPointRef.current.layerId === activeLayerId;

  const engine = getEngine();
  const hasSelection = editorState.selection.active;

  if (engine && !hasSelection) {
    // GPU path
    const modeU32 = dodgeModeToU32(dodgeMode);
    if (dodgeShiftLine) {
      const spacing = Math.max(1, dodgeSize * 0.25);
      const pts = interpolateFlat(ctx.lastPaintPointRef.current!.point, layerPos, spacing);
      gpuDodgeBurnDabBatch(engine, activeLayerId, pts, dodgeSize, modeU32, exposure);
    } else {
      gpuDodgeBurnDab(engine, activeLayerId, layerPos.x, layerPos.y, dodgeSize, modeU32, exposure);
    }
    editorState.notifyRender();
  } else {
    // CPU fallback when selection active
    if (dodgeShiftLine) {
      const spacing = Math.max(1, dodgeSize * 0.25);
      const pts = interpolatePoints(ctx.lastPaintPointRef.current!.point, layerPos, spacing);
      for (const pt of pts) {
        applyDodgeBurn(paintSurface, pt, dodgeSize, dodgeMode, exposure);
      }
    } else {
      applyDodgeBurn(paintSurface, layerPos, dodgeSize, dodgeMode, exposure);
    }
    editorState.updateLayerPixelData(activeLayerId, pixelBuffer.toImageData());
  }

  return {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'dodge',
    startPoint: null,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleDodgeMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.lastPoint) return;
  const toolSettings = useToolSettingsStore.getState();
  const dodgeMode = toolSettings.dodgeMode;
  const exposure = toolSettings.dodgeExposure / 100;
  const dodgeSize = toolSettings.brushSize;
  const dodgeSpacing = Math.max(1, dodgeSize * 0.25);

  const engine = state._usedGpuStroke ? getEngine() : null;

  if (engine && state.layerId) {
    // GPU path
    const pts = interpolateFlat(state.lastPoint, layerLocalPos, dodgeSpacing);
    gpuDodgeBurnDabBatch(engine, state.layerId, pts, dodgeSize, dodgeModeToU32(dodgeMode), exposure);
  } else if (state.pixelBuffer) {
    // CPU fallback
    const dodgeSurface = wrapWithSelectionMask(state.pixelBuffer, state.layerStartX, state.layerStartY);
    const dodgePoints = interpolatePoints(state.lastPoint, layerLocalPos, dodgeSpacing);
    for (const pt of dodgePoints) {
      applyDodgeBurn(dodgeSurface, pt, dodgeSize, dodgeMode, exposure);
    }
  }
  state.lastPoint = layerLocalPos;
  useEditorStore.getState().notifyRender();
}

export function handleStampDown(ctx: InteractionContext): InteractionState | undefined {
  const { layerPos, activeLayerId, activeLayer, pixelBuffer, paintSurface, altKey, shiftKey } = ctx;

  if (altKey) {
    ctx.stampSourceRef.current = layerPos;
    ctx.stampOffsetRef.current = null;
    return undefined;
  }
  if (!ctx.stampSourceRef.current) return undefined;

  const editorState = useEditorStore.getState();
  editorState.pushHistory();

  if (!ctx.stampOffsetRef.current) {
    ctx.stampOffsetRef.current = {
      x: ctx.stampSourceRef.current.x - layerPos.x,
      y: ctx.stampSourceRef.current.y - layerPos.y,
    };
  }

  const state: InteractionState = {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer,
    originalPixelBuffer: pixelBuffer.clone(),
    layerId: activeLayerId,
    tool: 'stamp',
    startPoint: layerPos,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };

  const toolSettings = useToolSettingsStore.getState();
  const engine = getEngine();
  const hasSelection = editorState.selection.active;

  if (engine && !hasSelection) {
    // GPU path
    const stampShiftLine = shiftKey
      && ctx.lastPaintPointRef.current
      && ctx.lastPaintPointRef.current.layerId === activeLayerId;
    if (stampShiftLine) {
      const spacing = Math.max(1, toolSettings.stampSize * 0.25);
      const pts = interpolateFlat(ctx.lastPaintPointRef.current!.point, layerPos, spacing);
      gpuStampDabBatch(engine, activeLayerId, pts, ctx.stampOffsetRef.current.x, ctx.stampOffsetRef.current.y, toolSettings.stampSize);
    } else {
      gpuStampDab(engine, activeLayerId, layerPos.x, layerPos.y, ctx.stampOffsetRef.current.x, ctx.stampOffsetRef.current.y, toolSettings.stampSize);
    }
    editorState.notifyRender();
  } else {
    // CPU fallback when selection active
    const stampShiftLine = shiftKey
      && ctx.lastPaintPointRef.current
      && ctx.lastPaintPointRef.current.layerId === activeLayerId;
    if (stampShiftLine) {
      const spacing = Math.max(1, toolSettings.stampSize * 0.25);
      const pts = interpolatePoints(ctx.lastPaintPointRef.current!.point, layerPos, spacing);
      for (const pt of pts) {
        applyStampDab(paintSurface, pixelBuffer, pt, ctx.stampOffsetRef.current, toolSettings.stampSize);
      }
    } else {
      applyStampDab(paintSurface, pixelBuffer, layerPos, ctx.stampOffsetRef.current, toolSettings.stampSize);
    }
    editorState.updateLayerPixelData(activeLayerId, pixelBuffer.toImageData());
  }

  return state;
}

export function handleStampMove(
  state: InteractionState,
  layerLocalPos: Point,
  stampOffsetRef: MutableRefObject<Point | null>,
): void {
  if (!state.lastPoint || !stampOffsetRef.current) return;

  const toolSettings = useToolSettingsStore.getState();
  const stampSpacing = Math.max(1, toolSettings.stampSize * 0.25);

  const engine = state._usedGpuStroke ? getEngine() : null;

  if (engine && state.layerId) {
    // GPU path
    const pts = interpolateFlat(state.lastPoint, layerLocalPos, stampSpacing);
    gpuStampDabBatch(engine, state.layerId, pts, stampOffsetRef.current.x, stampOffsetRef.current.y, toolSettings.stampSize);
  } else if (state.pixelBuffer && state.originalPixelBuffer) {
    // CPU fallback
    const stampSurface = wrapWithSelectionMask(state.pixelBuffer, state.layerStartX, state.layerStartY);
    const stampPoints = interpolatePoints(state.lastPoint, layerLocalPos, stampSpacing);
    for (const pt of stampPoints) {
      applyStampDab(stampSurface, state.originalPixelBuffer, pt, stampOffsetRef.current, toolSettings.stampSize);
    }
  }
  state.lastPoint = layerLocalPos;
  useEditorStore.getState().notifyRender();
}

export function handleTextDown(ctx: InteractionContext): void {
  const { layerPos, activeLayerId, pixelBuffer, paintSurface } = ctx;
  const editorState = useEditorStore.getState();
  editorState.pushHistory();
  const toolSettings = useToolSettingsStore.getState();
  const textContent = toolSettings.textContent;
  const fontSize = toolSettings.textFontSize;
  const fontFamily = toolSettings.textFontFamily;
  const fontWeight = toolSettings.textFontWeight;
  const fontStyle = toolSettings.textFontStyle;
  const textColor = useUIStore.getState().foregroundColor;
  useUIStore.getState().addRecentColor(textColor);
  renderText(paintSurface, layerPos, textContent, fontSize, fontFamily, textColor, fontWeight, fontStyle);
  editorState.updateLayerPixelData(activeLayerId, pixelBuffer.toImageData());
}

export function handleCropDown(ctx: InteractionContext): InteractionState {
  const { canvasPos, activeLayerId } = ctx;
  useUIStore.getState().setCropRect(null);
  return {
    drawing: true,
    lastPoint: canvasPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'crop',
    startPoint: canvasPos,
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleCropMove(state: InteractionState, canvasPos: Point): void {
  if (!state.startPoint) return;
  const edDoc = useEditorStore.getState().document;
  const x1 = Math.max(0, Math.min(state.startPoint.x, canvasPos.x));
  const y1 = Math.max(0, Math.min(state.startPoint.y, canvasPos.y));
  const x2 = Math.min(edDoc.width, Math.max(state.startPoint.x, canvasPos.x));
  const y2 = Math.min(edDoc.height, Math.max(state.startPoint.y, canvasPos.y));
  const cw = x2 - x1;
  const ch = y2 - y1;
  if (cw > 0 && ch > 0) {
    useUIStore.getState().setCropRect({ x: x1, y: y1, width: cw, height: ch });
    useEditorStore.getState().notifyRender();
  }
}

export function handleCropUp(state: InteractionState): void {
  if (state.tool !== 'crop') return;
  const cropRect = useUIStore.getState().cropRect;
  if (cropRect && cropRect.width > 1 && cropRect.height > 1) {
    useEditorStore.getState().cropCanvas(cropRect);
  }
  useUIStore.getState().setCropRect(null);
}

export function handlePathDown(ctx: InteractionContext): InteractionState | undefined {
  const { layerPos, activeLayerId, activeLayer } = ctx;
  const uiState = useUIStore.getState();
  const anchors = uiState.pathAnchors;
  const editorState = useEditorStore.getState();

  if (anchors.length >= 2) {
    const first = anchors[0];
    if (first) {
      const dx = layerPos.x - first.point.x;
      const dy = layerPos.y - first.point.y;
      if (Math.sqrt(dx * dx + dy * dy) < 8) {
        uiState.closePath();
        rasterizePathToLayer([...anchors], true, activeLayerId, editorState);
        return undefined;
      }
    }
  }

  const newAnchor = { point: layerPos, handleIn: null, handleOut: null };
  uiState.addPathAnchor(newAnchor);
  return {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'path',
    startPoint: layerPos,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handlePathMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.startPoint) return;
  const dx = layerLocalPos.x - state.startPoint.x;
  const dy = layerLocalPos.y - state.startPoint.y;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
    const handleOut: Point = { x: state.startPoint.x + dx, y: state.startPoint.y + dy };
    const handleIn: Point = { x: state.startPoint.x - dx, y: state.startPoint.y - dy };
    useUIStore.getState().updateLastPathAnchor({
      point: state.startPoint,
      handleIn,
      handleOut,
    });
    useEditorStore.getState().notifyRender();
  }
}

export function handleShapeGradientDown(
  ctx: InteractionContext,
  tool: 'shape' | 'gradient',
): InteractionState {
  const { layerPos, activeLayerId, activeLayer, pixelBuffer } = ctx;
  const editorState = useEditorStore.getState();
  editorState.pushHistory();
  if (tool === 'shape') {
    const ts = useToolSettingsStore.getState();
    if (ts.shapeFillColor) useUIStore.getState().addRecentColor(ts.shapeFillColor);
    if (ts.shapeStrokeColor) useUIStore.getState().addRecentColor(ts.shapeStrokeColor);
  } else {
    useUIStore.getState().addRecentColor(useUIStore.getState().foregroundColor);
    useUIStore.getState().addRecentColor(useUIStore.getState().backgroundColor);
  }
  return {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer,
    originalPixelBuffer: pixelBuffer.clone(),
    layerId: activeLayerId,
    tool,
    startPoint: layerPos,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

const CLICK_THRESHOLD = 4;

export function handleShapeUp(state: InteractionState, layerLocalPos: Point): void {
  if (!state.startPoint || !state.pixelBuffer || !state.originalPixelBuffer) return;
  const dx = layerLocalPos.x - state.startPoint.x;
  const dy = layerLocalPos.y - state.startPoint.y;
  if (Math.sqrt(dx * dx + dy * dy) < CLICK_THRESHOLD) {
    // Undo the history push from mousedown since nothing was drawn
    useEditorStore.getState().undo();
    useUIStore.getState().setPendingShapeClick({
      center: state.startPoint,
      layerId: state.layerId!,
      layerX: state.layerStartX,
      layerY: state.layerStartY,
    });
  }
}

function constrainToAspectRatio(center: Point, edge: Point): Point {
  const ts = useToolSettingsStore.getState();
  if (!ts.aspectRatioLocked || ts.aspectRatioW <= 0 || ts.aspectRatioH <= 0) return edge;
  const ratio = ts.aspectRatioW / ts.aspectRatioH;
  let rx = Math.abs(edge.x - center.x);
  let ry = Math.abs(edge.y - center.y);
  if (rx / (ry || 1) > ratio) {
    rx = ry * ratio;
  } else {
    ry = rx / ratio;
  }
  return {
    x: center.x + rx * Math.sign(edge.x - center.x || 1),
    y: center.y + ry * Math.sign(edge.y - center.y || 1),
  };
}

/** Map shape mode to GPU enum (0 = ellipse, 1 = polygon). */
function shapeModeToU32(mode: 'ellipse' | 'polygon'): number {
  return mode === 'ellipse' ? 0 : 1;
}

export function handleShapeMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.startPoint) return;

  const toolSettings = useToolSettingsStore.getState();
  const constrainedEdge = constrainToAspectRatio(state.startPoint, layerLocalPos);
  const rx = Math.abs(constrainedEdge.x - state.startPoint.x);
  const ry = Math.abs(constrainedEdge.y - state.startPoint.y);
  if (rx < 1 && ry < 1) return;

  const engine = getEngine();
  const hasSelection = useEditorStore.getState().selection.active;

  if (engine && !hasSelection && state.layerId) {
    // GPU path: render shape directly on GPU texture
    const fillColor = toolSettings.shapeFillColor;
    const strokeColor = toolSettings.shapeStrokeColor;
    gpuRenderShape(
      engine, state.layerId,
      shapeModeToU32(toolSettings.shapeMode),
      state.startPoint.x + state.layerStartX,
      state.startPoint.y + state.layerStartY,
      rx * 2, ry * 2,
      fillColor ? fillColor.r / 255 : 0, fillColor ? fillColor.g / 255 : 0,
      fillColor ? fillColor.b / 255 : 0, fillColor ? fillColor.a : 0,
      strokeColor ? strokeColor.r / 255 : 0, strokeColor ? strokeColor.g / 255 : 0,
      strokeColor ? strokeColor.b / 255 : 0, strokeColor ? strokeColor.a : 0,
      toolSettings.shapeStrokeWidth, toolSettings.shapePolygonSides, 0,
    );
    // Clear stale JS pixel data
    const editorState = useEditorStore.getState();
    const pixelDataMap = new Map(editorState.layerPixelData);
    pixelDataMap.delete(state.layerId);
    const sparseMap = new Map(editorState.sparseLayerData);
    sparseMap.delete(state.layerId);
    const dirtyIds = new Set(editorState.dirtyLayerIds);
    dirtyIds.add(state.layerId);
    useEditorStore.setState({ layerPixelData: pixelDataMap, sparseLayerData: sparseMap, dirtyLayerIds: dirtyIds });
    editorState.notifyRender();
  } else {
    // CPU fallback
    if (!state.pixelBuffer || !state.originalPixelBuffer) return;
    const restored = state.originalPixelBuffer.clone();
    const shapeSurface = wrapWithSelectionMask(restored, state.layerStartX, state.layerStartY);
    drawShape(shapeSurface, state.startPoint, constrainedEdge, {
      mode: toolSettings.shapeMode,
      fillColor: toolSettings.shapeFillColor,
      strokeColor: toolSettings.shapeStrokeColor,
      strokeWidth: toolSettings.shapeStrokeWidth,
      sides: toolSettings.shapePolygonSides,
    });
    state.pixelBuffer = restored;
    resetLayerPosition(state.layerId!, state.layerStartX, state.layerStartY);
    useEditorStore.getState().updateLayerPixelData(state.layerId!, restored.toImageData());
  }
}

export function handleGradientMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.startPoint) return;

  const fg = useUIStore.getState().foregroundColor;
  const bg = useUIStore.getState().backgroundColor;
  const toolSettings = useToolSettingsStore.getState();
  const gradType = toolSettings.gradientType;

  const engine = getEngine();
  const hasSelection = useEditorStore.getState().selection.active;

  if (engine && !hasSelection && state.layerId) {
    // GPU path: render gradient directly via GPU shader
    const stopsJson = JSON.stringify([
      { position: 0, r: fg.r / 255, g: fg.g / 255, b: fg.b / 255, a: fg.a },
      { position: 1, r: bg.r / 255, g: bg.g / 255, b: bg.b / 255, a: bg.a },
    ]);

    // Use canvas-space coordinates for the GPU shader
    const startX = state.startPoint.x + state.layerStartX;
    const startY = state.startPoint.y + state.layerStartY;
    const endX = layerLocalPos.x + state.layerStartX;
    const endY = layerLocalPos.y + state.layerStartY;

    if (gradType === 'linear') {
      gpuRenderLinearGradient(engine, state.layerId, startX, startY, endX, endY, stopsJson);
    } else {
      const dx = endX - startX;
      const dy = endY - startY;
      const radius = Math.sqrt(dx * dx + dy * dy);
      gpuRenderRadialGradient(engine, state.layerId, startX, startY, radius, stopsJson);
    }

    // Clear stale JS pixel data
    const editorState = useEditorStore.getState();
    const pixelDataMap = new Map(editorState.layerPixelData);
    pixelDataMap.delete(state.layerId);
    const sparseMap = new Map(editorState.sparseLayerData);
    sparseMap.delete(state.layerId);
    const dirtyIds = new Set(editorState.dirtyLayerIds);
    dirtyIds.add(state.layerId);
    useEditorStore.setState({ layerPixelData: pixelDataMap, sparseLayerData: sparseMap, dirtyLayerIds: dirtyIds });
    editorState.notifyRender();
  } else {
    // CPU fallback when selection active
    if (!state.pixelBuffer || !state.originalPixelBuffer) return;
    const restored = state.originalPixelBuffer.clone();
    const gradSurface = wrapWithSelectionMask(restored, state.layerStartX, state.layerStartY);
    const stops = [
      { position: 0, color: fg },
      { position: 1, color: bg },
    ] as const;

    for (let y = 0; y < restored.height; y++) {
      for (let x = 0; x < restored.width; x++) {
        let t: number;
        if (gradType === 'linear') {
          t = computeLinearGradientT(
            x, y,
            state.startPoint.x, state.startPoint.y,
            layerLocalPos.x, layerLocalPos.y,
          );
        } else {
          const dx = layerLocalPos.x - state.startPoint.x;
          const dy = layerLocalPos.y - state.startPoint.y;
          const radius = Math.sqrt(dx * dx + dy * dy);
          t = computeRadialGradientT(x, y, state.startPoint.x, state.startPoint.y, radius);
        }
        const gradColor = interpolateGradient(stops, t);
        const existing = restored.getPixel(x, y);
        const ga = gradColor.a;
        const ea = existing.a;
        const outA = ga + ea * (1 - ga);
        if (outA > 0) {
          gradSurface.setPixel(x, y, {
            r: Math.round((gradColor.r * ga + existing.r * ea * (1 - ga)) / outA),
            g: Math.round((gradColor.g * ga + existing.g * ea * (1 - ga)) / outA),
            b: Math.round((gradColor.b * ga + existing.b * ea * (1 - ga)) / outA),
            a: outA,
          });
        }
      }
    }
    state.pixelBuffer = restored;
    resetLayerPosition(state.layerId!, state.layerStartX, state.layerStartY);
    useEditorStore.getState().updateLayerPixelData(state.layerId!, restored.toImageData());
  }

  useUIStore.getState().setGradientPreview({
    start: { x: state.startPoint.x + state.layerStartX, y: state.startPoint.y + state.layerStartY },
    end: { x: layerLocalPos.x + state.layerStartX, y: layerLocalPos.y + state.layerStartY },
  });
}
