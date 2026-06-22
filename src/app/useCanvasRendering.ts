import { useEffect, useRef, type RefObject } from 'react';
import { useEditorStore } from './editor-store';
import { useUIStore } from './ui-store';
import { useToolSettingsStore } from './tool-settings-store';
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
import { renderOverlayFrame } from './rendering/render-overlay-frame';
import { getMarqueePreview } from '../tools/marquee/marquee-preview';
import { clearFrameCache } from '../engine-wasm/gpu-pixel-access';

import { expandLayerToDocSize, cropLayerToContent, hasFloat } from '../engine-wasm/wasm-bridge';
import { invalidateCachedSnapshot } from './store/history-slice';
import { clearJsPixelData } from './store/clear-js-pixel-data';


/**
 * GPU render path — the WASM engine handles all compositing including effects.
 */
function renderFrameGpu(
  overlayCanvas: HTMLCanvasElement,
  container: HTMLDivElement,
  antPhaseRef: { current: number },
  prevActiveLayerRef: { current: string | null },
  croppedLayerIds: Set<string>,
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
        invalidateCachedSnapshot(oldId);
        const result = cropLayerToContent(engine, oldId);
        if (result.length === 4 && (result[2] ?? 0) > 0) {
          croppedLayerIds.add(oldId);
          const boundsChanged =
            result[0] !== oldLayer.x || result[1] !== oldLayer.y ||
            result[2] !== (oldLayer.width ?? 0) || result[3] !== (oldLayer.height ?? 0);
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
          // The GPU texture was cropped to content. If the bounds actually
          // changed, cached JS pixel data has wrong dimensions; clear it so
          // syncLayers doesn't re-expand the GPU texture to the stale size
          // (#543). If bounds didn't change (JS-side crop already ran), the
          // cached data (including sparse entries) is still valid.
          if (boundsChanged) {
            clearJsPixelData(oldId);
          }
        }
      }
    }

    if (newId && croppedLayerIds.has(newId)) {
      const newLayer = doc.layers.find((l) => l.id === newId);
      if (newLayer?.type === 'raster') {
        const result = expandLayerToDocSize(engine, newId);
        if (result.length === 4) {
          const actuallyExpanded =
            result[0] !== newLayer.x || result[1] !== newLayer.y ||
            result[2] !== (newLayer.width ?? 0) || result[3] !== (newLayer.height ?? 0);
          if (actuallyExpanded) {
            clearJsPixelData(newId);
          }
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
          // GPU texture was expanded. Drop cached JS pixel data so the next
          // syncLayers doesn't overwrite the expanded texture with the
          // smaller pre-expand snapshot.
          clearJsPixelData(newId);
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

  const showGrid = uiState.showGrid;
  const showRulers = uiState.showRulers;
  const gridSize = uiState.gridSize;
  const adjustments = uiState.adjustments;
  const adjustmentsEnabled = uiState.adjustmentsEnabled;

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
      toolState.settings.text.fontSize,
      toolState.settings.text.fontFamily,
      toolState.settings.text.fontWeight,
      toolState.settings.text.fontStyle,
      toolState.settings.text.align,
      toolState.foregroundColor,
      toolState.settings.text.underline,
      toolState.settings.text.strikethrough,
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
  syncBrushTip(engine, toolState.activeBrushTip, -toolState.settings.brush.angle * Math.PI / 180, toolState.settings.brush.hardness);
  syncBrushTexture(engine, toolState.brushTextureData, toolState.brushTextureScale, toolState.brushTextureBlendMode);

  renderEngine(engine);

  // Overlay canvas: selection ants, cursors, guides, rulers
  renderOverlayFrame(overlayCanvas, antPhaseRef.current);
}

/**
 * Main render frame — always GPU. Effects are handled by the compositor.
 */
function renderFrame(
  overlayCanvas: HTMLCanvasElement,
  container: HTMLDivElement,
  antPhaseRef: { current: number },
  prevActiveLayerRef: { current: string | null },
  croppedLayerIds: Set<string>,
): void {
  clearFrameCache();
  renderFrameGpu(overlayCanvas, container, antPhaseRef, prevActiveLayerRef, croppedLayerIds);
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
  const croppedLayerIdsRef = useRef(new Set<string>());

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

      // Check if selection ants or text cursor need animating. Animation
      // only touches the 2D overlay canvas — it must not force a full GPU
      // recomposite of every layer — so it gets its own dirty flag.
      let overlayOnly = false;
      const sel = useEditorStore.getState().selection;
      const hasTextEditing = useUIStore.getState().textEditing !== null;
      if (sel.active && !selectionActive) {
        selectionActive = true;
        dirtyRef.current = true;
      } else if (!sel.active && selectionActive) {
        selectionActive = false;
      }
      // A live marquee drag animates on the overlay only — it must not force a
      // GPU recomposite (and it carries no committed selection yet).
      const hasMarqueePreview = getMarqueePreview() !== null;
      if (selectionActive || hasTextEditing || hasMarqueePreview) {
        antPhaseRef.current++;
        overlayOnly = true;
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
            renderFrame(overlay, container, antPhaseRef, prevActiveLayerRef, croppedLayerIdsRef.current);
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
      } else if (overlayOnly && engineReadyRef.current) {
        const overlay = overlayCanvasRef.current;
        if (overlay) {
          try {
            renderOverlayFrame(overlay, antPhaseRef.current);
          } catch (e) {
            console.error('[Lopsy] Overlay render error (recovering):', e);
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
