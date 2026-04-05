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
  syncMaskEditMode,
  syncBrushTip,
  renderEngine,
  resetTrackedState,
  markAllLayersDirty,
} from '../engine-wasm/engine-sync';
import { renderGrid, renderRulers } from './rendering/render-grid';
import { renderSelectionAnts, renderTransformHandles } from './rendering/render-selection';
import { renderPathOverlay, renderLassoPreview, renderCropPreview, renderGradientPreview, renderBrushCursor } from './rendering/render-overlays';
import { renderTextDragOverlay, renderTextEditOverlay } from './rendering/render-text-overlay';
import { renderTextToCanvas } from '../tools/text/text';
import type { TextStyle } from '../tools/text/text';
import { uploadLayerPixels } from '../engine-wasm/wasm-bridge';
import { renderGuides, renderGuidePreview, renderGuideRulerOverlays, renderGuideColorSwatch } from './rendering/render-guides';
import { contextOptions } from '../engine/color-space';
import { clearFrameCache } from '../engine-wasm/gpu-pixel-access';
import { getActiveMaskEditBuffer } from './interactions/mask-buffer';
import { uploadLayerMask } from '../engine-wasm/wasm-bridge';

export { renderLayerContent } from './rendering/render-layers';


/**
 * GPU render path — the WASM engine handles all compositing including effects.
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
  // Read adjustments from the root group (per-group effects)
  const rootGroupId = doc.rootGroupId;
  const rootGroup = rootGroupId ? layers.find((l) => l.id === rootGroupId && l.type === 'group') : null;
  const adjustments = (rootGroup && 'adjustments' in rootGroup) ? rootGroup.adjustments : uiState.adjustments;
  const adjustmentsEnabled = (rootGroup && 'adjustmentsEnabled' in rootGroup) ? rootGroup.adjustmentsEnabled : uiState.adjustmentsEnabled;
  const pathAnchors = uiState.pathAnchors;
  const pathClosed = uiState.pathClosed;
  const lassoPoints = uiState.lassoPoints;
  const cropRect = uiState.cropRect;
  const transform = uiState.transform;
  const gradientPreview = uiState.gradientPreview;
  const showGuides = uiState.showGuides;
  const guides = uiState.guides;
  const selectedGuideId = uiState.selectedGuideId;
  const hoveredGuideId = uiState.hoveredGuideId;
  const rulerHover = uiState.rulerHover;
  const guideColor = uiState.guideColor;

  // Live-update text layer pixels during editing so the GPU preview
  // matches the committed result exactly (same pipeline).
  const textEditing = uiState.textEditing;
  if (textEditing && textEditing.text.length > 0) {
    const ts = toolState;
    const textStyle: TextStyle = {
      fontSize: ts.textFontSize,
      fontFamily: ts.textFontFamily,
      fontWeight: ts.textFontWeight,
      fontStyle: ts.textFontStyle,
      color: uiState.foregroundColor,
      lineHeight: 1.4,
      letterSpacing: 0,
      textAlign: ts.textAlign,
    };
    const textCanvas = renderTextToCanvas(
      doc.width, doc.height,
      { x: 0, y: 0 },
      textEditing.text,
      textStyle,
      textEditing.bounds.width,
    );
    const textCtx = textCanvas.getContext('2d');
    if (textCtx) {
      const imgData = textCtx.getImageData(0, 0, doc.width, doc.height);
      const rawBytes = new Uint8Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength);
      const layer = layers.find((l) => l.id === textEditing.layerId);
      uploadLayerPixels(engine, textEditing.layerId, rawBytes, doc.width, doc.height, layer?.x ?? 0, layer?.y ?? 0);
    }
  }

  syncDocumentSize(engine, doc.width, doc.height);
  syncBackgroundColor(engine, doc.backgroundColor.r, doc.backgroundColor.g, doc.backgroundColor.b, doc.backgroundColor.a);
  syncViewport(engine, viewport.zoom, viewport.panX, viewport.panY, screenW, screenH);
  syncLayers(engine, layers, pixelData, sparseData, dirtyLayerIds);
  syncSelection(engine, selection);
  syncGrid(engine, showGrid, gridSize);
  syncRulers(engine, showRulers);
  syncAdjustments(engine, adjustments, adjustmentsEnabled);
  syncMaskEditMode(engine, uiState.maskEditMode, doc.activeLayerId);
  syncBrushTip(engine, toolState.activeBrushTip, toolState.brushAngle * Math.PI / 180);

  // Upload in-progress mask edit buffer to GPU so the overlay updates live
  if (uiState.maskEditMode) {
    const maskBuf = getActiveMaskEditBuffer();
    if (maskBuf) {
      const raw = maskBuf.buf.rawData;
      const maskGray = new Uint8Array(maskBuf.maskWidth * maskBuf.maskHeight);
      for (let i = 0; i < maskGray.length; i++) {
        maskGray[i] = raw[i * 4] ?? 0;
      }
      uploadLayerMask(engine, maskBuf.layerId, maskGray, maskBuf.maskWidth, maskBuf.maskHeight);
    }
  }

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
    const selectedPath = editorState.selectedPathId
      ? editorState.paths.find((p) => p.id === editorState.selectedPathId)
      : undefined;
    renderPathOverlay(overlayCtx, pathAnchors, pathClosed, layers, doc.activeLayerId, viewport.zoom, selectedPath?.anchors, selectedPath?.closed);
    renderLassoPreview(overlayCtx, lassoPoints, viewport.zoom);
    renderCropPreview(overlayCtx, cropRect, doc.width, doc.height, viewport.zoom);
    renderGradientPreview(overlayCtx, gradientPreview, viewport.zoom);

    // Text tool overlays
    const textDrag = uiState.textDrag;
    if (textDrag) {
      renderTextDragOverlay(overlayCtx, textDrag, viewport.zoom);
    }
    if (textEditing) {
      const ts = toolState;
      renderTextEditOverlay(overlayCtx, textEditing, {
        fontSize: ts.textFontSize,
        fontFamily: ts.textFontFamily,
        fontWeight: ts.textFontWeight,
        fontStyle: ts.textFontStyle,
        color: uiState.foregroundColor,
        lineHeight: 1.4,
        letterSpacing: 0,
        textAlign: ts.textAlign,
      }, viewport.zoom, antPhaseRef.current);
    }

    const brushCursorInfo = getBrushCursorInfo(activeTool);
    if (brushCursorInfo !== null) {
      const size = activeTool === 'brush' ? toolState.brushSize
        : activeTool === 'pencil' ? toolState.pencilSize
        : activeTool === 'eraser' ? toolState.eraserSize
        : activeTool === 'stamp' ? toolState.stampSize
        : brushCursorInfo.size;
      renderBrushCursor(overlayCtx, cursorPosition, size, viewport.zoom, brushCursorInfo.shape);
    }

    if (showGuides) {
      renderGuides(overlayCtx, guides, selectedGuideId, doc.width, doc.height, viewport.zoom, guideColor);
      if (rulerHover && !hoveredGuideId) {
        renderGuidePreview(overlayCtx, rulerHover, doc.width, doc.height, viewport.zoom, guideColor);
      }
    }

    overlayCtx.restore();

    if (showRulers) {
      renderRulers(overlayCtx, overlayCanvas.width, overlayCanvas.height, viewport, doc.width, doc.height, cursorPosition, guideColor);
      if (showGuides) {
        renderGuideRulerOverlays(overlayCtx, guides, selectedGuideId, hoveredGuideId, rulerHover, overlayCanvas.width, overlayCanvas.height, viewport, doc.width, doc.height, guideColor);
        renderGuideColorSwatch(overlayCtx, guideColor);
      }
    }
  }
}

/**
 * Main render frame — always GPU. Effects are handled by the compositor.
 */
function renderFrame(
  overlayCanvas: HTMLCanvasElement,
  container: HTMLDivElement,
  antPhaseRef: { current: number },
): void {
  clearFrameCache();
  renderFrameGpu(overlayCanvas, container, antPhaseRef);
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

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      console.error('[Lopsy] WebGL context lost');
      engineReadyRef.current = false;
    };
    const handleContextRestored = () => {
      console.warn('[Lopsy] WebGL context restored — reinitializing');
      initEngine(canvas).then((engine) => {
        engineReadyRef.current = true;
        dirtyRef.current = true;
        markAllLayersDirty(engine);
      });
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

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
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
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

      // Check if selection ants or text cursor need animating
      const sel = useEditorStore.getState().selection;
      const hasTextEditing = useUIStore.getState().textEditing !== null;
      if (sel.active && !selectionActive) {
        selectionActive = true;
        dirtyRef.current = true;
      } else if (!sel.active && selectionActive) {
        selectionActive = false;
      }
      if (selectionActive || hasTextEditing) {
        antPhaseRef.current++;
        dirtyRef.current = true;
      }

      if (dirtyRef.current && engineReadyRef.current) {
        dirtyRef.current = false;
        const overlay = overlayCanvasRef.current;
        const container = containerRef.current;
        if (overlay && container) {
          try {
            renderFrame(overlay, container, antPhaseRef);
          } catch (e) {
            console.error('[Lopsy] Render error (recovering):', e);
          }
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
