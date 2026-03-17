import { useEffect, useRef, type RefObject } from 'react';
import { useEditorStore } from './editor-store';
import { useUIStore } from './ui-store';
import { useToolSettingsStore } from './tool-settings-store';
import { getBrushCursorInfo } from './useCanvasCursor';
import { initEngine, getEngine, destroyEngine } from '../engine-wasm/engine-state';
import {
  syncDocumentSize,
  syncBackgroundColor,
  syncViewport,
  syncLayers,
  syncSelection,
  syncGrid,
  syncRulers,
  syncAdjustments,
  renderEngine,
  resetTrackedState,
  markAllLayersDirty,
} from '../engine-wasm/engine-sync';
import { renderGrid, renderRulers } from './rendering/render-grid';
import { renderSelectionAnts, renderTransformHandles } from './rendering/render-selection';
import { renderPathOverlay, renderLassoPreview, renderCropPreview, renderGradientPreview, renderBrushCursor } from './rendering/render-overlays';
import { renderLayerContent } from './rendering/render-layers';
import { CanvasAllocator, applyColorOverlay, renderOuterGlow, renderDropShadow, renderInnerGlow, renderStroke } from '../engine/effects-renderer';
import { contextOptions } from '../engine/color-space';
import { hasEnabledEffects } from '../layers/layer-model';
import { getCachedBitmap, getPaintingCanvas } from '../engine/bitmap-cache';
import { sparseToImageData } from '../engine/canvas-ops';
import { hasActiveAdjustments, applyAdjustmentsToImageData } from '../filters/image-adjustments';

export { renderLayerContent } from './rendering/render-layers';

// Pre-rendered checkerboard pattern for CPU fallback path
let checkerPattern: CanvasPattern | null = null;
function getCheckerPattern(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (!checkerPattern) {
    const tile = document.createElement('canvas');
    tile.width = 16;
    tile.height = 16;
    const tCtx = tile.getContext('2d')!;
    tCtx.fillStyle = '#ffffff';
    tCtx.fillRect(0, 0, 16, 16);
    tCtx.fillStyle = '#cccccc';
    tCtx.fillRect(8, 0, 8, 8);
    tCtx.fillRect(0, 8, 8, 8);
    checkerPattern = ctx.createPattern(tile, 'repeat');
  }
  return checkerPattern!;
}

// Module-level allocator reused each frame (CPU path)
const cpuAllocator = new CanvasAllocator();

/**
 * Check if any visible layer has effects enabled.
 * When effects are present, we fall back to CPU compositing because
 * the WASM engine doesn't implement GPU effects yet.
 */
function anyLayerHasEffects(layers: readonly import('../types').Layer[]): boolean {
  return layers.some((l) => l.visible && hasEnabledEffects(l.effects));
}

/**
 * CPU fallback render path — used when layers have effects.
 * This is the original Canvas 2D compositing pipeline that handles
 * effects (glow, shadow, stroke, color overlay) and masks correctly.
 */
function renderFrameCpu(
  overlayCanvas: HTMLCanvasElement,
  container: HTMLDivElement,
  antPhaseRef: { current: number },
): void {
  // When effects are active, render everything on the overlay canvas
  // (the WebGL canvas underneath will be hidden by the opaque overlay)
  const ctx = overlayCanvas.getContext('2d', contextOptions);
  if (!ctx) return;

  const rect = container.getBoundingClientRect();
  if (overlayCanvas.width !== rect.width || overlayCanvas.height !== rect.height) {
    overlayCanvas.width = rect.width;
    overlayCanvas.height = rect.height;
  }

  const editorState = useEditorStore.getState();
  const uiState = useUIStore.getState();
  const toolState = useToolSettingsStore.getState();

  const doc = editorState.document;
  const viewport = editorState.viewport;
  const layers = doc.layers;
  const activeLayerId = doc.activeLayerId;
  const selection = editorState.selection;
  const pixelData = editorState.layerPixelData;
  const sparseData = editorState.sparseLayerData;

  const maskEditMode = uiState.maskEditMode;
  const activeTool = uiState.activeTool;
  const cursorPosition = uiState.cursorPosition;
  const showGrid = uiState.showGrid;
  const showRulers = uiState.showRulers;
  const gridSize = uiState.gridSize;
  const adjustments = uiState.adjustments;
  const adjustmentsEnabled = uiState.adjustmentsEnabled;
  const pathAnchors = uiState.pathAnchors;
  const lassoPoints = uiState.lassoPoints;
  const cropRect = uiState.cropRect;
  const transform = uiState.transform;
  const gradientPreview = uiState.gradientPreview;

  // Clear
  ctx.fillStyle = '#3c3c3c';
  ctx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  ctx.save();
  ctx.translate(viewport.panX + overlayCanvas.width / 2, viewport.panY + overlayCanvas.height / 2);
  ctx.scale(viewport.zoom, viewport.zoom);
  ctx.translate(-doc.width / 2, -doc.height / 2);

  // Checkerboard
  const pattern = getCheckerPattern(ctx);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, doc.width, doc.height);

  // Composite layers with effects
  cpuAllocator.releaseAll();
  for (const layer of layers) {
    if (!layer.visible) continue;
    let data = pixelData.get(layer.id);
    const sparseEntry = !data ? sparseData.get(layer.id) : undefined;
    if (!data && !sparseEntry) continue;

    // Reset composite state for each layer — prevents bleed from effects code
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = 'source-over';

    const hasMask = layer.mask?.enabled && !maskEditMode;
    const isMaskOverlay = maskEditMode && layer.mask && layer.id === activeLayerId;
    const hasEffects = hasEnabledEffects(layer.effects);

    // Fast path: layers without effects/masks can use bitmap cache directly
    if (!hasEffects && !hasMask && !isMaskOverlay) {
      const bitmap = getCachedBitmap(layer.id);
      if (bitmap) {
        ctx.drawImage(bitmap, layer.x, layer.y);
        continue;
      }
    }

    if (!data && sparseEntry) {
      data = sparseToImageData(sparseEntry.sparse);
    }
    if (!data) continue;

    // For layers with effects: ALWAYS use putImageData to ensure tempCanvas
    // content matches `data` exactly. The bitmap cache can be stale (wrong
    // size, from before crop, async rebuild not complete).
    const paintCanvas = hasEffects ? null : getPaintingCanvas(layer.id, data);
    const { canvas: tempCanvas, ctx: tempCtx } = paintCanvas
      ? { canvas: paintCanvas, ctx: paintCanvas.getContext('2d', contextOptions)! }
      : cpuAllocator.acquire(data.width, data.height);

    if (!paintCanvas) {
      tempCtx.putImageData(data, 0, 0);
    }

    if (layer.effects.colorOverlay.enabled) {
      const overlaid = tempCtx.getImageData(0, 0, data.width, data.height);
      applyColorOverlay(overlaid, layer);
      tempCtx.putImageData(overlaid, 0, 0);
    }

    renderOuterGlow(ctx, tempCanvas, layer, data, cpuAllocator);
    renderDropShadow(ctx, tempCanvas, layer, data, cpuAllocator);
    renderLayerContent(ctx, tempCanvas, layer, data, maskEditMode, activeLayerId, cpuAllocator);
    renderInnerGlow(ctx, tempCanvas, layer, data, cpuAllocator);
    renderStroke(ctx, tempCanvas, layer, data, cpuAllocator);
  }

  ctx.globalAlpha = 1;

  // Post-composite adjustments
  if (adjustmentsEnabled && hasActiveAdjustments(adjustments)) {
    const cw = overlayCanvas.width;
    const ch = overlayCanvas.height;
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

  // Document border
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 1 / viewport.zoom;
  ctx.strokeRect(0, 0, doc.width, doc.height);

  if (showGrid) {
    renderGrid(ctx, doc.width, doc.height, gridSize, viewport.zoom);
  }

  renderSelectionAnts(ctx, selection, viewport.zoom, antPhaseRef.current);
  renderTransformHandles(ctx, selection, transform, viewport.zoom);
  renderPathOverlay(ctx, pathAnchors, layers, doc.activeLayerId, viewport.zoom);
  renderLassoPreview(ctx, lassoPoints, viewport.zoom);
  renderCropPreview(ctx, cropRect, doc.width, doc.height, viewport.zoom);
  renderGradientPreview(ctx, gradientPreview, viewport.zoom);

  const brushCursor = getBrushCursorInfo(activeTool);
  if (brushCursor !== null) {
    const size = activeTool === 'brush' ? toolState.brushSize
      : activeTool === 'pencil' ? toolState.pencilSize
      : activeTool === 'eraser' ? toolState.eraserSize
      : activeTool === 'stamp' ? toolState.stampSize
      : brushCursor.size;
    renderBrushCursor(ctx, cursorPosition, size, viewport.zoom, brushCursor.shape);
  }

  ctx.restore();

  if (showRulers) {
    renderRulers(ctx, overlayCanvas.width, overlayCanvas.height, viewport, doc.width, doc.height, cursorPosition);
  }
}

/**
 * GPU render path — used when no effects are active.
 * The WASM engine handles all compositing on the GPU.
 */
function renderFrameGpu(
  overlayCanvas: HTMLCanvasElement,
  container: HTMLDivElement,
  antPhaseRef: { current: number },
): void {
  const engine = getEngine();
  if (!engine) return;

  const rect = container.getBoundingClientRect();
  const screenW = rect.width;
  const screenH = rect.height;

  if (overlayCanvas.width !== screenW || overlayCanvas.height !== screenH) {
    overlayCanvas.width = screenW;
    overlayCanvas.height = screenH;
  }

  const editorState = useEditorStore.getState();
  const uiState = useUIStore.getState();
  const toolState = useToolSettingsStore.getState();

  const doc = editorState.document;
  const viewport = editorState.viewport;
  const layers = doc.layers;
  const selection = editorState.selection;
  const pixelData = editorState.layerPixelData;
  const sparseData = editorState.sparseLayerData;
  const dirtyLayerIds = editorState.dirtyLayerIds;

  const activeTool = uiState.activeTool;
  const cursorPosition = uiState.cursorPosition;
  const showGrid = uiState.showGrid;
  const showRulers = uiState.showRulers;
  const gridSize = uiState.gridSize;
  const adjustments = uiState.adjustments;
  const adjustmentsEnabled = uiState.adjustmentsEnabled;
  const pathAnchors = uiState.pathAnchors;
  const lassoPoints = uiState.lassoPoints;
  const cropRect = uiState.cropRect;
  const transform = uiState.transform;
  const gradientPreview = uiState.gradientPreview;

  syncDocumentSize(engine, doc.width, doc.height);
  syncBackgroundColor(engine, doc.backgroundColor.r, doc.backgroundColor.g, doc.backgroundColor.b, doc.backgroundColor.a);
  syncViewport(engine, viewport.zoom, viewport.panX, viewport.panY, screenW, screenH);
  syncLayers(engine, layers, pixelData, sparseData, dirtyLayerIds);
  syncSelection(engine, selection);
  syncGrid(engine, showGrid, gridSize);
  syncRulers(engine, showRulers);
  syncAdjustments(engine, adjustments, adjustmentsEnabled);

  renderEngine(engine);

  // Overlay canvas: selection ants, cursors, guides, rulers
  const overlayCtx = overlayCanvas.getContext('2d', contextOptions);
  if (overlayCtx) {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    overlayCtx.save();
    overlayCtx.translate(viewport.panX + overlayCanvas.width / 2, viewport.panY + overlayCanvas.height / 2);
    overlayCtx.scale(viewport.zoom, viewport.zoom);
    overlayCtx.translate(-doc.width / 2, -doc.height / 2);

    if (showGrid) {
      renderGrid(overlayCtx, doc.width, doc.height, gridSize, viewport.zoom);
    }

    renderSelectionAnts(overlayCtx, selection, viewport.zoom, antPhaseRef.current);
    renderTransformHandles(overlayCtx, selection, transform, viewport.zoom);
    renderPathOverlay(overlayCtx, pathAnchors, layers, doc.activeLayerId, viewport.zoom);
    renderLassoPreview(overlayCtx, lassoPoints, viewport.zoom);
    renderCropPreview(overlayCtx, cropRect, doc.width, doc.height, viewport.zoom);
    renderGradientPreview(overlayCtx, gradientPreview, viewport.zoom);

    const brushCursorInfo = getBrushCursorInfo(activeTool);
    if (brushCursorInfo !== null) {
      const size = activeTool === 'brush' ? toolState.brushSize
        : activeTool === 'pencil' ? toolState.pencilSize
        : activeTool === 'eraser' ? toolState.eraserSize
        : activeTool === 'stamp' ? toolState.stampSize
        : brushCursorInfo.size;
      renderBrushCursor(overlayCtx, cursorPosition, size, viewport.zoom, brushCursorInfo.shape);
    }

    overlayCtx.restore();

    if (showRulers) {
      renderRulers(overlayCtx, overlayCanvas.width, overlayCanvas.height, viewport, doc.width, doc.height, cursorPosition);
    }
  }
}

/**
 * Main render frame dispatcher.
 * Uses GPU path when no effects active, CPU fallback when effects are present.
 */
function renderFrame(
  overlayCanvas: HTMLCanvasElement,
  container: HTMLDivElement,
  antPhaseRef: { current: number },
): void {
  const layers = useEditorStore.getState().document.layers;

  if (anyLayerHasEffects(layers)) {
    // CPU path: render everything on the overlay canvas (opaque, hides WebGL canvas)
    renderFrameCpu(overlayCanvas, container, antPhaseRef);
  } else {
    // GPU path: render layers on WebGL canvas, overlays on overlay canvas (transparent)
    renderFrameGpu(overlayCanvas, container, antPhaseRef);
  }
}

export function useCanvasRendering(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  containerRef: RefObject<HTMLDivElement | null>,
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>,
): void {
  const dirtyRef = useRef(true);
  const engineReadyRef = useRef(false);
  const antPhaseRef = useRef(0);

  // Initialize WASM engine on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    initEngine(canvas).then((engine) => {
      if (cancelled) {
        destroyEngine();
        return;
      }
      engineReadyRef.current = true;
      dirtyRef.current = true;
      // Force initial full sync
      markAllLayersDirty(engine);
    });

    return () => {
      cancelled = true;
      engineReadyRef.current = false;
      destroyEngine();
      resetTrackedState();
    };
  }, [canvasRef]);

  // Subscribe to all three stores — mark dirty on any change
  useEffect(() => {
    const markDirty = () => { dirtyRef.current = true; };
    const unsub1 = useEditorStore.subscribe(markDirty);
    const unsub2 = useUIStore.subscribe(markDirty);
    const unsub3 = useToolSettingsStore.subscribe(markDirty);
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  // Persistent rAF loop — runs independently of React renders.
  // Only does work when the dirty flag is set.
  useEffect(() => {
    let running = true;
    let antAnimId = 0;
    let selectionActive = false;

    const loop = () => {
      if (!running) return;

      // Check if selection ants need animating
      const sel = useEditorStore.getState().selection;
      if (sel.active && !selectionActive) {
        selectionActive = true;
        dirtyRef.current = true;
      } else if (!sel.active && selectionActive) {
        selectionActive = false;
      }
      if (selectionActive) {
        antPhaseRef.current++;
        dirtyRef.current = true;
      }

      if (dirtyRef.current && engineReadyRef.current) {
        dirtyRef.current = false;
        const overlay = overlayCanvasRef.current;
        const container = containerRef.current;
        if (overlay && container) {
          renderFrame(overlay, container, antPhaseRef);
        }
      }

      antAnimId = requestAnimationFrame(loop);
    };

    antAnimId = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(antAnimId);
    };
  }, [canvasRef, containerRef, overlayCanvasRef]);
}
