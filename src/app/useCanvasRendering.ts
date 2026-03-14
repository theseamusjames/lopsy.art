import { useEffect, useRef, useState, type RefObject } from 'react';
import { useEditorStore } from './editor-store';
import { useUIStore } from './ui-store';
import { useToolSettingsStore } from './tool-settings-store';
import { getActiveMaskEditBuffer } from './useCanvasInteraction';
import { getBrushCursorInfo } from './useCanvasCursor';
import { getHandlePositions } from '../tools/transform/transform';
import type { TransformHandle, TransformState } from '../tools/transform/transform';
import { traceSelectionContours } from '../selection/selection';
import { CanvasAllocator, renderOuterGlow, renderDropShadow, renderInnerGlow, renderStroke } from '../engine/effects-renderer';

export function useCanvasRendering(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  containerRef: RefObject<HTMLDivElement | null>,
): void {
  const doc = useEditorStore((s) => s.document);
  const viewport = useEditorStore((s) => s.viewport);
  const layers = useEditorStore((s) => s.document.layers);
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);
  const renderVersion = useEditorStore((s) => s.renderVersion);
  const selection = useEditorStore((s) => s.selection);
  const pathAnchors = useUIStore((s) => s.pathAnchors);
  const lassoPoints = useUIStore((s) => s.lassoPoints);
  const cropRect = useUIStore((s) => s.cropRect);
  const transform = useUIStore((s) => s.transform);
  const gradientPreview = useUIStore((s) => s.gradientPreview);
  const maskEditMode = useUIStore((s) => s.maskEditMode);
  const activeTool = useUIStore((s) => s.activeTool);
  const cursorPosition = useUIStore((s) => s.cursorPosition);
  const showGrid = useUIStore((s) => s.showGrid);
  const showRulers = useUIStore((s) => s.showRulers);
  const gridSize = useUIStore((s) => s.gridSize);
  const brushSize = useToolSettingsStore((s) => s.brushSize);
  const pencilSize = useToolSettingsStore((s) => s.pencilSize);
  const eraserSize = useToolSettingsStore((s) => s.eraserSize);
  const stampSize = useToolSettingsStore((s) => s.stampSize);

  const [antPhase, setAntPhase] = useState(0);
  const antFrameRef = useRef(0);

  useEffect(() => {
    if (!selection.active) return;
    let running = true;
    const animate = () => {
      if (!running) return;
      setAntPhase((p) => p + 1);
      antFrameRef.current = requestAnimationFrame(animate);
    };
    antFrameRef.current = requestAnimationFrame(animate);
    return () => {
      running = false;
      cancelAnimationFrame(antFrameRef.current);
    };
  }, [selection.active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Clear
    ctx.fillStyle = '#3c3c3c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw document area
    ctx.save();
    ctx.translate(viewport.panX + canvas.width / 2, viewport.panY + canvas.height / 2);
    ctx.scale(viewport.zoom, viewport.zoom);
    ctx.translate(-doc.width / 2, -doc.height / 2);

    // Checkerboard for transparency — clamp tile size at document edges
    // so tiles don't extend past the document bounds
    const checkSize = 8;
    for (let y = 0; y < doc.height; y += checkSize) {
      const tileH = Math.min(checkSize, doc.height - y);
      for (let x = 0; x < doc.width; x += checkSize) {
        const tileW = Math.min(checkSize, doc.width - x);
        const isLight = ((x / checkSize) + (y / checkSize)) % 2 === 0;
        ctx.fillStyle = isLight ? '#ffffff' : '#cccccc';
        ctx.fillRect(x, y, tileW, tileH);
      }
    }

    // Draw layer pixel data (using canvas pool to avoid per-frame allocations)
    const pixelData = useEditorStore.getState().layerPixelData;
    allocator.releaseAll();
    for (const layer of layers) {
      if (!layer.visible) continue;
      const data = pixelData.get(layer.id);
      if (!data) continue;

      ctx.globalAlpha = layer.opacity;
      const { canvas: tempCanvas, ctx: tempCtx } = allocator.acquire(data.width, data.height);
      tempCtx.putImageData(data, 0, 0);

      renderOuterGlow(ctx, tempCanvas, layer, data, allocator);
      renderDropShadow(ctx, tempCanvas, layer, data, allocator);
      renderLayerContent(ctx, tempCanvas, layer, data, maskEditMode, activeLayerId, allocator);
      renderInnerGlow(ctx, tempCanvas, layer, data, allocator);
      renderStroke(ctx, tempCanvas, layer, data, allocator);
    }

    ctx.globalAlpha = 1;

    // Document border
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 1 / viewport.zoom;
    ctx.strokeRect(0, 0, doc.width, doc.height);

    if (showGrid) {
      renderGrid(ctx, doc.width, doc.height, gridSize, viewport.zoom);
    }

    renderSelectionAnts(ctx, selection, viewport.zoom, antPhase);
    renderTransformHandles(ctx, selection, transform, viewport.zoom);
    renderPathOverlay(ctx, pathAnchors, layers, doc.activeLayerId, viewport.zoom);
    renderLassoPreview(ctx, lassoPoints, viewport.zoom);
    renderCropPreview(ctx, cropRect, doc.width, doc.height, viewport.zoom);
    renderGradientPreview(ctx, gradientPreview, viewport.zoom);

    const brushCursor = getBrushCursorInfo(activeTool);
    if (brushCursor !== null) {
      renderBrushCursor(ctx, cursorPosition, brushCursor.size, viewport.zoom, brushCursor.shape);
    }

    ctx.restore();

    if (showRulers) {
      renderRulers(ctx, canvas.width, canvas.height, viewport, doc.width, doc.height, cursorPosition);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, viewport, layers, renderVersion, selection, pathAnchors, lassoPoints, cropRect, transform, maskEditMode, activeLayerId, gradientPreview, antPhase, activeTool, cursorPosition, brushSize, pencilSize, eraserSize, stampSize, showGrid, showRulers, gridSize]);
}

// --- Helper render functions ---

import type { Layer, Point, Rect } from '../types';
import type { PathAnchor } from './ui-store';

// Module-level allocator reused each frame
const allocator = new CanvasAllocator();

interface SelectionData {
  active: boolean;
  mask: Uint8ClampedArray | null;
  maskWidth: number;
  maskHeight: number;
}


export function renderLayerContent(
  ctx: CanvasRenderingContext2D,
  tempCanvas: HTMLCanvasElement,
  layer: Layer,
  data: ImageData,
  maskEditMode: boolean,
  activeLayerId: string | null,
  alloc: CanvasAllocator,
): void {
  if (layer.mask && layer.mask.enabled && !maskEditMode) {
    const { canvas: maskedCanvas, ctx: maskedCtx } = alloc.acquire(data.width, data.height);
    maskedCtx.drawImage(tempCanvas, 0, 0);
    const maskImageData = new ImageData(layer.mask.width, layer.mask.height);
    for (let i = 0; i < layer.mask.data.length; i++) {
      const idx = i * 4;
      const val = layer.mask.data[i] ?? 0;
      maskImageData.data[idx] = val;
      maskImageData.data[idx + 1] = val;
      maskImageData.data[idx + 2] = val;
      maskImageData.data[idx + 3] = 255;
    }
    const { canvas: maskCanvas, ctx: maskCtx } = alloc.acquire(layer.mask.width, layer.mask.height);
    maskCtx.putImageData(maskImageData, 0, 0);
    maskedCtx.globalCompositeOperation = 'destination-in';
    maskedCtx.drawImage(maskCanvas, 0, 0);
    ctx.drawImage(maskedCanvas, layer.x, layer.y);
  } else {
    ctx.drawImage(tempCanvas, layer.x, layer.y);
  }

  // Mask edit mode overlay
  if (maskEditMode && layer.mask && layer.id === activeLayerId) {
    const activeBuf = getActiveMaskEditBuffer();
    const maskWidth = layer.mask.width;
    const maskHeight = layer.mask.height;
    const pixelCount = maskWidth * maskHeight;
    const { ctx: overlayCtx, canvas: overlayCanvas } = alloc.acquire(maskWidth, maskHeight);
    const overlayData = overlayCtx.createImageData(maskWidth, maskHeight);
    // Read from the active drawing buffer if available, otherwise from stored mask data
    const useBuffer = activeBuf && activeBuf.layerId === layer.id;
    const bufRaw = useBuffer ? activeBuf.buf.rawData : null;
    for (let i = 0; i < pixelCount; i++) {
      const val = bufRaw ? (bufRaw[i * 4] ?? 0) : (layer.mask.data[i] ?? 0);
      const overlayAlpha = Math.round((1 - val / 255) * 128);
      const idx = i * 4;
      overlayData.data[idx] = 0;
      overlayData.data[idx + 1] = 100;
      overlayData.data[idx + 2] = 255;
      overlayData.data[idx + 3] = overlayAlpha;
    }
    overlayCtx.putImageData(overlayData, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(overlayCanvas, layer.x, layer.y);
    ctx.globalAlpha = layer.opacity;
  }
}


function renderSelectionAnts(
  ctx: CanvasRenderingContext2D,
  selection: SelectionData,
  zoom: number,
  antPhase: number,
): void {
  if (!selection.active || !selection.mask) return;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const lw = 1.5 / zoom;
  ctx.lineWidth = lw;
  const dashLen = 8 / zoom;
  ctx.setLineDash([dashLen, dashLen]);

  const offset = (antPhase % 120) / 120 * dashLen * 2;

  const contours = traceSelectionContours(selection.mask, selection.maskWidth, selection.maskHeight);

  const drawContours = () => {
    for (const pts of contours) {
      ctx.beginPath();
      ctx.moveTo(pts[0]!, pts[1]!);
      for (let i = 2; i < pts.length; i += 2) {
        ctx.lineTo(pts[i]!, pts[i + 1]!);
      }
      ctx.stroke();
    }
  };

  // Black base — fully visible everywhere
  ctx.setLineDash([]);
  ctx.strokeStyle = '#000000';
  drawContours();

  // White dashes march on top
  ctx.setLineDash([dashLen, dashLen]);
  ctx.lineDashOffset = -offset;
  ctx.strokeStyle = '#ffffff';
  drawContours();

  ctx.restore();
}

function renderTransformHandles(
  ctx: CanvasRenderingContext2D,
  selection: SelectionData,
  transform: TransformState | null,
  zoom: number,
): void {
  if (!selection.active || !transform) return;

  const handles = getHandlePositions(transform);
  const handleSize = 6 / zoom;
  const rotHandleSize = 5 / zoom;

  ctx.save();
  ctx.setLineDash([]);

  const scaleHandleKeys: TransformHandle[] = [
    'top-left', 'top-right', 'bottom-right', 'bottom-left',
  ];
  ctx.strokeStyle = '#00aaff';
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  for (let i = 0; i < scaleHandleKeys.length; i++) {
    const key = scaleHandleKeys[i] as TransformHandle;
    const pos = handles[key];
    if (i === 0) ctx.moveTo(pos.x, pos.y);
    else ctx.lineTo(pos.x, pos.y);
  }
  ctx.closePath();
  ctx.stroke();

  const allScaleHandles: TransformHandle[] = [
    'top-left', 'top', 'top-right', 'right',
    'bottom-right', 'bottom', 'bottom-left', 'left',
  ];
  for (const key of allScaleHandles) {
    const pos = handles[key];
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#00aaff';
    ctx.lineWidth = 1 / zoom;
    ctx.fillRect(pos.x - handleSize / 2, pos.y - handleSize / 2, handleSize, handleSize);
    ctx.strokeRect(pos.x - handleSize / 2, pos.y - handleSize / 2, handleSize, handleSize);
  }

  const rotHandleKeys: TransformHandle[] = [
    'rotate-top-left', 'rotate-top-right',
    'rotate-bottom-right', 'rotate-bottom-left',
  ];
  const cornerForRot: Record<string, TransformHandle> = {
    'rotate-top-left': 'top-left',
    'rotate-top-right': 'top-right',
    'rotate-bottom-right': 'bottom-right',
    'rotate-bottom-left': 'bottom-left',
  };
  for (const key of rotHandleKeys) {
    const pos = handles[key];
    const cornerKey = cornerForRot[key] as TransformHandle;
    const cornerPos = handles[cornerKey];

    ctx.strokeStyle = '#00aaff';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.moveTo(cornerPos.x, cornerPos.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#00aaff';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, rotHandleSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function renderPathOverlay(
  ctx: CanvasRenderingContext2D,
  pathAnchors: PathAnchor[],
  layers: readonly Layer[],
  activeLayerId: string | null,
  zoom: number,
): void {
  if (pathAnchors.length === 0) return;

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const offsetX = activeLayer?.x ?? 0;
  const offsetY = activeLayer?.y ?? 0;

  ctx.save();
  ctx.translate(offsetX, offsetY);

  // Draw path curve
  ctx.strokeStyle = '#00aaff';
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let i = 0; i < pathAnchors.length; i++) {
    const anchor = pathAnchors[i];
    if (!anchor) continue;
    if (i === 0) {
      ctx.moveTo(anchor.point.x, anchor.point.y);
    } else {
      const prev = pathAnchors[i - 1];
      if (!prev) continue;
      const cp1 = prev.handleOut ?? prev.point;
      const cp2 = anchor.handleIn ?? anchor.point;
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, anchor.point.x, anchor.point.y);
    }
  }
  ctx.stroke();

  // Draw control handles
  ctx.strokeStyle = '#888888';
  ctx.lineWidth = 1 / zoom;
  for (const anchor of pathAnchors) {
    if (anchor.handleIn) {
      ctx.beginPath();
      ctx.moveTo(anchor.point.x, anchor.point.y);
      ctx.lineTo(anchor.handleIn.x, anchor.handleIn.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(anchor.handleIn.x, anchor.handleIn.y, 3 / zoom, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.stroke();
    }
    if (anchor.handleOut) {
      ctx.beginPath();
      ctx.moveTo(anchor.point.x, anchor.point.y);
      ctx.lineTo(anchor.handleOut.x, anchor.handleOut.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(anchor.handleOut.x, anchor.handleOut.y, 3 / zoom, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.stroke();
    }
  }

  // Draw anchor points
  const anchorSize = 4 / zoom;
  for (let i = 0; i < pathAnchors.length; i++) {
    const anchor = pathAnchors[i];
    if (!anchor) continue;
    ctx.fillStyle = i === 0 ? '#00aaff' : '#ffffff';
    ctx.strokeStyle = '#00aaff';
    ctx.lineWidth = 1 / zoom;
    ctx.fillRect(anchor.point.x - anchorSize / 2, anchor.point.y - anchorSize / 2, anchorSize, anchorSize);
    ctx.strokeRect(anchor.point.x - anchorSize / 2, anchor.point.y - anchorSize / 2, anchorSize, anchorSize);
  }

  ctx.restore();
}

function renderLassoPreview(
  ctx: CanvasRenderingContext2D,
  lassoPoints: Point[],
  zoom: number,
): void {
  if (lassoPoints.length <= 1) return;

  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.beginPath();
  const firstLasso = lassoPoints[0];
  if (firstLasso) {
    ctx.moveTo(firstLasso.x, firstLasso.y);
    for (let i = 1; i < lassoPoints.length; i++) {
      const lp = lassoPoints[i];
      if (lp) ctx.lineTo(lp.x, lp.y);
    }
  }
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = '#000000';
  ctx.lineDashOffset = 4 / zoom;
  ctx.stroke();
  ctx.restore();
}

function renderCropPreview(
  ctx: CanvasRenderingContext2D,
  cropRect: Rect | null,
  docWidth: number,
  docHeight: number,
  zoom: number,
): void {
  if (!cropRect) return;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, docWidth, cropRect.y);
  ctx.fillRect(0, cropRect.y, cropRect.x, cropRect.height);
  ctx.fillRect(cropRect.x + cropRect.width, cropRect.y, docWidth - cropRect.x - cropRect.width, cropRect.height);
  ctx.fillRect(0, cropRect.y + cropRect.height, docWidth, docHeight - cropRect.y - cropRect.height);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([]);
  ctx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
  ctx.restore();
}

function renderGradientPreview(
  ctx: CanvasRenderingContext2D,
  gradientPreview: { start: Point; end: Point } | null,
  zoom: number,
): void {
  if (!gradientPreview) return;

  ctx.save();
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([]);

  const { start, end } = gradientPreview;

  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 0.75 / zoom;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  const pointRadius = 4 / zoom;
  for (const pt of [start, end]) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pointRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1 / zoom;
    ctx.stroke();
  }

  ctx.restore();
}

function renderBrushCursor(
  ctx: CanvasRenderingContext2D,
  position: Point,
  size: number,
  zoom: number,
  shape: 'circle' | 'square',
): void {
  const half = size / 2;

  ctx.save();

  // Draw a crosshair at center for very small brushes
  if (size * zoom < 4) {
    const crossSize = 5 / zoom;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    ctx.moveTo(position.x - crossSize, position.y);
    ctx.lineTo(position.x + crossSize, position.y);
    ctx.moveTo(position.x, position.y - crossSize);
    ctx.lineTo(position.x, position.y + crossSize);
    ctx.stroke();

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 0.75 / zoom;
    ctx.beginPath();
    ctx.moveTo(position.x - crossSize, position.y);
    ctx.lineTo(position.x + crossSize, position.y);
    ctx.moveTo(position.x, position.y - crossSize);
    ctx.lineTo(position.x, position.y + crossSize);
    ctx.stroke();
  } else if (shape === 'square') {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 1.5 / zoom;
    ctx.strokeRect(position.x - half, position.y - half, size, size);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 0.75 / zoom;
    ctx.strokeRect(position.x - half, position.y - half, size, size);
  } else {
    // Outer dark ring
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    ctx.arc(position.x, position.y, half, 0, Math.PI * 2);
    ctx.stroke();

    // Inner light ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 0.75 / zoom;
    ctx.beginPath();
    ctx.arc(position.x, position.y, half, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

const RULER_SIZE = 20;
const RULER_BG = '#2a2a2a';
const RULER_TEXT = '#888888';
const RULER_TICK = '#555555';
const RULER_INDICATOR = '#4a9eff';

function renderRulers(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  viewport: { panX: number; panY: number; zoom: number },
  docWidth: number,
  docHeight: number,
  cursorPosition: Point,
): void {
  const { panX, panY, zoom } = viewport;
  const originX = panX + canvasWidth / 2 - (docWidth / 2) * zoom;
  const originY = panY + canvasHeight / 2 - (docHeight / 2) * zoom;

  // Choose tick spacing based on zoom level
  const rawStep = 50 / zoom;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let step: number;
  if (norm < 2) step = mag * 1;
  else if (norm < 5) step = mag * 2;
  else step = mag * 5;
  if (step < 1) step = 1;

  ctx.save();

  // Horizontal ruler (top)
  ctx.fillStyle = RULER_BG;
  ctx.fillRect(0, 0, canvasWidth, RULER_SIZE);
  ctx.strokeStyle = RULER_TICK;
  ctx.lineWidth = 1;
  ctx.fillStyle = RULER_TEXT;
  ctx.font = '9px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const hStart = Math.floor(-originX / zoom / step) * step;
  const hEnd = Math.ceil((canvasWidth - originX) / zoom / step) * step;
  for (let px = hStart; px <= hEnd; px += step) {
    const screenX = originX + px * zoom;
    if (screenX < RULER_SIZE || screenX > canvasWidth) continue;
    ctx.beginPath();
    ctx.moveTo(screenX, RULER_SIZE - 6);
    ctx.lineTo(screenX, RULER_SIZE);
    ctx.stroke();
    ctx.fillStyle = RULER_TEXT;
    ctx.fillText(String(Math.round(px)), screenX + 2, 2);
  }

  // Bottom border line of horizontal ruler
  ctx.strokeStyle = RULER_TICK;
  ctx.beginPath();
  ctx.moveTo(0, RULER_SIZE);
  ctx.lineTo(canvasWidth, RULER_SIZE);
  ctx.stroke();

  // Vertical ruler (left)
  ctx.fillStyle = RULER_BG;
  ctx.fillRect(0, RULER_SIZE, RULER_SIZE, canvasHeight - RULER_SIZE);
  ctx.strokeStyle = RULER_TICK;

  const vStart = Math.floor(-originY / zoom / step) * step;
  const vEnd = Math.ceil((canvasHeight - originY) / zoom / step) * step;
  for (let px = vStart; px <= vEnd; px += step) {
    const screenY = originY + px * zoom;
    if (screenY < RULER_SIZE || screenY > canvasHeight) continue;
    ctx.beginPath();
    ctx.moveTo(RULER_SIZE - 6, screenY);
    ctx.lineTo(RULER_SIZE, screenY);
    ctx.stroke();
    ctx.save();
    ctx.translate(2, screenY + 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = RULER_TEXT;
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(String(Math.round(px)), 0, 0);
    ctx.restore();
  }

  // Right border line of vertical ruler
  ctx.strokeStyle = RULER_TICK;
  ctx.beginPath();
  ctx.moveTo(RULER_SIZE, RULER_SIZE);
  ctx.lineTo(RULER_SIZE, canvasHeight);
  ctx.stroke();

  // Corner square
  ctx.fillStyle = RULER_BG;
  ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE);

  // Cursor indicator lines (blue)
  const cursorScreenX = originX + cursorPosition.x * zoom;
  const cursorScreenY = originY + cursorPosition.y * zoom;

  ctx.strokeStyle = RULER_INDICATOR;
  ctx.lineWidth = 1;

  // Horizontal indicator
  if (cursorScreenX >= RULER_SIZE && cursorScreenX <= canvasWidth) {
    ctx.beginPath();
    ctx.moveTo(cursorScreenX, 0);
    ctx.lineTo(cursorScreenX, RULER_SIZE);
    ctx.stroke();
  }

  // Vertical indicator
  if (cursorScreenY >= RULER_SIZE && cursorScreenY <= canvasHeight) {
    ctx.beginPath();
    ctx.moveTo(0, cursorScreenY);
    ctx.lineTo(RULER_SIZE, cursorScreenY);
    ctx.stroke();
  }

  ctx.restore();
}

function renderGrid(
  ctx: CanvasRenderingContext2D,
  docWidth: number,
  docHeight: number,
  gridSize: number,
  zoom: number,
): void {
  ctx.save();

  // Minor grid lines
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.25)';
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  for (let x = gridSize; x < docWidth; x += gridSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, docHeight);
  }
  for (let y = gridSize; y < docHeight; y += gridSize) {
    ctx.moveTo(0, y);
    ctx.lineTo(docWidth, y);
  }
  ctx.stroke();

  // Major grid lines every 4 cells
  const majorStep = gridSize * 4;
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.5)';
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  for (let x = majorStep; x < docWidth; x += majorStep) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, docHeight);
  }
  for (let y = majorStep; y < docHeight; y += majorStep) {
    ctx.moveTo(0, y);
    ctx.lineTo(docWidth, y);
  }
  ctx.stroke();

  ctx.restore();
}
