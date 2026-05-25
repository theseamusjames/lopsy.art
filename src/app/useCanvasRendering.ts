import { useEffect, useRef, type RefObject } from 'react';
import { useEditorStore } from './editor-store';
import { useUIStore } from './ui-store';
import { useToolSettingsStore } from './tool-settings-store';
import { getBrushCursorInfo } from './useCanvasCursor';
import { initEngine, getEngine, destroyEngine } from '../engine-wasm/engine-state';
import { describeError, notifyError } from './notifications-store';
import {
  syncDocumentSize,
  syncBackgroundColor,
  syncViewport,
  syncLayers,
  syncSelection,
  syncGrid,
  syncRulers,
  syncSeamlessPattern,
  syncChannelVisibility,
  syncAdjustments,
  syncGroupAdjustments,
  syncMaskEditMode,
  syncBrushTip,
  syncBrushTexture,
  syncTextLayers,
  syncPathTextLayers,
  renderEngine,
  markAllLayersDirty,
} from '../engine-wasm/engine-sync';
import { renderGrid, renderPixelGrid, renderRulers } from './rendering/render-grid';
import { renderSelectionAnts, renderTransformHandles } from './rendering/render-selection';
import { renderMeshWarpOverlay } from './rendering/render-mesh-warp';
import { renderPathOverlay, renderLassoPreview, renderCropPreview, renderGradientPreview, renderBrushCursor, renderSymmetryCenter, renderPerspectiveCropOverlay } from './rendering/render-overlays';
import { renderTextDragOverlay, renderTextEditOverlay, renderTextHoverBounds } from './rendering/render-text-overlay';
import { hitTestTextLayer } from '../tools/text/text-hit-test';
import { renderGuides, renderGuidePreview, renderGuideRulerOverlays, renderGuideColorSwatch, renderSnapLines } from './rendering/render-guides';
import { renderTiltShiftOverlay } from './rendering/render-tilt-shift-overlay';
import { contextOptions } from '../engine/color-space';
import { clearFrameCache } from '../engine-wasm/gpu-pixel-access';

import { expandLayerToDocSize, cropLayerToContent, hasFloat, getLayerTextureDimensions, getGlyphPositions } from '../engine-wasm/wasm-bridge';
import { PAINT_TOOLS } from '../tools/tool-registry';



/**
 * GPU render path — the WASM engine handles all compositing including effects.
 */
function renderFrameGpu(
  overlayCanvas: HTMLCanvasElement,
  container: HTMLDivElement,
  antPhaseRef: { current: number },
  prevActiveLayerRef: { current: string | null },
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

  // Expand newly-active raster layer to doc size so transform/stretch never clips.
  // Crop the previously-active raster layer back to its content bounds to save memory.
  // This runs before syncLayers so the Zustand state update is reflected immediately.
  // Skip while a float (transform) is in progress — the float system owns the texture.
  const currentActiveId = useEditorStore.getState().document.activeLayerId;
  if (currentActiveId !== prevActiveLayerRef.current && !hasFloat(engine)) {
    const oldId = prevActiveLayerRef.current;
    const newId = currentActiveId;
    const storeState = useEditorStore.getState();
    const doc = storeState.document;

    if (oldId) {
      const oldLayer = doc.layers.find((l) => l.id === oldId);
      if (oldLayer?.type === 'raster') {
        const result = cropLayerToContent(engine, oldId);
        if (result.length === 4 && (result[2] ?? 0) > 0) {
          useEditorStore.setState((s) => ({
            document: {
              ...s.document,
              layers: s.document.layers.map((l) =>
                l.id === oldId
                  ? { ...l, x: result[0]!, y: result[1]!, width: result[2]!, height: result[3]! }
                  : l
              ),
            },
            renderVersion: s.renderVersion + 1,
          }));
        }
      }
    }

    if (newId) {
      const newLayer = doc.layers.find((l) => l.id === newId);
      if (newLayer?.type === 'raster') {
        const result = expandLayerToDocSize(engine, newId);
        if (result.length === 4) {
          useEditorStore.setState((s) => ({
            document: {
              ...s.document,
              layers: s.document.layers.map((l) =>
                l.id === newId
                  ? { ...l, x: result[0]!, y: result[1]!, width: result[2]!, height: result[3]! }
                  : l
              ),
            },
            renderVersion: s.renderVersion + 1,
          }));
        }
      }
    }

    prevActiveLayerRef.current = currentActiveId;
  }

  const editorState = useEditorStore.getState();
  const uiState = useUIStore.getState();
  const toolState = useToolSettingsStore.getState();

  const doc = editorState.document;
  const viewport = editorState.viewport;
  const layers = doc.layers;
  const selection = editorState.selection;
  const dirtyLayerIds = editorState.dirtyLayerIds;

  const activeTool = uiState.activeTool;
  const cursorPosition = uiState.cursorPosition;
  const cursorOnCanvas = uiState.cursorOnCanvas;
  const showGrid = uiState.showGrid;
  const showPixelGrid = uiState.showPixelGrid;
  const showRulers = uiState.showRulers;
  const gridSize = uiState.gridSize;
  const adjustments = uiState.adjustments;
  const adjustmentsEnabled = uiState.adjustmentsEnabled;
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

  syncDocumentSize(engine, doc.width, doc.height);
  syncBackgroundColor(engine, doc.backgroundColor.r, doc.backgroundColor.g, doc.backgroundColor.b, doc.backgroundColor.a);
  syncViewport(engine, viewport.zoom, viewport.panX, viewport.panY, screenW, screenH);
  // syncLayers must run before syncTextLayers so any new text layer's GPU texture
  // is created before syncTextLayers tries to fill or upload pixels into it.
  syncLayers(engine, layers, doc.layerOrder, dirtyLayerIds);

  // Check if the currently-editing text layer is bound to a path.
  // If so, skip syncTextLayers (which renders normal horizontal text) and
  // let syncPathTextLayers handle it instead.
  const editingLayerIsPathText = textEditing
    && layers.some((l) => l.id === textEditing.layerId && l.type === 'text' && (l as import('../types').TextLayer).pathId);

  // Live-update text layer pixels during editing via the WASM engine (swash software rasterizer).
  if (!editingLayerIsPathText) {
    syncTextLayers(
      engine,
      textEditing,
      toolState.textFontSize,
      toolState.textFontFamily,
      toolState.textFontWeight,
      toolState.textFontStyle,
      toolState.textAlign,
      toolState.foregroundColor,
      toolState.textUnderline,
      toolState.textStrikethrough,
      (layerId, x, y) => {
        const layer = layers.find((l) => l.id === layerId);
        if (layer && (layer.x !== x || layer.y !== y)) {
          editorState.updateTextLayerProperties(layerId, { x, y });
        }
      },
    );
  }

  // Render path-text layers (TextLayer.pathId set) using Canvas2D composition.
  const textLayersWithPath = layers.filter(
    (l): l is import('../types').TextLayer => l.type === 'text' && !!(l as import('../types').TextLayer).pathId,
  );
  if (textLayersWithPath.length > 0) {
    syncPathTextLayers(engine, textLayersWithPath, editorState.paths, doc.width, doc.height, textEditing);
    for (const tl of textLayersWithPath) {
      if (tl.x !== 0 || tl.y !== 0) {
        editorState.updateTextLayerProperties(tl.id, { x: 0, y: 0 });
      }
    }
  }

  syncSelection(engine, selection);
  syncGrid(engine, showGrid, gridSize);
  syncRulers(engine, showRulers);
  syncSeamlessPattern(engine, uiState.showSeamlessPattern, uiState.dimSeamlessPattern);
  syncChannelVisibility(engine, uiState.channelVisibility);
  syncAdjustments(engine, adjustments, adjustmentsEnabled);
  syncGroupAdjustments(engine, layers);
  syncMaskEditMode(engine, uiState.maskMode === 'layerMask', doc.activeLayerId);
  syncBrushTip(engine, toolState.activeBrushTip, -toolState.brushAngle * Math.PI / 180, toolState.brushHardness);
  syncBrushTexture(engine, toolState.brushTextureData, toolState.brushTextureScale, toolState.brushTextureBlendMode);

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

    renderSelectionAnts(overlayCtx, selection, viewport.zoom, antPhaseRef.current, transform);
    renderTransformHandles(overlayCtx, selection, transform, viewport.zoom);

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
      const ts = toolState;
      const glyphPositions = Array.from(getGlyphPositions(engine, textEditing.layerId)) as number[];
      renderTextEditOverlay(overlayCtx, textEditing, {
        fontSize: ts.textFontSize,
        fontFamily: ts.textFontFamily,
        fontWeight: ts.textFontWeight,
        fontStyle: ts.textFontStyle,
        color: toolState.foregroundColor,
        lineHeight: 1.4,
        letterSpacing: 0,
        textAlign: ts.textAlign,
      }, viewport.zoom, antPhaseRef.current, glyphPositions);
    }

    const brushCursorInfo = getBrushCursorInfo(activeTool);
    if (brushCursorInfo !== null && cursorOnCanvas) {
      const size = activeTool === 'brush' ? toolState.brushSize
        : activeTool === 'pencil' ? toolState.pencilSize
        : activeTool === 'eraser' ? toolState.eraserSize
        : activeTool === 'stamp' ? toolState.stampSize
        : activeTool === 'sponge' ? toolState.spongeSize
        : brushCursorInfo.size;
      renderBrushCursor(overlayCtx, cursorPosition, size, viewport.zoom, brushCursorInfo.shape, brushCursorInfo.tip, brushCursorInfo.angle);
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
}

/**
 * Main render frame — always GPU. Effects are handled by the compositor.
 */
function renderFrame(
  overlayCanvas: HTMLCanvasElement,
  container: HTMLDivElement,
  antPhaseRef: { current: number },
  prevActiveLayerRef: { current: string | null },
): void {
  clearFrameCache();
  renderFrameGpu(overlayCanvas, container, antPhaseRef, prevActiveLayerRef);
}

export function useCanvasRendering(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  containerRef: RefObject<HTMLDivElement | null>,
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>,
): void {
  const dirtyRef = useRef(true);
  const engineReadyRef = useRef(false);
  const antPhaseRef = useRef(0);
  const prevActiveLayerRef = useRef<string | null>(null);

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
      initEngine(canvas)
        .then((engine) => {
          engineReadyRef.current = true;
          dirtyRef.current = true;
          markAllLayersDirty(engine);
        })
        .catch((err) => {
          notifyError(`Failed to restore WebGL: ${describeError(err)}`);
        });
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

    initEngine(canvas)
      .then((engine) => {
        if (cancelled) {
          // Only destroy if this engine is still the current global engine.
          // In StrictMode, a second mount may have already replaced it.
          if (getEngine() === engine) {
            destroyEngine();
          }
          return;
        }
        engineReadyRef.current = true;
        dirtyRef.current = true;
        // Force initial full sync
        markAllLayersDirty(engine);
      })
      .catch((err) => {
        if (cancelled) return;
        notifyError(`Failed to initialize graphics engine: ${describeError(err)}`);
      });

    return () => {
      cancelled = true;
      engineReadyRef.current = false;
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      // Tracked state is keyed by Engine in a WeakMap; destroying the engine
      // drops the JS wrapper, and the WeakMap entry follows. No reset needed.
      destroyEngine();
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
    let hasBaselineSnapshot = false;
    let baselinedDocVersion = -1;

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

      const currentDocVersion = useEditorStore.getState().documentVersion;
      if (currentDocVersion !== baselinedDocVersion) {
        hasBaselineSnapshot = false;
      }

      if (dirtyRef.current && engineReadyRef.current) {
        dirtyRef.current = false;
        const overlay = overlayCanvasRef.current;
        const container = containerRef.current;
        if (overlay && container) {
          try {
            renderFrame(overlay, container, antPhaseRef, prevActiveLayerRef);
          } catch (e) {
            console.error('[Lopsy] Render error (recovering):', e);
          }

          if (!hasBaselineSnapshot) {
            hasBaselineSnapshot = true;
            baselinedDocVersion = currentDocVersion;
            const state = useEditorStore.getState();
            if (state.undoStack.length === 0) {
              state.pushHistory('New Document');
            }
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
