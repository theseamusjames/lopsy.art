import { useCallback, useRef, useEffect } from 'react';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { PixelBuffer } from '../engine/pixel-data';
import { invalidateBitmapCache, createPaintingCanvas, destroyPaintingCanvas } from '../engine/bitmap-cache';
import { extractMaskFromSurface } from '../engine/mask-utils';
import { getEngine } from '../engine-wasm/engine-state';
import {
  beginStroke, endStroke, hasFloat, dropFloat,
  applyBrushDabBatch as gpuBrushDabBatch,
  uploadLayerPixels,
} from '../engine-wasm/wasm-bridge';
import { flushLayerSync, resetTrackedState } from '../engine-wasm/engine-sync';
import { uploadCompressed } from '../engine-wasm/gpu-pixel-access';
import { smoothStroke, HOLD_TIMEOUT_MS } from '../tools/smooth-line/smooth-line';
import { useToolSettingsStore } from './tool-settings-store';

import { clearActiveMaskEditBuffer } from './interactions/mask-buffer';
import { wrapWithSelectionMask } from './interactions/selection-mask-wrap';
import { clearJsPixelData } from './store/clear-js-pixel-data';
import { setPendingStroke, clearPendingStroke } from './interactions/pending-stroke';
import type {
  InteractionState, InteractionContext,
  FloatingSelection, PersistentTransform, LastPaintPoint,
} from './interactions/interaction-types';
import { handleTransformDown } from './interactions/transform-handlers';
import { handleNudgeMove } from './interactions/move-handlers';
import { toolHandlers, handleTransformMove } from './interactions/tool-router';
// PAINT_TOOLS / GPU_TOOLS are derived from the tool registry, so adding a
// new paint or GPU tool is a single-file change at the descriptor.
import { PAINT_TOOLS, GPU_TOOLS } from '../tools/tool-registry';
import { pixelDataManager } from '../engine/pixel-data-manager';

export { getActiveMaskEditBuffer } from './interactions/mask-buffer';
export { strokeCurrentPath } from './interactions/path-stroke';

import type { Point, Layer } from '../types';
import type { MaskedPixelBuffer } from '../engine/pixel-data';

/** Finalize a deferred stroke from a previous mouseup. */
function finalizePendingStroke(ref: React.MutableRefObject<{ layerId: string } | null>): void {
  const pending = ref.current;
  if (!pending) return;
  ref.current = null;
  clearPendingStroke();

  const engine = getEngine();
  if (!engine) return;

  endStroke(engine, pending.layerId);

  clearJsPixelData(pending.layerId);
  useEditorStore.getState().notifyRender();
}

const INITIAL_STATE: InteractionState = {
  drawing: false,
  lastPoint: null,
  pixelBuffer: null,
  originalPixelBuffer: null,
  layerId: null,
  tool: null,
  startPoint: null,
  layerStartX: 0,
  layerStartY: 0,
  maskMode: false,
  transformHandle: null,
  transformStartState: null,
  transformStartAngle: 0,
  originalSelectionMask: null,
  originalSelectionMaskWidth: 0,
  originalSelectionMaskHeight: 0,
  moveOriginalMask: null,
  moveOriginalBounds: null,
};

export function useCanvasInteraction(
  screenToCanvas: (screenX: number, screenY: number) => Point,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const stateRef = useRef<InteractionState>({ ...INITIAL_STATE });
  const persistentTransformRef = useRef<PersistentTransform | null>(null);
  const floatingSelectionRef = useRef<FloatingSelection | null>(null);
  const stampSourceRef = useRef<Point | null>(null);
  const stampOffsetRef = useRef<Point | null>(null);
  const lastPaintPointRef = useRef<LastPaintPoint | null>(null);
  const pendingStrokeRef = useRef<{ layerId: string } | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  // Clean up the hold timer on unmount
  useEffect(() => cancelHoldTimer, [cancelHoldTimer]);

  const buildContext = useCallback(
    (e: React.MouseEvent, canvasPos: Point, layerPos: Point, activeLayerId: string, activeLayer: Layer, pixelBuffer: PixelBuffer, paintSurface: PixelBuffer | MaskedPixelBuffer): InteractionContext => ({
      canvasPos, layerPos,
      shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey || e.ctrlKey,
      clientX: e.clientX, clientY: e.clientY,
      activeLayerId, activeLayer, pixelBuffer, paintSurface,
      screenToCanvas, containerRef,
      stateRef, floatingSelectionRef, persistentTransformRef,
      stampSourceRef, stampOffsetRef, lastPaintPointRef,
    }),
    [screenToCanvas, containerRef],
  );

  const handleToolDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;

      // Cancel any pending hold-to-smooth timer from the previous stroke
      cancelHoldTimer();

      const activeTool = useUIStore.getState().activeTool;
      const editorState = useEditorStore.getState();
      const activeLayerId = editorState.document.activeLayerId;
      if (!activeLayerId) return;

      const activeLayer = editorState.document.layers.find((l) => l.id === activeLayerId);
      if (!activeLayer || activeLayer.locked) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const canvasPos = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top);

      const engine = getEngine();
      const isPaintTool = PAINT_TOOLS.has(activeTool);
      const maskEditMode = useUIStore.getState().maskEditMode;

      // Fall back to CPU when:
      // - mask edit mode (paints on mask surface)
      // - tool doesn't have a GPU path
      // GPU brush/eraser shaders clip to the selection mask, so an active
      // selection does NOT force the CPU path.
      const isGpuTool = GPU_TOOLS.has(activeTool);
      const useGpu = engine && isGpuTool && !maskEditMode;
      const useGpuStroke = useGpu && isPaintTool;

      let pixelBuffer: PixelBuffer;
      let paintSurface: PixelBuffer | MaskedPixelBuffer;
      let expandedLayer = activeLayer;
      let layerPos: Point = { x: canvasPos.x - activeLayer.x, y: canvasPos.y - activeLayer.y };
      let strokeContinuation = false;

      if (useGpu) {
        // GPU path: no JS pixel data needed. The engine handles the
        // layer texture directly — no expand, no upload, no round-trip.
        // This preserves 16-bit float precision throughout.

        // Finalize any pending brush stroke so it's baked into the layer
        // texture before another GPU tool (e.g. shape) snapshots it.
        if (!isPaintTool) {
          finalizePendingStroke(pendingStrokeRef);
        }

        if (isPaintTool) {
          const isShift = e.shiftKey && lastPaintPointRef.current?.layerId === activeLayerId;
          if (isShift && pendingStrokeRef.current?.layerId === activeLayerId) {
            // Shift-click continuation: reuse the pending stroke texture so
            // the shift-line doesn't double-composite over the previous stroke's endpoint.
            strokeContinuation = true;
          } else {
            // Finalize any pending stroke from a previous mouseup
            finalizePendingStroke(pendingStrokeRef);
            beginStroke(engine, activeLayerId);

            // beginStroke calls ensure_layer_full_size on the WASM side,
            // which expands a cropped layer texture to the union of the
            // document area and the existing content area (preserving
            // offscreen content). Sync the JS store to match.
            const docState = useEditorStore.getState().document;
            const currentLayer = docState.layers.find((l) => l.id === activeLayerId);
            if (currentLayer && currentLayer.type === 'raster') {
              const newX = Math.min(0, currentLayer.x);
              const newY = Math.min(0, currentLayer.y);
              const newW = Math.max(docState.width, currentLayer.x + currentLayer.width) - newX;
              const newH = Math.max(docState.height, currentLayer.y + currentLayer.height) - newY;
              const needsSync = currentLayer.x !== newX || currentLayer.y !== newY
                || currentLayer.width !== newW || currentLayer.height !== newH;
              if (needsSync) {
              const updatedLayers = docState.layers.map((l) =>
                l.id === activeLayerId
                  ? { ...l, x: newX, y: newY, width: newW, height: newH } as Layer
                  : l,
              );
              pixelDataManager.remove(activeLayerId);
              const dirtyIds = new Set(useEditorStore.getState().dirtyLayerIds);
              dirtyIds.add(activeLayerId);
              useEditorStore.setState({
                document: { ...docState, layers: updatedLayers },
                dirtyLayerIds: dirtyIds,
              });
              // Re-read activeLayer so layerPos computation below uses updated position
              expandedLayer = updatedLayers.find((l) => l.id === activeLayerId) ?? activeLayer;
              layerPos = { x: canvasPos.x - expandedLayer.x, y: canvasPos.y - expandedLayer.y };
              }
            }
          }
        }
        // Create a minimal dummy buffer for the context (tool handlers
        // ignore it when the GPU engine is available).
        const dummyData = new ImageData(1, 1);
        pixelBuffer = PixelBuffer.wrapImageData(dummyData);
        paintSurface = pixelBuffer;
      } else {
        // Finalize any pending GPU stroke so the layer texture includes it
        // before we read pixel data back for non-GPU tools (e.g. move).
        finalizePendingStroke(pendingStrokeRef);

        // CPU fallback: expand layer to full canvas for pixel manipulation
        const imageData = editorState.expandLayerForEditing(activeLayerId);
        expandedLayer = useEditorStore.getState().document.layers.find((l) => l.id === activeLayerId)!;
        layerPos = { x: canvasPos.x - expandedLayer.x, y: canvasPos.y - expandedLayer.y };
        pixelBuffer = PixelBuffer.wrapImageData(imageData);
        invalidateBitmapCache(activeLayerId);
        createPaintingCanvas(activeLayerId, imageData);
        paintSurface = wrapWithSelectionMask(pixelBuffer, expandedLayer.x, expandedLayer.y);
      }
      const ctx = buildContext(e, canvasPos, layerPos, activeLayerId, expandedLayer, pixelBuffer, paintSurface);
      if (useGpu) {
        ctx.isStrokeContinuation = strokeContinuation;
      }

      // Transform handle interaction (pre-tool dispatch)
      const transformResult = handleTransformDown(ctx);
      if (transformResult) {
        stateRef.current = transformResult;
        return;
      }

      const handler = toolHandlers[activeTool];
      const newState = handler?.down?.(ctx);
      if (newState) {
        newState._usedGpuStroke = !!useGpuStroke;
        stateRef.current = newState;
      }
    },
    [screenToCanvas, containerRef, buildContext, cancelHoldTimer],
  );

  const handleToolMove = useCallback(
    (e: React.MouseEvent) => {
      const state = stateRef.current;
      if (!state.drawing || !state.layerId) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const canvasPos = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top);
      const layerLocalPos: Point = {
        x: canvasPos.x - state.layerStartX,
        y: canvasPos.y - state.layerStartY,
      };

      // Transform handle drag (not tool-routed)
      if (state.transformHandle && state.transformStartState && state.startPoint) {
        handleTransformMove(state, canvasPos, e.shiftKey);
        return;
      }

      if (!state.tool) return;

      const ctx: InteractionContext = {
        canvasPos, layerPos: layerLocalPos,
        shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey || e.ctrlKey,
        clientX: e.clientX, clientY: e.clientY,
        activeLayerId: state.layerId,
        activeLayer: useEditorStore.getState().document.layers.find((l) => l.id === state.layerId)!,
        pixelBuffer: state.pixelBuffer!,
        paintSurface: state.pixelBuffer!,
        screenToCanvas, containerRef,
        stateRef, floatingSelectionRef, persistentTransformRef,
        stampSourceRef, stampOffsetRef, lastPaintPointRef,
      };

      toolHandlers[state.tool]?.move?.(ctx, state);

      // Hold-to-smooth: reset timer on every move during a brush stroke.
      // If the cursor stays still (no new mousemove) for HOLD_TIMEOUT_MS, smooth.
      if (
        state.tool === 'brush'
        && state._usedGpuStroke
        && state.strokePoints
        && state.strokePoints.length >= 3
        && state.layerId
        && !state.maskMode
      ) {
        cancelHoldTimer();

        const strokePoints = state.strokePoints;
        const layerId = state.layerId;

        holdTimerRef.current = setTimeout(() => {
          holdTimerRef.current = null;

          const engine = getEngine();
          if (!engine) return;

          const toolSettings = useToolSettingsStore.getState();
          const size = toolSettings.brushSize;
          const hardness = toolSettings.brushHardness / 100;
          const opacity = toolSettings.brushOpacity / 100;
          const color = toolSettings.foregroundColor;
          const r = color.r / 255;
          const g = color.g / 255;
          const b = color.b / 255;
          const spacing = Math.max(1, size * toolSettings.brushSpacing / 100);

          const result = smoothStroke(strokePoints, spacing);
          if (result.sampledPoints.length < 2) return;

          // End the active stroke so the freehand is baked into the layer.
          endStroke(engine, layerId);
          clearJsPixelData(layerId);

          // Snapshot the freehand state so undo from the smoothed result
          // restores the freehand stroke (not the pre-stroke blank).
          // Stack was: [..., pre-stroke]. After push: [..., pre-stroke, freehand].
          const editor = useEditorStore.getState();
          editor.pushHistory();

          // Restore the layer to its pre-stroke pixels so we can draw
          // the smooth stroke on a clean slate. We read the pre-stroke
          // snapshot directly from the undo stack (second-to-last entry)
          // instead of calling undo(), which would pop the stack.
          const undoStack = useEditorStore.getState().undoStack;
          const preStrokeEntry = undoStack[undoStack.length - 2];
          if (!preStrokeEntry) return;
          const preStrokeBlob = preStrokeEntry.gpuSnapshots.get(layerId);
          if (preStrokeBlob && preStrokeBlob.length > 0) {
            uploadCompressed(layerId, preStrokeBlob);
          } else {
            // Empty sentinel — layer was blank before the stroke.
            // Clear it to transparent so the smooth stroke doesn't
            // draw on top of the freehand.
            uploadLayerPixels(engine, layerId, new Uint8Array(4), 1, 1, 0, 0);
          }

          const eng = getEngine();
          if (!eng) return;
          resetTrackedState(eng);
          flushLayerSync(useEditorStore.getState());

          beginStroke(eng, layerId);
          const arr = new Float64Array(result.sampledPoints.length * 2);
          for (let i = 0; i < result.sampledPoints.length; i++) {
            arr[i * 2] = result.sampledPoints[i]!.x;
            arr[i * 2 + 1] = result.sampledPoints[i]!.y;
          }
          gpuBrushDabBatch(eng, layerId, arr, size, hardness, r, g, b, color.a, opacity, 1);
          endStroke(eng, layerId);

          clearJsPixelData(layerId);
          useEditorStore.getState().notifyRender();

          // Mark the stroke as done so mouseup becomes a no-op
          stateRef.current = { ...INITIAL_STATE };
        }, HOLD_TIMEOUT_MS);
      }
    },
    [screenToCanvas, containerRef, cancelHoldTimer],
  );

  const handleToolUp = useCallback((e: React.MouseEvent) => {
    // Cancel any in-progress hold-to-smooth timer
    cancelHoldTimer();

    const state = stateRef.current;
    if (!state.tool) {
      stateRef.current = { ...INITIAL_STATE };
      return;
    }

    const rect = containerRef.current?.getBoundingClientRect();
    const canvasPos = rect
      ? screenToCanvas(e.clientX - rect.left, e.clientY - rect.top)
      : { x: 0, y: 0 };

    const ctx: InteractionContext = {
      canvasPos, layerPos: canvasPos,
      shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey || e.ctrlKey,
      clientX: e.clientX, clientY: e.clientY,
      activeLayerId: state.layerId ?? '',
      activeLayer: useEditorStore.getState().document.layers.find((l) => l.id === state.layerId)!,
      pixelBuffer: state.pixelBuffer!,
      paintSurface: state.pixelBuffer!,
      screenToCanvas, containerRef,
      stateRef, floatingSelectionRef, persistentTransformRef,
      stampSourceRef, stampOffsetRef, lastPaintPointRef,
    };

    toolHandlers[state.tool]?.up?.(ctx, state);

    // Finalize paint stroke — deferred so shift-click can continue the stroke
    if (PAINT_TOOLS.has(state.tool) && state.layerId && !state.maskMode) {
      const engine = getEngine();
      if (engine && state._usedGpuStroke) {
        // Defer endStroke: if the next mousedown is a shift-click on the same
        // layer, the stroke texture will be reused instead of double-compositing.
        pendingStrokeRef.current = { layerId: state.layerId };
        setPendingStroke(state.layerId);
      } else {
        // CPU fallback
        destroyPaintingCanvas(state.layerId);
        const editorState = useEditorStore.getState();
        const layerData = pixelDataManager.get(state.layerId);
        if (layerData) {
          editorState.updateLayerPixelData(state.layerId, layerData);
        }
      }
    }

    // Save last paint point for shift+click line drawing
    if (PAINT_TOOLS.has(state.tool) && state.lastPoint && state.layerId) {
      lastPaintPointRef.current = { point: state.lastPoint, layerId: state.layerId };
    }

    // Finalize transform handle drag: keep the GPU float alive so subsequent
    // grabs can re-transform from the original pixels without degradation.
    // The float is only dropped when the user commits (clearPersistentTransform).
    if (state.transformHandle) {
      useUIStore.getState().setActiveTransformHandle(null);
    }

    // Clear gradient preview
    if (state.tool === 'gradient') {
      useUIStore.getState().setGradientPreview(null);
    }

    // Sync mask drawing buffer back to mask data
    if (state.maskMode && state.pixelBuffer && state.layerId) {
      const layer = useEditorStore.getState().document.layers.find((l) => l.id === state.layerId);
      if (layer?.mask) {
        const newMaskData = extractMaskFromSurface(state.pixelBuffer, layer.mask.width, layer.mask.height);
        useEditorStore.getState().updateLayerMaskData(state.layerId, newMaskData);
      }
      clearActiveMaskEditBuffer();
    }

    stateRef.current = { ...INITIAL_STATE };
  }, [screenToCanvas, containerRef, cancelHoldTimer]);

  const clearPersistentTransform = useCallback(() => {
    persistentTransformRef.current = null;
    floatingSelectionRef.current = null;

    // Drop GPU float — the layer texture already has the committed result
    const eng = getEngine();
    if (eng && hasFloat(eng)) {
      dropFloat(eng);
    }

    const editorState = useEditorStore.getState();
    const activeId = editorState.document.activeLayerId;
    if (activeId) {
      clearJsPixelData(activeId);
      editorState.notifyRender();
    }
  }, []);

  const nudgeMove = useCallback((dx: number, dy: number) => {
    handleNudgeMove(dx, dy, floatingSelectionRef, persistentTransformRef);
  }, []);

  return { handleToolDown, handleToolMove, handleToolUp, clearPersistentTransform, nudgeMove };
}
