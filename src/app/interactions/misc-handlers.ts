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
  const pixels = floodFill(pixelBuffer, layerPos.x, layerPos.y, color, tolerance, contiguous);
  applyFill(paintSurface, pixels, color);
  editorState.updateLayerPixelData(activeLayerId, pixelBuffer.toImageData());
}

export function handleEyedropperDown(ctx: InteractionContext): InteractionState {
  const { layerPos, activeLayerId, activeLayer, pixelBuffer } = ctx;
  const color = sampleColor(pixelBuffer, layerPos.x, layerPos.y, 'point');
  useUIStore.getState().setForegroundColor(color);
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
  if (!state.pixelBuffer) return;
  const eyeColor = sampleColor(state.pixelBuffer, layerLocalPos.x, layerLocalPos.y, 'point');
  useUIStore.getState().setForegroundColor(eyeColor);
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
  if (!state.pixelBuffer || !state.lastPoint) return;
  const toolSettings = useToolSettingsStore.getState();
  const dodgeMode = toolSettings.dodgeMode;
  const exposure = toolSettings.dodgeExposure / 100;
  const dodgeSize = toolSettings.brushSize;
  const dodgeSpacing = Math.max(1, dodgeSize * 0.25);
  const dodgeSurface = wrapWithSelectionMask(state.pixelBuffer, state.layerStartX, state.layerStartY);
  const dodgePoints = interpolatePoints(state.lastPoint, layerLocalPos, dodgeSpacing);
  for (const pt of dodgePoints) {
    applyDodgeBurn(dodgeSurface, pt, dodgeSize, dodgeMode, exposure);
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
  return state;
}

export function handleStampMove(
  state: InteractionState,
  layerLocalPos: Point,
  stampOffsetRef: MutableRefObject<Point | null>,
): void {
  if (!state.pixelBuffer || !state.originalPixelBuffer || !state.lastPoint || !stampOffsetRef.current) return;
  const stampSurface = wrapWithSelectionMask(state.pixelBuffer, state.layerStartX, state.layerStartY);
  const toolSettings = useToolSettingsStore.getState();
  const stampSpacing = Math.max(1, toolSettings.stampSize * 0.25);
  const stampPoints = interpolatePoints(state.lastPoint, layerLocalPos, stampSpacing);
  for (const pt of stampPoints) {
    applyStampDab(stampSurface, state.originalPixelBuffer, pt, stampOffsetRef.current, toolSettings.stampSize);
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

export function handleShapeMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.pixelBuffer || !state.originalPixelBuffer || !state.startPoint) return;
  const restored = state.originalPixelBuffer.clone();
  const shapeSurface = wrapWithSelectionMask(restored, state.layerStartX, state.layerStartY);
  const toolSettings = useToolSettingsStore.getState();
  const constrainedEdge = constrainToAspectRatio(state.startPoint, layerLocalPos);
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

export function handleGradientMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.pixelBuffer || !state.originalPixelBuffer || !state.startPoint) return;
  const restored = state.originalPixelBuffer.clone();
  const gradSurface = wrapWithSelectionMask(restored, state.layerStartX, state.layerStartY);
  const fg = useUIStore.getState().foregroundColor;
  const bg = useUIStore.getState().backgroundColor;
  const toolSettings = useToolSettingsStore.getState();
  const gradType = toolSettings.gradientType;
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
  // Reset layer position before update — the data is full-canvas-size (from
  // originalPixelBuffer clone), so cropLayerToContent must start from (0,0).
  // Without this, the crop offset accumulates on every mouse move.
  resetLayerPosition(state.layerId!, state.layerStartX, state.layerStartY);
  useEditorStore.getState().updateLayerPixelData(state.layerId!, restored.toImageData());
  useUIStore.getState().setGradientPreview({
    start: { x: state.startPoint.x + state.layerStartX, y: state.startPoint.y + state.layerStartY },
    end: { x: layerLocalPos.x + state.layerStartX, y: layerLocalPos.y + state.layerStartY },
  });
}
