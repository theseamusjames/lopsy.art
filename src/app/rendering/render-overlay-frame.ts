import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { getBrushCursorInfo } from '../useCanvasCursor';
import { getEngine, getEngineCanvas } from '../../engine-wasm/engine-state';
import { renderGrid, renderPixelGrid, renderRulers } from './render-grid';
import { renderSelectionAnts, renderTransformHandles, renderMarqueeDraftAnts } from './render-selection';
import { getMarqueePreview } from '../../tools/marquee/marquee-preview';
import { createTransformState, type TransformState } from '../../tools/transform/transform';
import { renderMeshWarpOverlay } from './render-mesh-warp';
import { renderPathOverlay, renderLassoPreview, renderCropPreview, renderGradientPreview, renderBrushCursor, renderStampSourcePreview, renderSymmetryCenter, renderPerspectiveCropOverlay } from './render-overlays';
import { renderTextDragOverlay, renderTextEditOverlay, renderTextHoverBounds } from './render-text-overlay';
import { hitTestTextLayer } from '../../tools/text/text-hit-test';
import { renderGuides, renderGuidePreview, renderGuideRulerOverlays, renderGuideColorSwatch, renderSnapLines } from './render-guides';
import { renderTiltShiftOverlay } from './render-tilt-shift-overlay';
import { contextOptions } from '../../engine/color-space';
import { getLayerTextureDimensions, getGlyphPositions } from '../../engine-wasm/wasm-bridge';
import { PAINT_TOOLS } from '../../tools/tool-registry';
import type { TextLayer } from '../../types';

/**
 * Redraws the 2D overlay canvas (selection ants, cursors, guides, rulers,
 * tool previews) from current store state, without touching the GPU
 * compositor. The rAF loop uses this for animation-only frames (marching
 * ants, text cursor blink) so an idle selection doesn't force a full
 * recomposite of every layer at 60fps.
 */
export function renderOverlayFrame(overlayCanvas: HTMLCanvasElement, antPhase: number): void {
  const engine = getEngine();
  if (!engine) return;

  const editorState = useEditorStore.getState();
  const uiState = useUIStore.getState();
  const toolState = useToolSettingsStore.getState();

  const doc = editorState.document;
  const viewport = editorState.viewport;
  const layers = doc.layers;
  const selection = editorState.selection;

  const activeTool = uiState.activeTool;
  const cursorPosition = uiState.cursorPosition;
  const cursorOnCanvas = uiState.cursorOnCanvas;
  const showGrid = uiState.showGrid;
  const showPixelGrid = uiState.showPixelGrid;
  const showRulers = uiState.showRulers;
  const gridSize = uiState.gridSize;
  const pathAnchors = uiState.pathDraft?.anchors ?? [];
  const pathClosed = uiState.pathDraft?.closed ?? false;
  const lassoPoints = uiState.lassoPoints;
  const cropRect = uiState.cropRect;
  const perspectiveCropQuad = uiState.perspectiveCropQuad;
  const transform = uiState.transform;
  const gradientPreview = uiState.gradientPreview;
  const showGuides = uiState.showGuides;
  const guides = uiState.guides;
  const snapLines = uiState.snapLines;
  const selectedGuideId = uiState.selectedGuideId;
  const hoveredGuideId = uiState.hoveredGuideId;
  const rulerHover = uiState.rulerHover;
  const guideColor = uiState.guideColor;
  const textEditing = uiState.textEditing;

  const editingLayerIsPathText = textEditing
    && layers.some((l) => l.id === textEditing.layerId && l.type === 'text' && (l as TextLayer).pathId);

  const overlayCtx = overlayCanvas.getContext('2d', contextOptions);
  if (!overlayCtx) return;

  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  overlayCtx.save();
  overlayCtx.translate(viewport.panX + overlayCanvas.width / 2, viewport.panY + overlayCanvas.height / 2);
  overlayCtx.scale(viewport.zoom, viewport.zoom);
  overlayCtx.translate(-doc.width / 2, -doc.height / 2);

  if (showGrid) {
    renderGrid(overlayCtx, doc.width, doc.height, gridSize, viewport.zoom);
  }

  // A live marquee drag renders from its analytic preview (rect/ellipse, or a
  // translated copy of the committed selection) so it never builds or uploads
  // a mask mid-drag. The real selection is committed on pointer up.
  const marqueePreview = getMarqueePreview();
  if (marqueePreview) {
    if (marqueePreview.kind === 'move') {
      if (selection.active) {
        const moveTransform: TransformState = {
          ...createTransformState(selection.bounds),
          translateX: marqueePreview.dx,
          translateY: marqueePreview.dy,
        };
        renderSelectionAnts(overlayCtx, selection, viewport.zoom, antPhase, moveTransform);
      }
    } else {
      renderMarqueeDraftAnts(overlayCtx, marqueePreview.rect, marqueePreview.kind, viewport.zoom, antPhase);
    }
  } else {
    renderSelectionAnts(overlayCtx, selection, viewport.zoom, antPhase, transform);
    renderTransformHandles(overlayCtx, selection, transform, viewport.zoom);
  }

  const meshWarp = uiState.meshWarp;
  if (meshWarp) {
    renderMeshWarpOverlay(overlayCtx, meshWarp, viewport.zoom);
  }
  const tiltShift = uiState.tiltShift;
  if (tiltShift) {
    renderTiltShiftOverlay(overlayCtx, tiltShift, doc.width, doc.height, viewport.zoom);
  }
  const selectedPath = editorState.selectedPathId
    ? editorState.paths.find((p) => p.id === editorState.selectedPathId)
    : undefined;
  renderPathOverlay(overlayCtx, pathAnchors, pathClosed, layers, doc.activeLayerId, viewport.zoom, selectedPath?.anchors, selectedPath?.closed);
  renderLassoPreview(overlayCtx, lassoPoints, viewport.zoom);
  renderCropPreview(overlayCtx, cropRect, doc.width, doc.height, viewport.zoom);
  if (perspectiveCropQuad) {
    renderPerspectiveCropOverlay(overlayCtx, perspectiveCropQuad, viewport.zoom);
  }
  renderGradientPreview(overlayCtx, gradientPreview, viewport.zoom);

  // Text tool overlays
  const textDrag = uiState.textDrag;
  if (textDrag) {
    renderTextDragOverlay(overlayCtx, textDrag, viewport.zoom);
  }
  if (activeTool === 'text' && !textEditing && !textDrag) {
    const hoveredText = hitTestTextLayer(layers, cursorPosition);
    if (hoveredText) {
      const dims = getLayerTextureDimensions(engine, hoveredText.id);
      const texW = dims?.[0] ?? hoveredText.width ?? hoveredText.text.length * hoveredText.fontSize * 0.6;
      const texH = dims?.[1] ?? hoveredText.fontSize * hoveredText.lineHeight * (hoveredText.text.split('\n').length || 1);
      renderTextHoverBounds(overlayCtx, hoveredText, viewport.zoom, texW, texH);
    }
  }
  if (textEditing && !editingLayerIsPathText) {
    const text = toolState.settings.text;
    const glyphPositions = Array.from(getGlyphPositions(engine, textEditing.layerId)) as number[];
    renderTextEditOverlay(overlayCtx, textEditing, {
      fontSize: text.fontSize,
      fontFamily: text.fontFamily,
      fontWeight: text.fontWeight,
      fontStyle: text.fontStyle,
      color: toolState.foregroundColor,
      lineHeight: 1.4,
      letterSpacing: 0,
      textAlign: text.align,
    }, viewport.zoom, antPhase, glyphPositions);
  }

  const brushCursorInfo = getBrushCursorInfo(activeTool);
  if (brushCursorInfo !== null && cursorOnCanvas) {
    const size = activeTool === 'brush' ? toolState.settings.brush.size
      : activeTool === 'pencil' ? toolState.settings.pencil.size
      : activeTool === 'eraser' ? toolState.settings.eraser.size
      : activeTool === 'stamp' ? toolState.settings.stamp.size
      : activeTool === 'healing' ? toolState.settings.healing.size
      : activeTool === 'sponge' ? toolState.settings.sponge.size
      : brushCursorInfo.size;
    const isStampTool = activeTool === 'stamp' || activeTool === 'healing';
    const webglCanvas = getEngineCanvas();
    const showedPreview = isStampTool && webglCanvas && renderStampSourcePreview(
      overlayCtx, webglCanvas, cursorPosition, size, viewport,
      doc.width, doc.height, overlayCanvas.width, overlayCanvas.height,
    );
    if (!showedPreview) {
      renderBrushCursor(overlayCtx, cursorPosition, size, viewport.zoom, brushCursorInfo.shape, brushCursorInfo.tip, brushCursorInfo.angle);
    }
  }

  if (uiState.liquify && cursorOnCanvas) {
    renderBrushCursor(overlayCtx, cursorPosition, uiState.liquify.settings.brushSize, viewport.zoom, 'circle', null, 0);
  }

  renderSnapLines(overlayCtx, snapLines, doc.width, doc.height, viewport.zoom);

  if (showGuides) {
    renderGuides(overlayCtx, guides, selectedGuideId, doc.width, doc.height, viewport.zoom, guideColor);
    if (rulerHover && !hoveredGuideId) {
      renderGuidePreview(overlayCtx, rulerHover, doc.width, doc.height, viewport.zoom, guideColor);
    }
  }

  if (PAINT_TOOLS.has(activeTool) && (toolState.symmetryRadialSegments >= 2 || toolState.symmetryHorizontal || toolState.symmetryVertical)) {
    const symCenter = toolState.symmetryCenter ?? { x: doc.width / 2, y: doc.height / 2 };
    renderSymmetryCenter(overlayCtx, symCenter, viewport.zoom, guideColor);
  }

  overlayCtx.restore();

  if (showPixelGrid) {
    renderPixelGrid(overlayCtx, overlayCanvas.width, overlayCanvas.height, viewport, doc.width, doc.height);
  }

  if (showRulers) {
    renderRulers(overlayCtx, overlayCanvas.width, overlayCanvas.height, viewport, doc.width, doc.height, cursorPosition, guideColor);
    if (showGuides) {
      renderGuideRulerOverlays(overlayCtx, guides, selectedGuideId, hoveredGuideId, rulerHover, overlayCanvas.width, overlayCanvas.height, viewport, doc.width, doc.height, guideColor);
      renderGuideColorSwatch(overlayCtx, guideColor);
    }
  }
}
