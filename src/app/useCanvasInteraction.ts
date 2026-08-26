import { useCallback, useRef, useEffect } from 'react';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { invalidateBitmapCache, createPaintingCanvas, destroyPaintingCanvas } from '../engine/bitmap-cache';
import { getEngine } from '../engine-wasm/engine-state';
import {
  beginStroke, endStroke, hasFloat, dropFloat,
  applyBrushDabBatch as gpuBrushDabBatch,
  uploadLayerPixels,
  setSelectionMask,
  readMaskTexture,
  restoreFromGpuSnapshot,
} from '../engine-wasm/wasm-bridge';
import { flushLayerSync, resetTrackedState, seedMaskDataRef, syncDocumentSize, syncSelection } from '../engine-wasm/engine-sync';
import { smoothStroke, HOLD_TIMEOUT_MS } from '../tools/smooth-line/smooth-line';
import { mirrorBatchPoints } from '../tools/symmetry';
import { useToolSettingsStore } from './tool-settings-store';

import { clearJsPixelData } from './store/clear-js-pixel-data';
import { deferCacheLayerSnapshot } from './store/history-slice';
import { clearPendingStroke } from './interactions/pending-stroke';
import { syncLayerAfterFullSize } from './sync-layer-after-full-size';
import type {
  InteractionState, InteractionContext,
  FloatingSelection, PersistentTransform, LastPaintPoint,
  PreToolDownGuard,
} from './interactions/interaction-types';
import {
  gestureUsedGpuStroke,
  INITIAL_INTERACTION_STATE,
  resolveDownGesture,
} from './interactions/interaction-types';
import { handleTransformDown, flushSelectionTransform } from './interactions/transform-handlers';
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
  handleLiquifyDown,
  handleLiquifyMove,
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
  /** Click count (MouseEvent.detail); 2 for a double-click. */
  readonly detail?: number;
}

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

/**
 * Pre-tool down guards run in priority order on mousedown — the first
 * one to return a non-null state claims the gesture and the dispatcher
 * skips regular tool routing. Adding a new pre-tool gesture is now a
 * one-line registry change (#444).
 *
 * Liquify is first because an active liquify session takes the entire
 * canvas (no hit-test); the other two only claim the gesture when their
 * overlay handles are actually hit.
 */
const PRE_TOOL_DOWN_GUARDS: readonly PreToolDownGuard[] = [
  handleLiquifyDown,
  handleTiltShiftDown,
  handleMeshWarpDown,
];

export function useCanvasInteraction(
  screenToCanvas: (screenX: number, screenY: number) => Point,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const stateRef = useRef<InteractionState>({ ...INITIAL_INTERACTION_STATE });
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
    (e: ToolEvent, canvasPos: Point, layerPos: Point, activeLayerId: string, activeLayer: Layer): InteractionContext => ({
      canvasPos, layerPos,
      shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
      clickDetail: e.detail,
      clientX: e.clientX, clientY: e.clientY,
      activeLayerId, activeLayer,
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

      for (const guard of PRE_TOOL_DOWN_GUARDS) {
        const next = guard(canvasPos, activeLayerId);
        if (next) {
          stateRef.current = next;
          return;
        }
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
      } else {
        // Finalize any pending GPU stroke so the layer texture includes it
        // before we read pixel data back for non-GPU tools (e.g. move).
        finalizePendingStroke(pendingStrokeRef);

        // Only expand the active layer's pixel data for tools that actually
        // read/write it via JS. Tools like text, crop, path, eyedropper,
        // and selection tools don't need pixel data and expanding would
        // destructively change layer bounds before pushHistory captures
        // them — causing undo to restore the wrong positions.
        // Move is excluded: selection moves use the float system (GPU-only)
        // and non-selection moves call expandLayerForEditing in the handler.
        // Fill is included: its GPU fast paths call the engine's
        // ensure_layer_full_size internally, which resets the engine layer
        // descriptor to a doc-sized texture at the origin. expandLayerForEditing
        // performs the matching Zustand reconciliation (x/y AND width/height via
        // withLayerBounds); without it the store keeps the pre-fill offset and
        // engine-sync re-applies it, double-offsetting the filled content (#722).
        // Quick Mask Mode paints on the quick mask buffer (not the layer), so
        // no pixel data expansion is needed — same as non-paint tools.
        // Layer-mask edit mode paints on the mask texture via gpuMaskDabBatch
        // and never reads the layer's own RGBA, so expanding + uploading the
        // full-res layer buffer is pure waste (71.64 MB / stroke at 4K, #733).
        // Fill is not on this list either: the fill handler owns its own
        // doc-space coordinate math and reconciles JS bounds after the engine's
        // ensure_layer_full_size via syncLayerAfterFullSize — no RGBA
        // round-trip needed (#742).
        const needsPixelData = isPaintTool && !isQuickMaskMode && !maskEditMode;
        if (needsPixelData) {
          const imageData = editorState.expandLayerForEditing(activeLayerId);
          expandedLayer = useEditorStore.getState().document.layers.find((l) => l.id === activeLayerId)!;
          layerPos = { x: canvasPos.x - expandedLayer.x, y: canvasPos.y - expandedLayer.y };
          invalidateBitmapCache(activeLayerId);
          createPaintingCanvas(activeLayerId, imageData);
        }
      }
      const ctx = buildContext(e, canvasPos, layerPos, activeLayerId, expandedLayer);
      if (useGpu) {
        ctx.isStrokeContinuation = true;
      }

      // Transform handle interaction (pre-tool dispatch). The handler
      // already populates `gesture` with the transform variant's required
      // data (handle, startState, startAngle, selectionOnly), so no
      // post-assignment mutation is needed here.
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

        // After dropping the float, the engine may have resized/repositioned
        // the layer texture. Sync JS bounds so that syncLayers doesn't push
        // stale dimensions back to the engine.
        const synced = syncLayerAfterFullSize(engine, activeLayerId);
        if (synced) {
          expandedLayer = synced;
          layerPos = { x: canvasPos.x - expandedLayer.x, y: canvasPos.y - expandedLayer.y };
        }

        const selAfter = useEditorStore.getState().selection;
        if (selAfter.active && selAfter.mask) {
          const maskBytes = new Uint8Array(selAfter.mask.buffer, selAfter.mask.byteOffset, selAfter.mask.byteLength);
          setSelectionMask(engine, maskBytes, selAfter.maskWidth, selAfter.maskHeight);
        }
      }

      // Rebuild context if the float commit updated layer position/bounds.
      const finalCtx = (expandedLayer !== ctx.activeLayer || layerPos !== ctx.layerPos)
        ? buildContext(e, canvasPos, layerPos, activeLayerId, expandedLayer)
        : ctx;
      if (useGpu) {
        finalCtx.isStrokeContinuation = true;
      }

      const handler = toolHandlers[activeTool];
      const newState = handler?.down?.(finalCtx);
      if (newState) {
        stateRef.current = resolveDownGesture(newState, {
          isPaintTool,
          usedGpuStroke: !!useGpuStroke,
        });
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

      switch (state.gesture.kind) {
        case 'tiltShift':
          handleTiltShiftMove(canvasPos, e.metaKey);
          return;
        case 'liquify': {
          const editorState = useEditorStore.getState();
          const layer = editorState.document.layers.find((l) => l.id === state.layerId);
          const layerPos = layer ? { x: canvasPos.x - layer.x, y: canvasPos.y - layer.y } : canvasPos;
          stateRef.current = handleLiquifyMove(state, layerPos);
          return;
        }
        case 'meshWarp':
          handleMeshWarpMove(canvasPos);
          return;
        case 'transform':
          handleTransformMove(state, canvasPos, e.metaKey);
          return;
        case 'idle':
          return;
        case 'paint':
        case 'tool':
        case 'move':
          break;
      }

      if (!state.tool) return;

      const ctx: InteractionContext = {
        canvasPos, layerPos: layerLocalPos,
        shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
        clientX: e.clientX, clientY: e.clientY,
        activeLayerId: state.layerId,
        activeLayer: useEditorStore.getState().document.layers.find((l) => l.id === state.layerId)!,
        screenToCanvas, containerRef,
        stateRef, floatingSelectionRef, persistentTransformRef,
        stampSourceRef, stampOffsetRef, lastPaintPointRef,
      };

      toolHandlers[state.tool]?.move?.(ctx, state);

      // Hold-to-smooth: reset timer on every move during a brush stroke.
      // If the cursor stays still (no new mousemove) for HOLD_TIMEOUT_MS, smooth.
      if (
        state.tool === 'brush'
        && gestureUsedGpuStroke(state.gesture)
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
          const brush = toolSettings.settings.brush;
          const size = brush.size;
          const hardness = brush.hardness / 100;
          const opacity = brush.opacity / 100;
          const color = toolSettings.foregroundColor;
          const r = color.r / 255;
          const g = color.g / 255;
          const b = color.b / 255;
          const spacing = Math.max(1, size * brush.spacing / 100);

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
            restoreFromGpuSnapshot(engine, layerId, preStrokeHandle);
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
          stateRef.current = { ...INITIAL_INTERACTION_STATE };
        }, HOLD_TIMEOUT_MS);
      }
    },
    [screenToCanvas, containerRef, cancelHoldTimer],
  );

  const handleToolUp = useCallback((e: ToolEvent) => {
    // Cancel any in-progress hold-to-smooth timer
    cancelHoldTimer();

    const state = stateRef.current;

    switch (state.gesture.kind) {
      case 'tiltShift':
        handleTiltShiftUp();
        stateRef.current = { ...INITIAL_INTERACTION_STATE };
        return;
      case 'liquify':
        stateRef.current = { ...INITIAL_INTERACTION_STATE };
        return;
      case 'meshWarp':
        handleMeshWarpUp();
        stateRef.current = { ...INITIAL_INTERACTION_STATE };
        return;
      case 'transform':
        if (state.gesture.selectionOnly) {
          // Drain any pointer-move that's still parked in the coalescer's
          // rAF slot — otherwise the final drag position is dropped if the
          // browser fires pointer-up before the next frame boundary.
          flushSelectionTransform();
          useUIStore.getState().setActiveTransformHandle(null);
          stateRef.current = { ...INITIAL_INTERACTION_STATE };
          return;
        }
        break;
      case 'idle':
      case 'paint':
      case 'tool':
      case 'move':
        break;
    }

    if (!state.tool) {
      stateRef.current = { ...INITIAL_INTERACTION_STATE };
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
      if (engine && gestureUsedGpuStroke(state.gesture)) {
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

    // Save last paint point for shift+click line drawing. Mirror the ref
    // into ui-store so the pointer-move handler can compute a preview line
    // while shift is held before the next click (#666).
    if (PAINT_TOOLS.has(state.tool) && state.lastPoint && state.layerId) {
      lastPaintPointRef.current = { point: state.lastPoint, layerId: state.layerId };
      useUIStore.getState().setLastPaintPoint({ point: state.lastPoint, layerId: state.layerId });
    }

    // Finalize transform handle drag: keep the GPU float alive so subsequent
    // grabs can re-transform from the original pixels without degradation.
    // The float is only dropped when the user commits (clearPersistentTransform).
    if (state.gesture.kind === 'transform') {
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
              const seeded = new Uint8ClampedArray(maskData);
              useEditorStore.getState().updateLayerMaskData(state.layerId, seeded);
              // These bytes just came *from* the GPU — record the readback's
              // reference as the tracked one so the next frame's syncLayers
              // doesn't upload them straight back (#734).
              seedMaskDataRef(engine, state.layerId, seeded);
            }
          }
        }
      }
    }

    stateRef.current = { ...INITIAL_INTERACTION_STATE };
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
