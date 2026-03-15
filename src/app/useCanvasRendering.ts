import { useEffect, useRef, useState, type RefObject } from 'react';
import { useEditorStore } from './editor-store';
import { useUIStore } from './ui-store';
import { useToolSettingsStore } from './tool-settings-store';
import { getBrushCursorInfo } from './useCanvasCursor';
import { CanvasAllocator, renderOuterGlow, renderDropShadow, renderInnerGlow, renderStroke } from '../engine/effects-renderer';
import { renderLayerContent } from './rendering/render-layers';
import { renderSelectionAnts, renderTransformHandles } from './rendering/render-selection';
import { renderPathOverlay, renderLassoPreview, renderCropPreview, renderGradientPreview, renderBrushCursor } from './rendering/render-overlays';
import { renderGrid, renderRulers } from './rendering/render-grid';

export { renderLayerContent } from './rendering/render-layers';

// Module-level allocator reused each frame
const allocator = new CanvasAllocator();

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
