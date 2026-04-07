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
} from '../engine-wasm/wasm-bridge';
import { smoothStroke, HOLD_TIMEOUT_MS, HOLD_RADIUS_PX } from '../tools/smooth-line/smooth-line';
import { useToolSettingsStore } from './tool-settings-store';

import { clearActiveMaskEditBuffer } from './interactions/mask-buffer';
import { wrapWithSelectionMask } from './interactions/selection-mask-wrap';
import { clearJsPixelData } from './store/clear-js-pixel-data';
import type {
  InteractionState, InteractionContext,
  FloatingSelection, PersistentTransform, LastPaintPoint,
} from './interactions/interaction-types';
import { handleTransformDown } from './interactions/transform-handlers';
import { handleNudgeMove } from './interactions/move-handlers';
import { toolHandlers, handleTransformMove } from './interactions/tool-router';

export { getActiveMaskEditBuffer } from './interactions/mask-buffer';
export { strokeCurrentPath } from './interactions/path-stroke';

import type { Point, ToolId, Layer } from '../types';
import type { MaskedPixelBuffer } from '../engine/pixel-data';

/** Finalize a deferred stroke from a previous mouseup. */
function finalizePendingStroke(ref: React.MutableRefObject<{ layerId: string } | null>): void {
  const pending = ref.current;
  if (!pending) return;
  ref.current = null;

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

const PAINT_TOOLS: ReadonlySet<ToolId> = new Set(['brush', 'pencil', 'eraser', 'dodge', 'stamp']);
// Tools that render entirely on the GPU and don't need JS-side pixel data.
// These skip expandLayerForEditing to avoid the 16-bit → 8-bit round-trip.
const GPU_TOOLS: ReadonlySet<ToolId> = new Set(['brush', 'pencil', 'eraser', 'dodge', 'stamp', 'gradient', 'shape']);

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
  const holdMouseMoveRef = useRef<((e: MouseEvent) => void) | null>(null);

  const cancelHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdMouseMoveRef.current) {
      window.removeEventListener('mousemove', holdMouseMoveRef.current);
      holdMouseMoveRef.current = null;
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
      // - active selection (GPU brush doesn't clip to selection mask yet)
      // - tool doesn't have a GPU path
      const hasSelection = useEditorStore.getState().selection.active;
      const isGpuTool = GPU_TOOLS.has(activeTool);
      const useGpu = engine && isGpuTool && !maskEditMode && !hasSelection;
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
            // which may expand a cropped layer texture to full document
            // size and reset the layer position to (0,0). Sync the JS
            // store to match so the two sides don't desync.
            const docState = useEditorStore.getState().document;
            const currentLayer = docState.layers.find((l) => l.id === activeLayerId);
            if (currentLayer && (currentLayer.x !== 0 || currentLayer.y !== 0
              || (currentLayer.type === 'raster' && (currentLayer.width !== docState.width || currentLayer.height !== docState.height)))) {
              const updatedLayers = docState.layers.map((l) =>
                l.id === activeLayerId
                  ? { ...l, x: 0, y: 0, width: docState.width, height: docState.height } as Layer
                  : l,
              );
              const pixelData = new Map(useEditorStore.getState().layerPixelData);
              pixelData.delete(activeLayerId);
              const sparseMap = new Map(useEditorStore.getState().sparseLayerData);
              sparseMap.delete(activeLayerId);
              const dirtyIds = new Set(useEditorStore.getState().dirtyLayerIds);
              dirtyIds.add(activeLayerId);
              useEditorStore.setState({
                document: { ...docState, layers: updatedLayers },
                layerPixelData: pixelData,
                sparseLayerData: sparseMap,
                dirtyLayerIds: dirtyIds,
              });
              // Re-read activeLayer so layerPos computation below uses updated position
              expandedLayer = updatedLayers.find((l) => l.id === activeLayerId) ?? activeLayer;
              layerPos = { x: canvasPos.x - expandedLayer.x, y: canvasPos.y - expandedLayer.y };
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
    },
    [screenToCanvas, containerRef],
  );

  const handleToolUp = useCallback((e: React.MouseEvent) => {
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
      } else {
        // CPU fallback
        destroyPaintingCanvas(state.layerId);
        const editorState = useEditorStore.getState();
        const layerData = editorState.layerPixelData.get(state.layerId);
        if (layerData) {
          editorState.updateLayerPixelData(state.layerId, layerData);
        }
      }
    }

    // Save last paint point for shift+click line drawing
    if (PAINT_TOOLS.has(state.tool) && state.lastPoint && state.layerId) {
      lastPaintPointRef.current = { point: state.lastPoint, layerId: state.layerId };
    }

    // Hold-to-smooth: start a timer for brush strokes with enough points.
    // If the cursor stays still for HOLD_TIMEOUT_MS, undo and re-draw smoothed.
    const shouldStartHoldTimer =
      state.tool === 'brush'
      && state._usedGpuStroke
      && state.strokePoints
      && state.strokePoints.length >= 3
      && state.layerId
      && !state.maskMode;

    if (shouldStartHoldTimer) {
      const strokePoints = state.strokePoints!;
      const layerId = state.layerId!;
      const holdOrigin = { x: e.clientX, y: e.clientY };

      const onMouseMove = (moveEvt: MouseEvent) => {
        const dx = moveEvt.clientX - holdOrigin.x;
        const dy = moveEvt.clientY - holdOrigin.y;
        if (Math.sqrt(dx * dx + dy * dy) > HOLD_RADIUS_PX) {
          cancelHoldTimer();
        }
      };

      holdMouseMoveRef.current = onMouseMove;
      window.addEventListener('mousemove', onMouseMove);

      holdTimerRef.current = setTimeout(() => {
        cancelHoldTimer();

        const engine = getEngine();
        if (!engine) return;

        const toolSettings = useToolSettingsStore.getState();
        const size = toolSettings.brushSize;
        const hardness = toolSettings.brushHardness / 100;
        const opacity = toolSettings.brushOpacity / 100;
        const color = useUIStore.getState().foregroundColor;
        const r = color.r / 255;
        const g = color.g / 255;
        const b = color.b / 255;
        const spacing = Math.max(1, size * toolSettings.brushSpacing / 100);

        const result = smoothStroke(strokePoints, spacing);
        if (result.sampledPoints.length < 2) return;

        // Finalize the pending stroke before undo
        finalizePendingStroke(pendingStrokeRef);

        // Undo the original freehand stroke
        useEditorStore.getState().undo();

        // Re-draw with smoothed points
        beginStroke(engine, layerId);
        const arr = new Float64Array(result.sampledPoints.length * 2);
        for (let i = 0; i < result.sampledPoints.length; i++) {
          arr[i * 2] = result.sampledPoints[i]!.x;
          arr[i * 2 + 1] = result.sampledPoints[i]!.y;
        }
        gpuBrushDabBatch(engine, layerId, arr, size, hardness, r, g, b, color.a, opacity, 1);
        endStroke(engine, layerId);

        // Push a new history entry for the smoothed stroke
        useEditorStore.getState().pushHistory();
        clearJsPixelData(layerId);
        useEditorStore.getState().notifyRender();
      }, HOLD_TIMEOUT_MS);
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
