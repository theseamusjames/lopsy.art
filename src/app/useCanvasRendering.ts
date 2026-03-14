import { useEffect, useRef, useState, type RefObject } from 'react';
import { useEditorStore } from './editor-store';
import { useUIStore } from './ui-store';
import { getActiveMaskEditBuffer } from './useCanvasInteraction';
import { getHandlePositions } from '../tools/transform/transform';
import type { TransformHandle, TransformState } from '../tools/transform/transform';
import { traceSelectionContours } from '../selection/selection';
import { canvasPool } from '../engine/canvas-pool';
import type { PooledCanvas } from '../engine/canvas-pool';

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

    // Checkerboard for transparency
    const checkSize = 8;
    for (let y = 0; y < doc.height; y += checkSize) {
      for (let x = 0; x < doc.width; x += checkSize) {
        const isLight = ((x / checkSize) + (y / checkSize)) % 2 === 0;
        ctx.fillStyle = isLight ? '#ffffff' : '#cccccc';
        ctx.fillRect(x, y, checkSize, checkSize);
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

    renderSelectionAnts(ctx, selection, viewport.zoom, antPhase);
    renderTransformHandles(ctx, selection, transform, viewport.zoom);
    renderPathOverlay(ctx, pathAnchors, layers, doc.activeLayerId, viewport.zoom);
    renderLassoPreview(ctx, lassoPoints, viewport.zoom);
    renderCropPreview(ctx, cropRect, doc.width, doc.height, viewport.zoom);
    renderGradientPreview(ctx, gradientPreview, viewport.zoom);

    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, viewport, layers, renderVersion, selection, pathAnchors, lassoPoints, cropRect, transform, maskEditMode, activeLayerId, gradientPreview, antPhase]);
}

// --- Helper render functions ---

import type { Layer, Point, Rect } from '../types';
import type { PathAnchor } from './ui-store';

// Tracks pooled canvases acquired during a render pass so they can all be released at once
export class CanvasAllocator {
  private handles: PooledCanvas[] = [];

  acquire(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const pooled = canvasPool.acquire(w, h);
    this.handles.push(pooled);
    return { canvas: pooled.canvas, ctx: pooled.ctx };
  }

  releaseAll(): void {
    for (const h of this.handles) h.release();
    this.handles.length = 0;
  }
}

// Module-level allocator reused each frame
const allocator = new CanvasAllocator();

interface SelectionData {
  active: boolean;
  mask: Uint8ClampedArray | null;
  maskWidth: number;
  maskHeight: number;
}

export function renderOuterGlow(
  ctx: CanvasRenderingContext2D,
  tempCanvas: HTMLCanvasElement,
  layer: Layer,
  data: ImageData,
  alloc: CanvasAllocator,
): void {
  if (!layer.effects.outerGlow.enabled) return;
  const glow = layer.effects.outerGlow;
  const glowBlur = glow.size + glow.spread;
  const pad = glowBlur * 2;
  const { canvas: glowCanvas, ctx: glowCtx } = alloc.acquire(data.width + pad * 2, data.height + pad * 2);
  glowCtx.filter = `blur(${glowBlur}px)`;
  glowCtx.drawImage(tempCanvas, pad, pad);
  glowCtx.globalCompositeOperation = 'source-in';
  glowCtx.filter = 'none';
  glowCtx.fillStyle = `rgba(${glow.color.r},${glow.color.g},${glow.color.b},${glow.opacity})`;
  glowCtx.fillRect(0, 0, glowCanvas.width, glowCanvas.height);
  ctx.drawImage(glowCanvas, layer.x - pad, layer.y - pad);
}

export function renderDropShadow(
  ctx: CanvasRenderingContext2D,
  tempCanvas: HTMLCanvasElement,
  layer: Layer,
  data: ImageData,
  alloc: CanvasAllocator,
): void {
  if (!layer.effects.dropShadow.enabled) return;
  const shadow = layer.effects.dropShadow;
  const pad = shadow.blur * 2;
  const { canvas: shadowCanvas, ctx: shadowCtx } = alloc.acquire(data.width + pad * 2, data.height + pad * 2);
  if (shadow.spread > 0) {
    const spreadScale = 1 + (shadow.spread / Math.max(data.width, data.height)) * 2;
    const spreadOffsetX = pad + (data.width * (1 - spreadScale)) / 2;
    const spreadOffsetY = pad + (data.height * (1 - spreadScale)) / 2;
    shadowCtx.filter = `blur(${shadow.blur}px)`;
    shadowCtx.drawImage(tempCanvas, spreadOffsetX, spreadOffsetY, data.width * spreadScale, data.height * spreadScale);
  } else {
    shadowCtx.filter = `blur(${shadow.blur}px)`;
    shadowCtx.drawImage(tempCanvas, pad, pad);
  }
  shadowCtx.globalCompositeOperation = 'source-in';
  shadowCtx.filter = 'none';
  shadowCtx.fillStyle = `rgba(${shadow.color.r},${shadow.color.g},${shadow.color.b},${shadow.color.a})`;
  shadowCtx.fillRect(0, 0, shadowCanvas.width, shadowCanvas.height);
  ctx.drawImage(shadowCanvas, layer.x + shadow.offsetX - pad, layer.y + shadow.offsetY - pad);
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

export function renderInnerGlow(
  ctx: CanvasRenderingContext2D,
  tempCanvas: HTMLCanvasElement,
  layer: Layer,
  data: ImageData,
  alloc: CanvasAllocator,
): void {
  if (!layer.effects.innerGlow.enabled) return;
  const glow = layer.effects.innerGlow;
  const glowBlur = glow.size + glow.spread;
  const pad = glowBlur * 2;
  const cw = data.width + pad * 2;
  const ch = data.height + pad * 2;

  // Build an eroded version of the layer content
  const { canvas: erodeCanvas, ctx: erodeCtx } = alloc.acquire(cw, ch);
  erodeCtx.filter = `blur(${glowBlur}px)`;
  erodeCtx.drawImage(tempCanvas, pad, pad);
  erodeCtx.filter = 'none';
  erodeCtx.globalCompositeOperation = 'destination-in';
  erodeCtx.filter = `blur(${glowBlur}px)`;
  erodeCtx.drawImage(tempCanvas, pad, pad);
  erodeCtx.filter = 'none';

  // Start from original, subtract eroded to get inner border
  const { canvas: glowCanvas, ctx: glowCtx } = alloc.acquire(cw, ch);
  glowCtx.drawImage(tempCanvas, pad, pad);
  glowCtx.globalCompositeOperation = 'destination-out';
  glowCtx.drawImage(erodeCanvas, 0, 0);

  // Color the remaining inner fringe
  glowCtx.globalCompositeOperation = 'source-in';
  glowCtx.fillStyle = `rgba(${glow.color.r},${glow.color.g},${glow.color.b},${glow.opacity})`;
  glowCtx.fillRect(0, 0, cw, ch);

  ctx.drawImage(glowCanvas, layer.x - pad, layer.y - pad);
}

export function renderStroke(
  ctx: CanvasRenderingContext2D,
  _tempCanvas: HTMLCanvasElement,
  layer: Layer,
  data: ImageData,
  alloc: CanvasAllocator,
): void {
  if (!layer.effects.stroke.enabled) return;
  const stroke = layer.effects.stroke;
  const sw = stroke.width;
  const pad = sw + 1;

  // Build an alpha mask from the layer content
  const srcData = data.data;
  const w = data.width;
  const h = data.height;

  // Build a binary alpha mask (1 = opaque pixel)
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    alpha[i] = (srcData[i * 4 + 3] ?? 0) >= 128 ? 1 : 0;
  }

  // Compute distance fields using a two-pass 3-4 chamfer distance transform.
  const distInside = new Float32Array(w * h);
  const distOutside = new Float32Array(w * h);
  const INF = w + h;

  // 8-connected chamfer distance (3-4 weights approximate Euclidean distance)
  const D1 = 3; // cardinal cost
  const D2 = 4; // diagonal cost
  const SCALE = D1; // distances are scaled by D1

  for (let i = 0; i < w * h; i++) {
    distInside[i] = alpha[i] ? INF * D1 : 0;
    distOutside[i] = alpha[i] ? 0 : INF * D1;
  }

  // Forward pass (top-left to bottom-right)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (x > 0) {
        distInside[idx] = Math.min(distInside[idx]!, distInside[idx - 1]! + D1);
        distOutside[idx] = Math.min(distOutside[idx]!, distOutside[idx - 1]! + D1);
      }
      if (y > 0) {
        distInside[idx] = Math.min(distInside[idx]!, distInside[idx - w]! + D1);
        distOutside[idx] = Math.min(distOutside[idx]!, distOutside[idx - w]! + D1);
      }
      if (x > 0 && y > 0) {
        distInside[idx] = Math.min(distInside[idx]!, distInside[idx - w - 1]! + D2);
        distOutside[idx] = Math.min(distOutside[idx]!, distOutside[idx - w - 1]! + D2);
      }
      if (x < w - 1 && y > 0) {
        distInside[idx] = Math.min(distInside[idx]!, distInside[idx - w + 1]! + D2);
        distOutside[idx] = Math.min(distOutside[idx]!, distOutside[idx - w + 1]! + D2);
      }
    }
  }

  // Backward pass (bottom-right to top-left)
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const idx = y * w + x;
      if (x < w - 1) {
        distInside[idx] = Math.min(distInside[idx]!, distInside[idx + 1]! + D1);
        distOutside[idx] = Math.min(distOutside[idx]!, distOutside[idx + 1]! + D1);
      }
      if (y < h - 1) {
        distInside[idx] = Math.min(distInside[idx]!, distInside[idx + w]! + D1);
        distOutside[idx] = Math.min(distOutside[idx]!, distOutside[idx + w]! + D1);
      }
      if (x < w - 1 && y < h - 1) {
        distInside[idx] = Math.min(distInside[idx]!, distInside[idx + w + 1]! + D2);
        distOutside[idx] = Math.min(distOutside[idx]!, distOutside[idx + w + 1]! + D2);
      }
      if (x > 0 && y < h - 1) {
        distInside[idx] = Math.min(distInside[idx]!, distInside[idx + w - 1]! + D2);
        distOutside[idx] = Math.min(distOutside[idx]!, distOutside[idx + w - 1]! + D2);
      }
    }
  }

  // Build the stroke ImageData
  const outW = w + pad * 2;
  const outH = h + pad * 2;
  const { canvas: strokeCanvas, ctx: strokeCtx } = alloc.acquire(outW, outH);
  const strokeImg = strokeCtx.createImageData(outW, outH);
  const sd = strokeImg.data;
  const cr = stroke.color.r;
  const cg = stroke.color.g;
  const cb = stroke.color.b;
  const ca = Math.round(stroke.color.a * 255);
  const scaledW = sw * SCALE;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      let isStroke = false;

      if (stroke.position === 'outside') {
        isStroke = !alpha[idx] && distOutside[idx]! <= scaledW;
      } else if (stroke.position === 'inside') {
        isStroke = !!alpha[idx] && distInside[idx]! <= scaledW;
      } else {
        const halfW = scaledW / 2;
        isStroke =
          (!!alpha[idx] && distInside[idx]! <= halfW) ||
          (!alpha[idx] && distOutside[idx]! <= halfW);
      }

      if (isStroke) {
        const oi = ((y + pad) * outW + (x + pad)) * 4;
        sd[oi] = cr;
        sd[oi + 1] = cg;
        sd[oi + 2] = cb;
        sd[oi + 3] = ca;
      }
    }
  }

  strokeCtx.putImageData(strokeImg, 0, 0);
  ctx.drawImage(strokeCanvas, layer.x - pad, layer.y - pad);
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
