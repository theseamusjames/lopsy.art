import { useCallback, useRef, useEffect } from 'react';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { PixelBuffer } from '../engine/pixel-data';
import { invalidateBitmapCache, createPaintingCanvas, destroyPaintingCanvas } from '../engine/bitmap-cache';
import { getEngine } from '../engine-wasm/engine-state';
import {
  beginStroke, endStroke, hasFloat, dropFloat,
  applyBrushDabBatch as gpuBrushDabBatch,
  uploadLayerPixels,
  setSelectionMask,
  readMaskTexture,
  restoreLayerFromSnapshot,
} from '../engine-wasm/wasm-bridge';
import { flushLayerSync, resetTrackedState, syncDocumentSize, syncSelection } from '../engine-wasm/engine-sync';
import { smoothStroke, HOLD_TIMEOUT_MS } from '../tools/smooth-line/smooth-line';
import { mirrorBatchPoints } from '../tools/symmetry';
import { useToolSettingsStore } from './tool-settings-store';

import { wrapWithSelectionMask } from './interactions/selection-mask-wrap';
import { clearJsPixelData } from './store/clear-js-pixel-data';
import { deferCacheLayerSnapshot } from './store/history-slice';
import { clearPendingStroke } from './interactions/pending-stroke';
import { syncLayerAfterFullSize } from './sync-layer-after-full-size';
import type {
  InteractionState, InteractionContext,
  FloatingSelection, PersistentTransform, LastPaintPoint,
} from './interactions/interaction-types';
import { handleTransformDown } from './interactions/transform-handlers';
import {
  handleMeshWarpDown,
  handleMeshWarpMove,
  handleMeshWarpUp,
} from './interactions/mesh-warp-handlers';
import {
  handleTiltShiftDown,
  handleTiltShiftMove,
  handleTiltShiftUp,
} from './interactions/tilt-shift-handlers';
import {
  isLiquifyActive,
  handleLiquifyDown,
  handleLiquifyMove,
  handleLiquifyUp,
} from './interactions/liquify-handlers';
import { handleNudgeMove } from './interactions/move-handlers';
import { selectLayerAlpha } from '../panels/LayerPanel/layer-selection';
import { createTransformState } from '../tools/transform/transform';
import { toolHandlers, handleTransformMove } from './interactions/tool-router';
// PAINT_TOOLS / GPU_TOOLS are derived from the tool registry, so adding a
// new paint or GPU tool is a single-file change at the descriptor.
import { PAINT_TOOLS, GPU_TOOLS } from '../tools/tool-registry';
import { pixelDataManager } from '../engine/pixel-data-manager';

export { strokeCurrentPath } from './interactions/path-stroke';

import type { Point, Layer } from '../types';

export interface ToolEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}
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

// Tools that don't need a pixel buffer (selection tools, eyedropper, text, etc.)
// still receive an InteractionContext with non-null pixelBuffer/paintSurface
// fields. Reuse one 1×1 placeholder rather than allocating per pointer-down.
// TODO: drop these fields from InteractionContext entirely — nothing reads them.
const PLACEHOLDER_PIXEL_BUFFER = PixelBuffer.wrapImageData(new ImageData(1, 1));

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
    (e: ToolEvent, canvasPos: Point, layerPos: Point, activeLayerId: string, activeLayer: Layer, pixelBuffer: PixelBuffer, paintSurface: PixelBuffer | MaskedPixelBuffer): InteractionContext => ({
      canvasPos, layerPos,
      shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
      clientX: e.clientX, clientY: e.clientY,
      activeLayerId, activeLayer, pixelBuffer, paintSurface,
      screenToCanvas, containerRef,
      stateRef, floatingSelectionRef, persistentTransformRef,
      stampSourceRef, stampOffsetRef, lastPaintPointRef,
    }),
    [screenToCanvas, containerRef],
  );

  const handleToolDown = useCallback(
    (e: ToolEvent) => {
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

      if (e.metaKey) {
        const ts = useToolSettingsStore.getState();
        if (ts.symmetryRadialSegments >= 2 || ts.symmetryHorizontal || ts.symmetryVertical) {
          ts.setSymmetryCenter({ x: canvasPos.x, y: canvasPos.y });
          return;
        }
      }

      if (isLiquifyActive()) {
        const layerPos = (() => {
          const layer = editorState.document.layers.find((l) => l.id === activeLayerId);
          return layer ? { x: canvasPos.x - layer.x, y: canvasPos.y - layer.y } : canvasPos;
        })();
        handleLiquifyDown(layerPos);
        stateRef.current = { ...INITIAL_STATE, drawing: true, layerId: activeLayerId };
        return;
      }

      // Pre-tool: mesh warp handle drag. Captures the click before the
      // expensive GPU stroke / pixel-buffer setup runs, so dragging a
      // mesh handle is cheap and doesn't disturb the active layer texture.
      if (handleTiltShiftDown(canvasPos)) {
        stateRef.current = {
          ...INITIAL_STATE,
          drawing: true,
          layerId: activeLayerId,
          tiltShiftDragging: true,
        };
        return;
      }

      if (handleMeshWarpDown(canvasPos)) {
        stateRef.current = {
          ...INITIAL_STATE,
          drawing: true,
          layerId: activeLayerId,
          meshWarpDragging: true,
        };
        return;
      }

      const engine = getEngine();
      const isPaintTool = PAINT_TOOLS.has(activeTool);
      const maskMode = useUIStore.getState().maskMode;
      const maskEditMode = maskMode === 'layerMask';
      const isQuickMaskMode = maskMode === 'quickMask';

      // Fall back to CPU when:
      // - mask edit mode (paints on mask surface)
      // - quick mask mode (paints on the doc-sized quick mask buffer)
      // - tool doesn't have a GPU path
      // GPU brush/eraser shaders clip to the selection mask, so an active
      // selection does NOT force the CPU path.
      const isGpuTool = GPU_TOOLS.has(activeTool);
      const useGpu = engine && isGpuTool && !maskEditMode && !isQuickMaskMode;
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
          if (isShift) {
            strokeContinuation = true;
          }
          {
            const canContinueStroke = strokeContinuation && pendingStrokeRef.current?.layerId === activeLayerId;
            if (!canContinueStroke) {
              finalizePendingStroke(pendingStrokeRef);
            }
            const currentState = useEditorStore.getState();
            syncDocumentSize(engine, currentState.document.width, currentState.document.height);
            flushLayerSync(currentState);
            syncSelection(engine, currentState.selection);
            if (!canContinueStroke) {
              const toolLabel = activeTool === 'brush' ? 'Brush' : activeTool === 'pencil' ? 'Pencil' : 'Eraser';
              useEditorStore.getState().pushHistory(toolLabel);
              beginStroke(engine, activeLayerId);
            }

            // beginStroke calls ensure_layer_full_size on the WASM side,
            // which expands a cropped layer texture to the union of the
            // document area and the existing content area (preserving
            // offscreen content). Sync the JS store to match.
            const synced = syncLayerAfterFullSize(engine, activeLayerId);
            if (synced) {
              expandedLayer = synced;
              layerPos = { x: canvasPos.x - expandedLayer.x, y: canvasPos.y - expandedLayer.y };
            }
          }
        }
        pixelBuffer = PLACEHOLDER_PIXEL_BUFFER;
        paintSurface = PLACEHOLDER_PIXEL_BUFFER;
      } else {
        // Finalize any pending GPU stroke so the layer texture includes it
        // before we read pixel data back for non-GPU tools (e.g. move).
        finalizePendingStroke(pendingStrokeRef);

        // Only expand the active layer's pixel data for tools that actually
        // read/write it (move, smudge, fill). Tools like text, crop, path,
        // eyedropper, and selection tools don't need pixel data and expanding
        // would destructively change layer bounds before pushHistory captures
        // them — causing undo to restore the wrong positions.
        // Quick Mask Mode paints on the quick mask buffer (not the layer), so
        // no pixel data expansion is needed — same as non-paint tools.
        const needsPixelData = (isPaintTool && !isQuickMaskMode) || activeTool === 'move' || activeTool === 'fill';
        if (needsPixelData) {
          const imageData = editorState.expandLayerForEditing(activeLayerId);
          expandedLayer = useEditorStore.getState().document.layers.find((l) => l.id === activeLayerId)!;
          layerPos = { x: canvasPos.x - expandedLayer.x, y: canvasPos.y - expandedLayer.y };
          pixelBuffer = PixelBuffer.wrapImageData(imageData);
          invalidateBitmapCache(activeLayerId);
          createPaintingCanvas(activeLayerId, imageData);
          paintSurface = wrapWithSelectionMask(pixelBuffer, expandedLayer.x, expandedLayer.y);
        } else {
          pixelBuffer = PLACEHOLDER_PIXEL_BUFFER;
          paintSurface = PLACEHOLDER_PIXEL_BUFFER;
        }
      }
      const ctx = buildContext(e, canvasPos, layerPos, activeLayerId, expandedLayer, pixelBuffer, paintSurface);
      if (useGpu) {
        ctx.isStrokeContinuation = true;
      }

      // Transform handle interaction (pre-tool dispatch)
      const transformResult = handleTransformDown(ctx);
      if (transformResult) {
        stateRef.current = transformResult;
        return;
      }

      // Commit any active GPU float (from transform or move) before dispatching
      // to other tools. Without this, tools like gradient read the stale
      // pre-transform selection mask from the GPU.
      // Move handles this itself in handleMoveDown.
      if (activeTool !== 'move' && engine && hasFloat(engine)) {
        persistentTransformRef.current = null;
        floatingSelectionRef.current = null;
        selectLayerAlpha(activeLayerId);
        const selAfter = useEditorStore.getState().selection;
        if (selAfter.active && selAfter.mask) {
          const maskBytes = new Uint8Array(selAfter.mask.buffer, selAfter.mask.byteOffset, selAfter.mask.byteLength);
          setSelectionMask(engine, maskBytes, selAfter.maskWidth, selAfter.maskHeight);
        }
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
    (e: ToolEvent) => {
      const state = stateRef.current;
      if (!state.drawing || !state.layerId) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const canvasPos = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top);
      const layerLocalPos: Point = {
        x: canvasPos.x - state.layerStartX,
        y: canvasPos.y - state.layerStartY,
      };

      // Tilt-shift drag (not tool-routed)
      if (state.tiltShiftDragging) {
        handleTiltShiftMove(canvasPos, e.metaKey);
        return;
      }

      // Liquify painting — all moves feed the displacement map.
      if (isLiquifyActive()) {
        const editorState = useEditorStore.getState();
        const layer = editorState.document.layers.find((l) => l.id === state.layerId);
        const layerPos = layer ? { x: canvasPos.x - layer.x, y: canvasPos.y - layer.y } : canvasPos;
        handleLiquifyMove(layerPos);
        return;
      }

      // Mesh warp drag (not tool-routed)
      if (state.meshWarpDragging) {
        handleMeshWarpMove(canvasPos);
        return;
      }

      // Transform handle drag (not tool-routed)
      if (state.transformHandle && state.transformStartState && state.startPoint) {
        handleTransformMove(state, canvasPos, e.metaKey);
        return;
      }

      if (!state.tool) return;

      const ctx: InteractionContext = {
        canvasPos, layerPos: layerLocalPos,
        shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
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
        const symmetryCenter = state.symmetryCenter;

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
          editor.pushHistory('Brush');

          // Restore the layer to its pre-stroke pixels so we can draw
          // the smooth stroke on a clean slate. We read the pre-stroke
          // snapshot directly from the undo stack (second-to-last entry)
          // instead of calling undo(), which would pop the stack.
          const undoStack = useEditorStore.getState().undoStack;
          const preStrokeEntry = undoStack[undoStack.length - 2];
          if (!preStrokeEntry || preStrokeEntry.kind !== 'pixels') return;
          const preStrokeHandle = preStrokeEntry.gpuSnapshots.get(layerId);
          if (preStrokeHandle !== undefined && preStrokeHandle !== 0xFFFFFFFF) {
            restoreLayerFromSnapshot(engine, layerId, preStrokeHandle);
          } else {
            // Empty sentinel — layer was blank before the stroke.
            // Clear it to transparent so the smooth stroke doesn't
            // draw on top of the freehand.
            uploadLayerPixels(engine, layerId, new Uint8Array(4), 1, 1, 0, 0);
          }

          const eng = getEngine();
          if (!eng) return;
          resetTrackedState(eng);
          const smoothState = useEditorStore.getState();
          flushLayerSync(smoothState);
          syncSelection(eng, smoothState.selection);

          beginStroke(eng, layerId);
          const arr = new Float64Array(result.sampledPoints.length * 2);
          for (let i = 0; i < result.sampledPoints.length; i++) {
            arr[i * 2] = result.sampledPoints[i]!.x;
            arr[i * 2 + 1] = result.sampledPoints[i]!.y;
          }
          gpuBrushDabBatch(eng, layerId, arr, size, hardness, r, g, b, color.a, opacity, 1, 0, 0, 0);

          if (symmetryCenter) {
            const { symmetryHorizontal, symmetryVertical, symmetryRadialSegments } = useToolSettingsStore.getState();
            if (symmetryHorizontal || symmetryVertical || symmetryRadialSegments >= 2) {
              const sym = {
                horizontal: symmetryHorizontal,
                vertical: symmetryVertical,
                centerX: symmetryCenter.x,
                centerY: symmetryCenter.y,
                radialSegments: symmetryRadialSegments,
              };
              for (const m of mirrorBatchPoints(arr, sym)) {
                gpuBrushDabBatch(eng, layerId, m, size, hardness, r, g, b, color.a, opacity, 1, 0, 0, 0);
              }
            }
          }

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

  const handleToolUp = useCallback((e: ToolEvent) => {
    // Cancel any in-progress hold-to-smooth timer
    cancelHoldTimer();

    const state = stateRef.current;

    // Tilt-shift drag end — short-circuit before regular tool teardown.
    if (state.tiltShiftDragging) {
      handleTiltShiftUp();
      stateRef.current = { ...INITIAL_STATE };
      return;
    }

    // Liquify stroke end — short-circuit before regular tool teardown.
    if (isLiquifyActive()) {
      handleLiquifyUp();
      stateRef.current = { ...INITIAL_STATE };
      return;
    }

    // Mesh warp drag end — short-circuit before regular tool teardown.
    if (state.meshWarpDragging) {
      handleMeshWarpUp();
      stateRef.current = { ...INITIAL_STATE };
      return;
    }

    if (!state.tool) {
      stateRef.current = { ...INITIAL_STATE };
      return;
    }

    const rect = containerRef.current?.getBoundingClientRect();
    const canvasPos = rect
      ? screenToCanvas(e.clientX - rect.left, e.clientY - rect.top)
      : { x: 0, y: 0 };
    const layerLocalPos: Point = {
      x: canvasPos.x - state.layerStartX,
      y: canvasPos.y - state.layerStartY,
    };

    const ctx: InteractionContext = {
      canvasPos, layerPos: layerLocalPos,
      shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
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

    if (PAINT_TOOLS.has(state.tool)) {
      useUIStore.getState().setIsStroking(false);
    }

    // Finalize GPU strokes at pointer-up. The stroke merge (endStroke)
    // runs synchronously so the composited result is visible immediately.
    // The GPU readback + LZ4 compression for the undo cache is deferred
    // to the next idle tick so it doesn't block the pointer-up frame.
    // If the user starts a new stroke before the cache is ready,
    // pushHistory falls through to a synchronous readback.
    if (PAINT_TOOLS.has(state.tool) && state.layerId && !state.maskMode) {
      const engine = getEngine();
      if (engine && state._usedGpuStroke) {
        endStroke(engine, state.layerId);
        clearJsPixelData(state.layerId);
        useEditorStore.getState().notifyRender();
        deferCacheLayerSnapshot(state.layerId);
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

    // Sync mask GPU texture back to store
    if (state.maskMode && state.layerId) {
      const isQuickMaskMode = useUIStore.getState().maskMode === 'quickMask';
      if (!isQuickMaskMode) {
        const engine = getEngine();
        if (engine) {
          const maskData = readMaskTexture(engine, state.layerId);
          if (maskData) {
            const layer = useEditorStore.getState().document.layers.find((l) => l.id === state.layerId);
            if (layer?.mask) {
              useEditorStore.getState().updateLayerMaskData(state.layerId, new Uint8ClampedArray(maskData));
            }
          }
        }
      }
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

  const nudgeSelection = useCallback((dx: number, dy: number) => {
    const editor = useEditorStore.getState();
    const sel = editor.selection;
    if (!sel.active || !sel.mask || !sel.bounds) return;

    const { width: docW, height: docH } = editor.document;
    const origMask = sel.mask;
    const newMask = new Uint8ClampedArray(docW * docH);
    for (let y = 0; y < docH; y++) {
      for (let x = 0; x < docW; x++) {
        const sx = x - dx;
        const sy = y - dy;
        if (sx >= 0 && sx < docW && sy >= 0 && sy < docH) {
          newMask[y * docW + x] = origMask[sy * docW + sx]!;
        }
      }
    }
    const newBounds = {
      x: sel.bounds.x + dx,
      y: sel.bounds.y + dy,
      width: sel.bounds.width,
      height: sel.bounds.height,
    };
    editor.setSelection(newBounds, newMask, docW, docH);
    useUIStore.getState().setTransform(createTransformState(newBounds));
    editor.notifyRender();
  }, []);

  return { handleToolDown, handleToolMove, handleToolUp, clearPersistentTransform, nudgeMove, nudgeSelection };
}
