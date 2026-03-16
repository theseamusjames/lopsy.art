import { useEffect, useRef, type RefObject } from 'react';
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
import { getCachedBitmap, getPaintingCanvas } from '../engine/bitmap-cache';
import { sparseToImageData } from '../engine/canvas-ops';
import { hasEnabledEffects } from '../layers/layer-model';

// Pre-rendered checkerboard pattern — avoids ~190K fillRect calls per frame on 4K
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

export { renderLayerContent } from './rendering/render-layers';

// Module-level allocator reused each frame
const allocator = new CanvasAllocator();

/**
 * Render loop driven by requestAnimationFrame, NOT by React effects.
 * Reads all state directly from Zustand stores inside the rAF callback.
 * This avoids the problem where rapid React re-renders cancel/reschedule
 * rAF callbacks, causing visible lag during sustained painting.
 */
function renderFrame(
  canvas: HTMLCanvasElement,
  container: HTMLDivElement,
  antPhaseRef: { current: number },
): void {
  const ctx = canvas.getContext('2d', contextOptions);
  if (!ctx) return;

  const rect = container.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  // Read all state from stores
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
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw document area
  ctx.save();
  ctx.translate(viewport.panX + canvas.width / 2, viewport.panY + canvas.height / 2);
  ctx.scale(viewport.zoom, viewport.zoom);
  ctx.translate(-doc.width / 2, -doc.height / 2);

  // Checkerboard for transparency — single fillRect with a repeating pattern
  const pattern = getCheckerPattern(ctx);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, doc.width, doc.height);

  // Draw layer pixel data (using canvas pool to avoid per-frame allocations)
  allocator.releaseAll();
  for (const layer of layers) {
    if (!layer.visible) continue;
    let data = pixelData.get(layer.id);

    // For sparse layers with no ImageData, try bitmap cache first (common case).
    // If no bitmap yet, expand sparse data to a temporary ImageData for rendering.
    const sparseEntry = !data ? sparseData.get(layer.id) : undefined;
    if (!data && !sparseEntry) continue;

    ctx.globalAlpha = layer.opacity;

    // Fast path: draw cached ImageBitmap directly for layers with no
    // effects or masks.
    const hasMask = layer.mask?.enabled && !maskEditMode;
    const isMaskOverlay = maskEditMode && layer.mask && layer.id === activeLayerId;
    const bitmap = getCachedBitmap(layer.id);
    if (bitmap && !hasEnabledEffects(layer.effects) && !hasMask && !isMaskOverlay) {
      ctx.drawImage(bitmap, layer.x, layer.y);
      continue;
    }

    // Sparse layer without bitmap — expand temporarily for this frame
    if (!data && sparseEntry) {
      data = sparseToImageData(sparseEntry.sparse);
    }
    if (!data) continue;

    // Fast path: during painting, use the persistent painting canvas
    // which only updates the dirty region instead of full putImageData.
    const paintCanvas = getPaintingCanvas(layer.id, data);
    const { canvas: tempCanvas, ctx: tempCtx } = paintCanvas
      ? { canvas: paintCanvas, ctx: paintCanvas.getContext('2d', contextOptions)! }
      : allocator.acquire(data.width, data.height);

    if (!paintCanvas) {
      if (bitmap && !layer.effects.colorOverlay.enabled) {
        tempCtx.drawImage(bitmap, 0, 0);
      } else {
        tempCtx.putImageData(data, 0, 0);
      }
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

  // Post-composite image adjustments
  if (adjustmentsEnabled && hasActiveAdjustments(adjustments)) {
    const dx = viewport.panX + canvas.width / 2 - (doc.width / 2) * viewport.zoom;
    const dy = viewport.panY + canvas.height / 2 - (doc.height / 2) * viewport.zoom;
    const sx = Math.max(0, Math.floor(dx));
    const sy = Math.max(0, Math.floor(dy));
    const ex = Math.min(canvas.width, Math.ceil(dx + doc.width * viewport.zoom));
    const ey = Math.min(canvas.height, Math.ceil(dy + doc.height * viewport.zoom));
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
    renderRulers(ctx, canvas.width, canvas.height, viewport, doc.width, doc.height, cursorPosition);
  }
}

export function useCanvasRendering(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  containerRef: RefObject<HTMLDivElement | null>,
): void {
  const dirtyRef = useRef(true);
  const antPhaseRef = useRef(0);

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

      if (dirtyRef.current) {
        dirtyRef.current = false;
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (canvas && container) {
          renderFrame(canvas, container, antPhaseRef);
        }
      }

      antAnimId = requestAnimationFrame(loop);
    };

    antAnimId = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(antAnimId);
    };
  }, [canvasRef, containerRef]);
}
