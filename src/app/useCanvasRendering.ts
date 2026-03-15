import { useEffect, useRef, useState, type RefObject } from 'react';
import { useEditorStore } from './editor-store';
import { useUIStore } from './ui-store';
import { useToolSettingsStore } from './tool-settings-store';
import { getBrushCursorInfo } from './useCanvasCursor';
import { CanvasAllocator, applyColorOverlay, renderOuterGlow, renderDropShadow, renderInnerGlow, renderStroke } from '../engine/effects-renderer';
import { renderLayerContent } from './rendering/render-layers';
import { renderSelectionAnts, renderTransformHandles } from './rendering/render-selection';
import { renderPathOverlay, renderLassoPreview, renderCropPreview, renderGradientPreview, renderBrushCursor } from './rendering/render-overlays';
import { renderGrid, renderRulers } from './rendering/render-grid';
import { hasActiveAdjustments, applyAdjustmentsToImageData } from '../filters/image-adjustments';
import { contextOptions } from '../engine/color-space';
import { getCachedBitmap } from '../engine/bitmap-cache';
import { hasEnabledEffects } from '../layers/layer-model';
import {
  isGPUAccelerated,
  createGpuPipeline,
  destroyGpuPipeline,
  resizeGpuPipeline,
  getGpuSurfacePool,
  getRenderScheduler,
} from '../engine/renderer-registry';
import type { Layer } from '../types';

export { renderLayerContent } from './rendering/render-layers';

// Module-level allocator reused each frame (CPU path only)
const allocator = new CanvasAllocator();

// CPU composite cache
let cpuCompositeResult: HTMLCanvasElement | null = null;
let compositeVersion = -1;
let compositeKey = '';

// Checkerboard tile (CPU path only)
let checkerTile: HTMLCanvasElement | null = null;
function getCheckerTile(): HTMLCanvasElement {
  if (!checkerTile) {
    checkerTile = document.createElement('canvas');
    checkerTile.width = 16;
    checkerTile.height = 16;
    const tc = checkerTile.getContext('2d')!;
    tc.fillStyle = '#ffffff';
    tc.fillRect(0, 0, 16, 16);
    tc.fillStyle = '#cccccc';
    tc.fillRect(8, 0, 8, 8);
    tc.fillRect(0, 8, 8, 8);
  }
  return checkerTile;
}

function buildCompositeKey(layers: readonly Layer[], maskEditMode: boolean): string {
  let key = maskEditMode ? 'M' : '';
  for (const l of layers) {
    if (!l.visible) continue;
    key += `${l.id}:${l.opacity}:${l.blendMode}:${l.x}:${l.y}:${l.effects.dropShadow.enabled}:${l.effects.outerGlow.enabled}:${l.effects.innerGlow.enabled}:${l.effects.stroke.enabled}:${l.effects.colorOverlay.enabled}:${l.mask?.enabled ?? ''},`;
  }
  return key;
}

function cpuCompositeLayers(
  docWidth: number, docHeight: number,
  layers: readonly Layer[], pixelData: Map<string, ImageData>,
  maskEditMode: boolean, activeLayerId: string,
): HTMLCanvasElement {
  if (!cpuCompositeResult) cpuCompositeResult = document.createElement('canvas');
  cpuCompositeResult.width = docWidth;
  cpuCompositeResult.height = docHeight;
  const ctx = cpuCompositeResult.getContext('2d', contextOptions)!;

  allocator.releaseAll();
  for (const layer of layers) {
    if (!layer.visible) continue;
    const data = pixelData.get(layer.id);
    if (!data) continue;

    ctx.globalAlpha = layer.opacity;

    const hasMask = layer.mask?.enabled && !maskEditMode;
    const isMaskOverlay = maskEditMode && layer.mask && layer.id === activeLayerId;
    const bitmap = getCachedBitmap(layer.id);
    if (bitmap && !hasEnabledEffects(layer.effects) && !hasMask && !isMaskOverlay) {
      ctx.drawImage(bitmap, layer.x, layer.y);
      continue;
    }

    const { canvas: tempCanvas, ctx: tempCtx } = allocator.acquire(data.width, data.height);
    if (bitmap && !layer.effects.colorOverlay.enabled) {
      tempCtx.drawImage(bitmap, 0, 0);
    } else {
      tempCtx.putImageData(data, 0, 0);
    }

    if (layer.effects.colorOverlay.enabled) {
      const overlaid = tempCtx.getImageData(0, 0, data.width, data.height);
      applyColorOverlay(overlaid, layer);
      tempCtx.putImageData(overlaid, 0, 0);
    }

    renderOuterGlow(ctx, tempCanvas, layer, data, allocator);
    renderDropShadow(ctx, tempCanvas, layer, data, allocator);
    renderLayerContent(ctx, tempCanvas, layer, data, maskEditMode, activeLayerId, allocator);
    renderInnerGlow(ctx, tempCanvas, layer, data, allocator);
    renderStroke(ctx, tempCanvas, layer, data, allocator);
  }
  ctx.globalAlpha = 1;
  return cpuCompositeResult;
}

export function useCanvasRendering(
  documentCanvasRef: RefObject<HTMLCanvasElement | null>,
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>,
  containerRef: RefObject<HTMLDivElement | null>,
  gpuReady?: boolean,
): void {
  const doc = useEditorStore((s) => s.document);
  const viewport = useEditorStore((s) => s.viewport);
  const layers = useEditorStore((s) => s.document.layers);
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);
  const renderVersion = useEditorStore((s) => s.renderVersion);
  const documentReady = useEditorStore((s) => s.documentReady);
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
  const adjustments = useUIStore((s) => s.adjustments);
  const adjustmentsEnabled = useUIStore((s) => s.adjustmentsEnabled);
  const brushSize = useToolSettingsStore((s) => s.brushSize);
  const pencilSize = useToolSettingsStore((s) => s.pencilSize);
  const eraserSize = useToolSettingsStore((s) => s.eraserSize);
  const stampSize = useToolSettingsStore((s) => s.stampSize);

  const [antPhase, setAntPhase] = useState(0);
  const sizeRef = useRef({ w: 0, h: 0 });
  const gpuActiveRef = useRef(false);

  // Marching ants animation — throttled to ~15fps
  useEffect(() => {
    if (!selection.active) return;
    const id = setInterval(() => setAntPhase((p) => p + 1), 66);
    return () => clearInterval(id);
  }, [selection.active]);

  // --- GPU pipeline init + cleanup ---
  useEffect(() => {
    const canvas = documentCanvasRef.current;
    if (!canvas || !isGPUAccelerated()) return;

    const sched = createGpuPipeline(canvas);
    if (!sched) return;

    gpuActiveRef.current = true;

    // Frame input provider reads fresh state from stores on every RAF tick —
    // never captures stale React closure values.
    const pool = getGpuSurfacePool();
    sched.setFrameInputProvider(() => {
      const state = useEditorStore.getState();
      const uiState = useUIStore.getState();
      const { w: cw, h: ch } = sizeRef.current;
      return {
        viewport: state.viewport,
        docWidth: state.document.width,
        docHeight: state.document.height,
        canvasWidth: cw || canvas.width,
        canvasHeight: ch || canvas.height,
        layers: state.document.layers,
        pixelData: state.layerPixelData,
        pool: pool!,
        maskEditMode: uiState.maskEditMode,
        activeLayerId: state.document.activeLayerId ?? '',
      };
    });

    sched.start();

    return () => {
      gpuActiveRef.current = false;
      destroyGpuPipeline();
    };
    // Re-run when document is ready OR when GPU becomes available
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentReady, gpuReady]);

  // --- Resize observer ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let hasInitialFit = false;
    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w === 0 || h === 0) return;
      sizeRef.current = { w, h };

      // Size overlay canvas
      const overlay = overlayCanvasRef.current;
      if (overlay) {
        overlay.width = w;
        overlay.height = h;
      }

      if (gpuActiveRef.current) {
        // GPU path: resizeGpuPipeline sets canvas.width/height and recreates the surface
        resizeGpuPipeline(w, h);
        getRenderScheduler()?.markCompositeDirty();
      } else {
        // CPU path: set canvas dimensions directly
        const docCanvas = documentCanvasRef.current;
        if (docCanvas) {
          docCanvas.width = w;
          docCanvas.height = h;
        }
      }

      useEditorStore.getState().setViewportSize(w, h);
      if (!hasInitialFit) {
        hasInitialFit = true;
        useEditorStore.getState().fitToView();
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentReady]);

  // --- Document rendering effect ---
  useEffect(() => {
    let { w: cw, h: ch } = sizeRef.current;
    // Fallback: read canvas dimensions if sizeRef hasn't been set yet
    if (cw === 0 || ch === 0) {
      const canvas = documentCanvasRef.current;
      if (canvas) { cw = canvas.width; ch = canvas.height; }
    }
    if (cw === 0 || ch === 0) return;

    // --- GPU path: just mark dirty — frame input provider reads fresh state ---
    if (gpuActiveRef.current) {
      getRenderScheduler()?.markCompositeDirty();
      return;
    }

    // --- CPU fallback path: render document canvas directly ---
    const docCanvas = documentCanvasRef.current;
    if (!docCanvas) return;

    const ctx = docCanvas.getContext('2d', contextOptions);
    if (!ctx) return;

    if (docCanvas.width !== cw || docCanvas.height !== ch) {
      docCanvas.width = cw;
      docCanvas.height = ch;
    }

    const pixelData = useEditorStore.getState().layerPixelData;
    const key = buildCompositeKey(layers, maskEditMode);
    const needsRecomposite = renderVersion !== compositeVersion || key !== compositeKey;

    ctx.fillStyle = '#3c3c3c';
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(viewport.panX + cw / 2, viewport.panY + ch / 2);
    ctx.scale(viewport.zoom, viewport.zoom);
    ctx.translate(-doc.width / 2, -doc.height / 2);

    const pattern = ctx.createPattern(getCheckerTile(), 'repeat');
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, doc.width, doc.height);
    }

    if (needsRecomposite) {
      cpuCompositeLayers(doc.width, doc.height, layers, pixelData, maskEditMode, activeLayerId ?? '');
      compositeVersion = renderVersion;
      compositeKey = key;
    }
    if (cpuCompositeResult) {
      ctx.drawImage(cpuCompositeResult, 0, 0);
    }

    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 1 / viewport.zoom;
    ctx.strokeRect(0, 0, doc.width, doc.height);
    ctx.restore();

    if (adjustmentsEnabled && hasActiveAdjustments(adjustments)) {
      const dx = viewport.panX + cw / 2 - (doc.width / 2) * viewport.zoom;
      const dy = viewport.panY + ch / 2 - (doc.height / 2) * viewport.zoom;
      const sx = Math.max(0, Math.floor(dx));
      const sy = Math.max(0, Math.floor(dy));
      const ex = Math.min(cw, Math.ceil(dx + doc.width * viewport.zoom));
      const ey = Math.min(ch, Math.ceil(dy + doc.height * viewport.zoom));
      const sw = ex - sx;
      const sh = ey - sy;
      if (sw > 0 && sh > 0) {
        const imgData = ctx.getImageData(sx, sy, sw, sh);
        applyAdjustmentsToImageData(imgData, adjustments);
        ctx.putImageData(imgData, sx, sy);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, viewport, layers, renderVersion, maskEditMode, activeLayerId, adjustments, adjustmentsEnabled, gpuReady]);

  // --- Overlay rendering effect ---
  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;

    const { w: cw, h: ch } = sizeRef.current;
    if (cw === 0 || ch === 0) return;

    if (overlay.width !== cw || overlay.height !== ch) {
      overlay.width = cw;
      overlay.height = ch;
    }

    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(viewport.panX + cw / 2, viewport.panY + ch / 2);
    ctx.scale(viewport.zoom, viewport.zoom);
    ctx.translate(-doc.width / 2, -doc.height / 2);

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
      renderRulers(ctx, cw, ch, viewport, doc.width, doc.height, cursorPosition);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, viewport, selection, antPhase, pathAnchors, lassoPoints, cropRect, transform, gradientPreview, activeTool, cursorPosition, brushSize, pencilSize, eraserSize, stampSize, showGrid, showRulers, gridSize, layers, maskEditMode, activeLayerId]);
}
