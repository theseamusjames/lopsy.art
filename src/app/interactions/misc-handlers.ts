import type { MutableRefObject } from 'react';
import type { InteractionState, InteractionContext } from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';
import type { Point } from '../../types';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { commitCurrentPath } from './path-stroke';
import { hitTestAnchor, hitTestSegment, splitSegmentAt } from '../../tools/path/path';
import type { PathAnchor } from '../../tools/path/path';
import { ellipseToPathAnchors, polygonToPathAnchors } from '../../tools/shape/shape';
import { renderTextToCanvas } from '../../tools/text/text';
import type { TextStyle } from '../../tools/text/text';
import { createTextLayer } from '../../layers/layer-model';
import { hitTestTextLayer } from '../../tools/text/text-hit-test';
import type { TextEditingState } from '../ui-store';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
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

export function handleFillDown(ctx: InteractionContext): void {
  const { layerPos, activeLayerId } = ctx;
  const editorState = useEditorStore.getState();
  editorState.pushHistory();
  const color = useUIStore.getState().foregroundColor;
  useUIStore.getState().addRecentColor(color);
  const toolSettings = useToolSettingsStore.getState();
  const tolerance = toolSettings.fillTolerance;
  const contiguous = toolSettings.fillContiguous;

  const engine = getEngine();
  if (!engine) return;

  const pixelData = wasmReadLayerPixelsForFill(engine, activeLayerId);
  const { width: docW, height: docH } = editorState.document;
  const layer = editorState.document.layers.find((l) => l.id === activeLayerId);
  const canvasX = Math.round(layerPos.x + (layer?.x ?? 0));
  const canvasY = Math.round(layerPos.y + (layer?.y ?? 0));
  const fillMask = wasmFloodFill(
    pixelData, docW, docH,
    canvasX, canvasY,
    color.r, color.g, color.b, Math.round(color.a * 255),
    tolerance, contiguous,
  );

  const { selection } = editorState;
  if (selection.active && selection.mask) {
    const selMask = selection.mask;
    for (let i = 0; i < fillMask.length && i < selMask.length; i++) {
      if (selMask[i] === 0) {
        fillMask[i] = 0;
      }
    }
  }

  wasmApplyFillToLayer(
    engine, activeLayerId,
    color.r / 255, color.g / 255, color.b / 255, color.a,
    fillMask, docW, docH,
  );
  clearJsPixelData(activeLayerId);
  editorState.notifyRender();
}

function gpuSampleColorAt(canvasX: number, canvasY: number): { r: number; g: number; b: number; a: number } | null {
  const engine = getEngine();
  if (!engine) return null;
  const rgba = wasmSampleColor(engine, canvasX, canvasY, 1);
  if (rgba.length < 4) return null;
  return { r: rgba[0]!, g: rgba[1]!, b: rgba[2]!, a: rgba[3]! / 255 };
}

export function handleEyedropperDown(ctx: InteractionContext): InteractionState {
  const { canvasPos, activeLayerId, activeLayer } = ctx;

  const gpuColor = gpuSampleColorAt(canvasPos.x, canvasPos.y);
  if (gpuColor) {
    useUIStore.getState().setForegroundColor(gpuColor);
  }

  return {
    drawing: true,
    lastPoint: canvasPos,
    pixelBuffer: null,
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
  const canvasX = layerLocalPos.x + state.layerStartX;
  const canvasY = layerLocalPos.y + state.layerStartY;
  const gpuColor = gpuSampleColorAt(canvasX, canvasY);
  if (gpuColor) {
    useUIStore.getState().setForegroundColor(gpuColor);
  }
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
  const { layerPos, activeLayerId, activeLayer, shiftKey } = ctx;
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
  if (engine) {
    const modeU32 = dodgeModeToU32(dodgeMode);
    if (dodgeShiftLine) {
      const spacing = Math.max(1, dodgeSize * 0.25);
      const pts = interpolateFlat(ctx.lastPaintPointRef.current!.point, layerPos, spacing);
      gpuDodgeBurnDabBatch(engine, activeLayerId, pts, dodgeSize, modeU32, exposure);
    } else {
      gpuDodgeBurnDab(engine, activeLayerId, layerPos.x, layerPos.y, dodgeSize, modeU32, exposure);
    }
    editorState.notifyRender();
  }

  return {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer: null,
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

  const engine = getEngine();
  if (engine && state.layerId) {
    const pts = interpolateFlat(state.lastPoint, layerLocalPos, dodgeSpacing);
    gpuDodgeBurnDabBatch(engine, state.layerId, pts, dodgeSize, dodgeModeToU32(dodgeMode), exposure);
  }
  state.lastPoint = layerLocalPos;
  useEditorStore.getState().notifyRender();
}

export function handleStampDown(ctx: InteractionContext): InteractionState | undefined {
  const { layerPos, activeLayerId, activeLayer, altKey, shiftKey } = ctx;

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

  const toolSettings = useToolSettingsStore.getState();
  const engine = getEngine();

  if (engine) {
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
  }

  return {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'stamp',
    startPoint: layerPos,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleStampMove(
  state: InteractionState,
  layerLocalPos: Point,
  stampOffsetRef: MutableRefObject<Point | null>,
): void {
  if (!state.lastPoint || !stampOffsetRef.current) return;

  const toolSettings = useToolSettingsStore.getState();
  const stampSpacing = Math.max(1, toolSettings.stampSize * 0.25);

  const engine = getEngine();
  if (engine && state.layerId) {
    const pts = interpolateFlat(state.lastPoint, layerLocalPos, stampSpacing);
    gpuStampDabBatch(engine, state.layerId, pts, stampOffsetRef.current.x, stampOffsetRef.current.y, toolSettings.stampSize);
  }
  state.lastPoint = layerLocalPos;
  useEditorStore.getState().notifyRender();
}

/** Commit the current text editing session: render text to pixels and update the layer. */
export function commitTextEditing(): void {
  const uiState = useUIStore.getState();
  const editing = uiState.textEditing;
  if (!editing) return;

  // Clear editing state first to prevent re-entry
  uiState.commitTextEditing();

  const editorState = useEditorStore.getState();

  // Check that the layer still exists
  const layerExists = editorState.document.layers.some((l) => l.id === editing.layerId);
  if (!layerExists) {
    editorState.notifyRender();
    return;
  }

  // If no text was entered, just cancel
  if (editing.text.trim() === '') {
    if (editing.isNew) {
      editorState.removeLayer(editing.layerId);
    } else {
      editorState.updateTextLayerProperties(editing.layerId, { visible: editing.originalVisible });
    }
    editorState.notifyRender();
    return;
  }

  const toolSettings = useToolSettingsStore.getState();
  const textColor = uiState.foregroundColor;

  editorState.pushHistory('Text');
  uiState.addRecentColor(textColor);

  const style: TextStyle = {
    fontSize: toolSettings.textFontSize,
    fontFamily: toolSettings.textFontFamily,
    fontWeight: toolSettings.textFontWeight,
    fontStyle: toolSettings.textFontStyle,
    color: textColor,
    lineHeight: 1.4,
    letterSpacing: 0,
    textAlign: toolSettings.textAlign,
  };

  const doc = editorState.document;
  const areaWidth = editing.bounds.width;

  // Render text at (0,0) on a canvas — the layer's x/y positions it in document space
  const textCanvas = renderTextToCanvas(
    doc.width,
    doc.height,
    { x: 0, y: 0 },
    editing.text,
    style,
    areaWidth,
  );

  // Update the text layer properties
  editorState.updateTextLayerProperties(editing.layerId, {
    text: editing.text,
    fontFamily: toolSettings.textFontFamily,
    fontSize: toolSettings.textFontSize,
    fontWeight: toolSettings.textFontWeight,
    fontStyle: toolSettings.textFontStyle,
    color: textColor,
    textAlign: toolSettings.textAlign,
    width: areaWidth,
    x: editing.bounds.x,
    y: editing.bounds.y,
    visible: true,
  });

  // Upload pixel data through the standard pipeline
  const textCtx = textCanvas.getContext('2d');
  if (textCtx) {
    const imageData = textCtx.getImageData(0, 0, doc.width, doc.height);
    editorState.updateLayerPixelData(editing.layerId, imageData);
  }
  editorState.notifyRender();
}

export function handleTextDown(ctx: InteractionContext): InteractionState | undefined {
  const { canvasPos, activeLayerId, activeLayer } = ctx;
  const uiState = useUIStore.getState();
  const editorState = useEditorStore.getState();

  // If currently editing, commit the existing text and stop — don't start a new session
  if (uiState.textEditing) {
    commitTextEditing();
    return undefined;
  }

  // Check if we clicked on an existing text layer
  const hitLayer = hitTestTextLayer(editorState.document.layers, canvasPos);
  if (hitLayer) {
    // Enter edit mode for existing text layer
    const toolSettings = useToolSettingsStore.getState();
    toolSettings.setTextFontSize(hitLayer.fontSize);
    toolSettings.setTextFontFamily(hitLayer.fontFamily);
    toolSettings.setTextFontWeight(hitLayer.fontWeight);
    toolSettings.setTextFontStyle(hitLayer.fontStyle);
    toolSettings.setTextAlign(hitLayer.textAlign);
    uiState.setForegroundColor(hitLayer.color);

    // Set active layer to the hit text layer
    editorState.setActiveLayer(hitLayer.id);

    // Keep layer visible — GPU renders text preview in real-time

    const editingState: TextEditingState = {
      layerId: hitLayer.id,
      bounds: {
        x: hitLayer.x,
        y: hitLayer.y,
        width: hitLayer.width,
        height: null,
      },
      text: hitLayer.text,
      cursorPos: hitLayer.text.length,
      isNew: false,
      originalVisible: hitLayer.visible,
    };
    uiState.startTextEditing(editingState);
    editorState.notifyRender();
    return undefined;
  }

  // Start dragging to create a new text area
  uiState.setTextDrag({
    startX: canvasPos.x,
    startY: canvasPos.y,
    currentX: canvasPos.x,
    currentY: canvasPos.y,
  });

  return {
    drawing: true,
    lastPoint: canvasPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'text',
    startPoint: canvasPos,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleTextMove(state: InteractionState, canvasPos: Point): void {
  if (!state.startPoint) return;
  const uiState = useUIStore.getState();
  uiState.setTextDrag({
    startX: state.startPoint.x,
    startY: state.startPoint.y,
    currentX: canvasPos.x,
    currentY: canvasPos.y,
  });
  useEditorStore.getState().notifyRender();
}

const TEXT_DRAG_THRESHOLD = 4;

export function handleTextUp(state: InteractionState, canvasPos: Point): void {
  if (!state.startPoint) return;

  const uiState = useUIStore.getState();
  const editorState = useEditorStore.getState();
  const toolSettings = useToolSettingsStore.getState();
  const textColor = uiState.foregroundColor;

  // Clear drag state
  uiState.setTextDrag(null);

  const dx = canvasPos.x - state.startPoint.x;
  const dy = canvasPos.y - state.startPoint.y;
  const isAreaText = Math.abs(dx) > TEXT_DRAG_THRESHOLD || Math.abs(dy) > TEXT_DRAG_THRESHOLD;

  const boundsX = Math.min(state.startPoint.x, canvasPos.x);
  const boundsY = Math.min(state.startPoint.y, canvasPos.y);
  const boundsW = isAreaText ? Math.abs(dx) : null;
  const boundsH = isAreaText ? Math.abs(dy) : null;

  // Create a new text layer
  const newLayer = createTextLayer({
    name: `Text ${editorState.document.layers.length + 1}`,
    text: '',
    fontFamily: toolSettings.textFontFamily,
    fontSize: toolSettings.textFontSize,
    color: textColor,
  });

  editorState.addTextLayer({
    ...newLayer,
    x: boundsX,
    y: boundsY,
    width: boundsW,
    fontWeight: toolSettings.textFontWeight,
    fontStyle: toolSettings.textFontStyle,
    textAlign: toolSettings.textAlign,
    visible: true, // GPU renders text preview in real-time
  });

  const editingState: TextEditingState = {
    layerId: newLayer.id,
    bounds: {
      x: boundsX,
      y: boundsY,
      width: boundsW,
      height: boundsH,
    },
    text: '',
    cursorPos: 0,
    isNew: true,
    originalVisible: true,
  };
  uiState.startTextEditing(editingState);
  editorState.notifyRender();
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
  const { layerPos, canvasPos, activeLayerId, activeLayer, metaKey } = ctx;
  const uiState = useUIStore.getState();
  const anchors = uiState.pathAnchors;
  const editorState = useEditorStore.getState();
  const selectedPathId = editorState.selectedPathId;

  // --- Edit mode: a stored path is selected ---
  if (selectedPathId && anchors.length === 0) {
    const path = editorState.paths.find((p) => p.id === selectedPathId);
    if (!path) return undefined;

    const hitThreshold = 8 / editorState.viewport.zoom;
    // Path anchors are in document space; use canvasPos
    const anchorIdx = hitTestAnchor(path.anchors, canvasPos, hitThreshold);
    if (anchorIdx >= 0) {
      if (metaKey) {
        const anchor = path.anchors[anchorIdx]!;
        // If already a spline, strip handles immediately (revert to corner)
        if (anchor.handleIn || anchor.handleOut) {
          const updated = [...path.anchors];
          updated[anchorIdx] = { point: anchor.point, handleIn: null, handleOut: null };
          editorState.updatePathAnchors(selectedPathId, updated, path.closed);
          editorState.notifyRender();
        }
      }
      uiState.setConvertingAnchorToSpline(metaKey);
      uiState.setEditingAnchorIndex(anchorIdx);
      return {
        drawing: true,
        lastPoint: canvasPos,
        pixelBuffer: null,
        originalPixelBuffer: null,
        layerId: activeLayerId,
        tool: 'path',
        startPoint: canvasPos,
        layerStartX: activeLayer.x,
        layerStartY: activeLayer.y,
        ...DEFAULT_TRANSFORM_FIELDS,
      };
    }

    const segIdx = hitTestSegment(path.anchors, path.closed, canvasPos, hitThreshold);
    if (segIdx >= 0) {
      // Insert anchor at segment midpoint
      const newAnchors = splitSegmentAt(path.anchors, segIdx);
      editorState.updatePathAnchors(selectedPathId, newAnchors, path.closed);
      editorState.notifyRender();
      return undefined;
    }

    // Clicked empty space — deselect path
    editorState.selectPath(null);
    uiState.setEditingAnchorIndex(null);
    return undefined;
  }

  // --- Creation mode ---
  if (anchors.length >= 2) {
    const first = anchors[0];
    if (first) {
      const dx = layerPos.x - first.point.x;
      const dy = layerPos.y - first.point.y;
      if (Math.sqrt(dx * dx + dy * dy) < 8) {
        uiState.closePath();
        commitCurrentPath();
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

  const uiState = useUIStore.getState();
  const editorState = useEditorStore.getState();
  const editIdx = uiState.editingAnchorIndex;

  // --- Edit mode: dragging an anchor ---
  if (editIdx !== null && editorState.selectedPathId) {
    const path = editorState.paths.find((p) => p.id === editorState.selectedPathId);
    if (!path) return;
    // In edit mode, startPoint and layerLocalPos are in canvas/doc space
    const canvasPos = { x: layerLocalPos.x + state.layerStartX, y: layerLocalPos.y + state.layerStartY };
    const anchor = path.anchors[editIdx];
    if (!anchor) return;

    // Convert-to-spline mode: pull out symmetric handles from the anchor point
    if (uiState.convertingAnchorToSpline) {
      const dx = canvasPos.x - anchor.point.x;
      const dy = canvasPos.y - anchor.point.y;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;

      const updated = [...path.anchors];
      updated[editIdx] = {
        point: anchor.point,
        handleOut: { x: anchor.point.x + dx, y: anchor.point.y + dy },
        handleIn: { x: anchor.point.x - dx, y: anchor.point.y - dy },
      };
      editorState.updatePathAnchors(editorState.selectedPathId, updated, path.closed);
      editorState.notifyRender();
      return;
    }

    const dx = canvasPos.x - anchor.point.x;
    const dy = canvasPos.y - anchor.point.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

    const updated = [...path.anchors];
    updated[editIdx] = {
      point: canvasPos,
      handleIn: anchor.handleIn
        ? { x: anchor.handleIn.x + dx, y: anchor.handleIn.y + dy }
        : null,
      handleOut: anchor.handleOut
        ? { x: anchor.handleOut.x + dx, y: anchor.handleOut.y + dy }
        : null,
    };
    editorState.updatePathAnchors(editorState.selectedPathId, updated, path.closed);
    editorState.notifyRender();
    return;
  }

  // --- Creation mode: dragging to create handles ---
  const dx = layerLocalPos.x - state.startPoint.x;
  const dy = layerLocalPos.y - state.startPoint.y;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
    const handleOut: Point = { x: state.startPoint.x + dx, y: state.startPoint.y + dy };
    const handleIn: Point = { x: state.startPoint.x - dx, y: state.startPoint.y - dy };
    uiState.updateLastPathAnchor({
      point: state.startPoint,
      handleIn,
      handleOut,
    });
    editorState.notifyRender();
  }
}

export function handlePathUp(): void {
  const uiState = useUIStore.getState();
  if (uiState.editingAnchorIndex !== null) {
    uiState.setEditingAnchorIndex(null);
  }
  if (uiState.convertingAnchorToSpline) {
    uiState.setConvertingAnchorToSpline(false);
  }
}

export function handleShapeGradientDown(
  ctx: InteractionContext,
  tool: 'shape' | 'gradient',
): InteractionState {
  const { layerPos, activeLayerId, activeLayer } = ctx;
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
    pixelBuffer: null,
    originalPixelBuffer: null,
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
  if (!state.startPoint) return;
  const dx = layerLocalPos.x - state.startPoint.x;
  const dy = layerLocalPos.y - state.startPoint.y;
  const toolSettings = useToolSettingsStore.getState();

  if (Math.sqrt(dx * dx + dy * dy) < CLICK_THRESHOLD) {
    useEditorStore.getState().undo();
    if (toolSettings.shapeOutput === 'path') return;
    useUIStore.getState().setPendingShapeClick({
      center: state.startPoint,
      layerId: state.layerId!,
      layerX: state.layerStartX,
      layerY: state.layerStartY,
    });
    return;
  }

  if (toolSettings.shapeOutput === 'path') {
    // Undo the raster preview that was rendered during drag
    useEditorStore.getState().undo();

    const constrainedEdge = constrainToAspectRatio(state.startPoint, layerLocalPos);
    const rx = Math.abs(constrainedEdge.x - state.startPoint.x);
    const ry = Math.abs(constrainedEdge.y - state.startPoint.y);
    if (rx < 1 && ry < 1) return;

    // Compute center in document space
    const cx = state.startPoint.x + state.layerStartX;
    const cy = state.startPoint.y + state.layerStartY;

    const editorState = useEditorStore.getState();
    let anchors: PathAnchor[];
    if (toolSettings.shapeMode === 'ellipse') {
      anchors = ellipseToPathAnchors(cx, cy, rx, ry);
    } else {
      anchors = polygonToPathAnchors(cx, cy, rx, ry, toolSettings.shapePolygonSides);
    }
    editorState.addPath(anchors, true);
    editorState.notifyRender();
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
  if (!state.startPoint || !state.layerId) return;

  const toolSettings = useToolSettingsStore.getState();
  const constrainedEdge = constrainToAspectRatio(state.startPoint, layerLocalPos);
  const rx = Math.abs(constrainedEdge.x - state.startPoint.x);
  const ry = Math.abs(constrainedEdge.y - state.startPoint.y);
  if (rx < 1 && ry < 1) return;

  const engine = getEngine();
  if (!engine) return;

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
    toolSettings.shapeStrokeWidth, toolSettings.shapePolygonSides,
    Math.min(toolSettings.shapeCornerRadius, Math.min(rx * 2, ry * 2) / 2),
  );
  clearJsPixelData(state.layerId);
  useEditorStore.getState().notifyRender();
}

export function handleGradientMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.startPoint || !state.layerId) return;

  const fg = useUIStore.getState().foregroundColor;
  const bg = useUIStore.getState().backgroundColor;
  const toolSettings = useToolSettingsStore.getState();
  const gradType = toolSettings.gradientType;

  const engine = getEngine();
  if (!engine) return;

  const stopsJson = JSON.stringify([
    { position: 0, r: fg.r / 255, g: fg.g / 255, b: fg.b / 255, a: fg.a },
    { position: 1, r: bg.r / 255, g: bg.g / 255, b: bg.b / 255, a: bg.a },
  ]);

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

  clearJsPixelData(state.layerId);
  useEditorStore.getState().notifyRender();

  useUIStore.getState().setGradientPreview({
    start: { x: startX, y: startY },
    end: { x: endX, y: endY },
  });
}
