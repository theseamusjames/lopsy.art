import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { destroyPaintingCanvas } from '../../engine/bitmap-cache';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  beginStroke, endStroke, hasFloat, dropFloat,
  uploadLayerPixels,
  restoreFromGpuSnapshot,
} from '../../engine-wasm/wasm-bridge';
import { flushLayerSync, resetTrackedState, syncDocumentSize, syncSelection } from '../../engine-wasm/engine-sync';
import { smoothStroke, HOLD_TIMEOUT_MS } from '../../tools/smooth-line/smooth-line';
import { brushDabBatchSymmetric } from './symmetric-dabs';
import { isSymmetryOn } from '../../tools/symmetry';
import { forgetLayerAlphaSelection } from './layer-alpha-selection';
import { useToolSettingsStore } from '../tool-settings-store';

import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { deferCacheLayerSnapshot } from '../store/history-slice';
import { scheduleMaskDataRefresh } from '../mask-data-sync';
import { syncLayerAfterFullSize } from '../sync-layer-after-full-size';
import type {
  InteractionState, InteractionContext,
  FloatingSelection, PersistentTransform, LastPaintPoint,
  PreToolDownGuard,
} from './interaction-types';
import {
  gestureUsedGpuStroke,
  INITIAL_INTERACTION_STATE,
  resolveDownGesture,
} from './interaction-types';
import { handleTransformDown, commitSelectionTransform, refuseGroupSelectionTransform } from './transform-handlers';
import { commitLayerTransform, markLayerTransformDirty } from './layer-transform';
import {
  handleMeshWarpDown,
  handleMeshWarpMove,
  handleMeshWarpUp,
} from './mesh-warp-handlers';
import {
  handleTiltShiftDown,
  handleTiltShiftMove,
  handleTiltShiftUp,
} from './tilt-shift-handlers';
import {
  handleLiquifyDown,
  handleLiquifyMove,
} from './liquify-handlers';
import { handleNudgeMove } from './move-handlers';
import { commitLiveFloat, flushNudgeMask, registerFloatSession } from './live-float';
import { nudgeHeldSelection } from './selection-nudge';
import { toolHandlers, handleTransformMove } from './tool-router';
// PAINT_TOOLS / GPU_TOOLS are derived from the tool registry, so adding a
// new paint or GPU tool is a single-file change at the descriptor.
import { PAINT_TOOLS, GPU_TOOLS, SELF_HISTORY_PAINT_TOOLS } from '../../tools/tool-registry';
import { pixelDataManager } from '../../engine/pixel-data-manager';
import { guardPixelWrite, toolIgnoresLayerLock, toolWritesRasterPixels } from '../../layers/paint-target';
import {
  finishTextBodyMove,
  handleTextTransformDown,
  handleTextTransformMove,
  handleTextTransformUp,
  refusePartialTextMove,
  releaseCoveringTextSelection,
} from './text-transform-handlers';
import { refuseMaskEditSelectionMove } from './mask-edit-move-guard';

import type { Point, Layer } from '../../types';

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

/** Maps a client point to the document; supplied by whoever drives the gesture. */
export interface GestureEnvironment {
  /** Rounded document position under the client point, or null with no canvas to measure against. */
  toCanvas(clientX: number, clientY: number): Point | null;
  /** Floored document pixel under the client point, or undefined when it cannot be measured. */
  toPixel(clientX: number, clientY: number): Point | undefined;
}

/** Where a stroke ended by hold-to-smooth may resume if the drag goes on. */
interface SmoothResumePoint {
  layerId: string;
  layerPoint: Point;
  clientX: number;
  clientY: number;
}

/** Screen-space travel after a hold-to-smooth that counts as "still drawing". */
const SMOOTH_RESUME_THRESHOLD_PX = 3;

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

interface Box<T> {
  current: T;
}

interface GestureSession {
  readonly stateRef: Box<InteractionState>;
  readonly persistentTransformRef: Box<PersistentTransform | null>;
  readonly floatingSelectionRef: Box<FloatingSelection | null>;
  readonly stampSourceRef: Box<Point | null>;
  readonly stampOffsetRef: Box<Point | null>;
  readonly lastPaintPointRef: Box<LastPaintPoint | null>;
  readonly holdTimerRef: Box<ReturnType<typeof setTimeout> | null>;
  readonly holdFrameRef: Box<number | null>;
  readonly moveSeqRef: Box<number>;
  readonly resumeAfterSmoothRef: Box<SmoothResumePoint | null>;
}

// One gesture session per page: the Move float it shares with live-float.ts
// is a page-wide singleton too.
const session: GestureSession = {
  stateRef: { current: { ...INITIAL_INTERACTION_STATE } },
  persistentTransformRef: { current: null },
  floatingSelectionRef: { current: null },
  stampSourceRef: { current: null },
  stampOffsetRef: { current: null },
  lastPaintPointRef: { current: null },
  holdTimerRef: { current: null },
  holdFrameRef: { current: null },
  moveSeqRef: { current: 0 },
  resumeAfterSmoothRef: { current: null },
};

export function resetGestureSessionForTest(): void {
  session.stateRef.current = { ...INITIAL_INTERACTION_STATE };
  session.persistentTransformRef.current = null;
  session.floatingSelectionRef.current = null;
  session.stampSourceRef.current = null;
  session.stampOffsetRef.current = null;
  session.lastPaintPointRef.current = null;
  session.holdTimerRef.current = null;
  session.holdFrameRef.current = null;
  session.moveSeqRef.current = 0;
  session.resumeAfterSmoothRef.current = null;
}

export function cancelHoldTimer(): void {
  if (session.holdTimerRef.current !== null) {
    clearTimeout(session.holdTimerRef.current);
    session.holdTimerRef.current = null;
  }
  if (session.holdFrameRef.current !== null) {
    cancelAnimationFrame(session.holdFrameRef.current);
    session.holdFrameRef.current = null;
  }
}

/** Registers the session's Move float with live-float; returns the unregister. */
export function attachGestureSession(): () => void {
  return registerFloatSession(session.floatingSelectionRef, session.persistentTransformRef);
}

function buildContext(
  e: ToolEvent, canvasPos: Point, layerPos: Point, activeLayerId: string, activeLayer: Layer, env: GestureEnvironment,
): InteractionContext {
  return {
    canvasPos, layerPos,
    pixelPos: env.toPixel(e.clientX, e.clientY),
    shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
    clickDetail: e.detail,
    clientX: e.clientX, clientY: e.clientY,
    activeLayerId, activeLayer,
    stateRef: session.stateRef, floatingSelectionRef: session.floatingSelectionRef, persistentTransformRef: session.persistentTransformRef,
    stampSourceRef: session.stampSourceRef, stampOffsetRef: session.stampOffsetRef, lastPaintPointRef: session.lastPaintPointRef,
  };
}

export function gestureDown(e: ToolEvent, env: GestureEnvironment): void {
  if (e.button !== 0) return;
  // A held arrow nudge leaves the store's mask behind the ants until
  // the hold ends; any tool that reads the selection needs it current.
  flushNudgeMask();

  // Cancel any pending hold-to-smooth timer from the previous stroke
  cancelHoldTimer();
  session.resumeAfterSmoothRef.current = null;

  const activeTool = useUIStore.getState().activeTool;
  const editorState = useEditorStore.getState();
  const activeLayerId = editorState.document.activeLayerId;
  if (!activeLayerId) return;

  const activeLayer = editorState.document.layers.find((l) => l.id === activeLayerId);
  if (!activeLayer) return;
  if (activeLayer.locked && !toolIgnoresLayerLock(activeTool)) return;

  // #768: refuse pixel writes on group / text layers before dispatching
  // to the tool handler. Without this every writer allocates a texture,
  // pushes a history row, and clears the redo stack for a change that
  // is either invisible (group) or wiped by the next re-render (text).
  const shapeOutput = useToolSettingsStore.getState().settings.shape.output;
  if (toolWritesRasterPixels(activeTool, { shapeOutput }) && !guardPixelWrite(activeLayer)) return;

  const canvasPos = env.toCanvas(e.clientX, e.clientY);
  if (!canvasPos) return;

  // Ctrl stands in for Cmd on Windows/Linux, where metaKey is the Super key.
  if (e.metaKey || e.ctrlKey) {
    const ts = useToolSettingsStore.getState();
    if (isSymmetryOn(ts)) {
      ts.setSymmetryCenter({ x: canvasPos.x, y: canvasPos.y });
      return;
    }
  }

  for (const guard of PRE_TOOL_DOWN_GUARDS) {
    const next = guard(canvasPos, activeLayerId);
    if (next) {
      session.stateRef.current = next;
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

  if (useGpu) {
    // GPU path: no JS pixel data needed. The engine handles the
    // layer texture directly — no expand, no upload, no round-trip.
    // This preserves 16-bit float precision throughout.

    if (isPaintTool) {
      const currentState = useEditorStore.getState();
      syncDocumentSize(engine, currentState.document.width, currentState.document.height);
      flushLayerSync(currentState);
      syncSelection(engine, currentState.selection);
      // Dodge/Burn, Sponge, Clone Stamp and Healing push their own
      // correctly-labeled history entry from their own down-handler
      // (or, for a clone/healing source-set click, correctly push
      // nothing since no pixels changed). Pushing a generic entry
      // here too would double up as a phantom 'Eraser' row on top
      // of the tool's real one (#887).
      if (!SELF_HISTORY_PAINT_TOOLS.has(activeTool)) {
        const toolLabel = activeTool === 'brush'
          ? 'Brush'
          : activeTool === 'pencil'
            ? 'Pencil'
            : activeTool === 'spray'
              ? 'Spray'
              : 'Eraser';
        useEditorStore.getState().pushHistory(toolLabel);
      }
      beginStroke(engine, activeLayerId);

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
  const ctx = buildContext(e, canvasPos, layerPos, activeLayerId, expandedLayer, env);
  if (useGpu) {
    ctx.isStrokeContinuation = true;
  }

  // Transform handle interaction (pre-tool dispatch). The handler
  // already populates `gesture` with the transform variant's required
  // data (handle, startState, startAngle, selectionOnly), so no
  // post-assignment mutation is needed here.
  if (activeTool === 'move') {
    // A live text layer gets its own handles: dragging one edits the
    // layer's transform and re-renders the glyphs, so the text stays
    // editable and repeated transforms never compound.
    const textTransformResult = handleTextTransformDown(ctx);
    if (textTransformResult) {
      session.stateRef.current = textTransformResult;
      return;
    }
    if (refusePartialTextMove()) return;
    if (refuseMaskEditSelectionMove()) return;
    if (refuseGroupSelectionTransform(ctx)) return;
    releaseCoveringTextSelection();
  }

  const transformResult = handleTransformDown(ctx);
  if (transformResult) {
    session.stateRef.current = transformResult;
    return;
  }

  // Commit any active GPU float (from transform or move) before dispatching
  // to other tools, keeping the selection on screen: the moved marquee,
  // or the transformed one. Re-selecting the whole layer's alpha here
  // grew the marquee over everything on the layer, so a Marquee press
  // dragged that outline instead of starting a new selection.
  // Move handles this itself in handleMoveDown.
  if (toolWritesRasterPixels(activeTool, { shapeOutput })) forgetLayerAlphaSelection();

  if (activeTool !== 'move' && engine && hasFloat(engine)) {
    commitLiveFloat();

    // After dropping the float, the engine may have resized/repositioned
    // the layer texture. Sync JS bounds so that syncLayers doesn't push
    // stale dimensions back to the engine.
    const synced = syncLayerAfterFullSize(engine, activeLayerId);
    if (synced) {
      expandedLayer = synced;
      layerPos = { x: canvasPos.x - expandedLayer.x, y: canvasPos.y - expandedLayer.y };
    }
  }

  // Rebuild context if the float commit updated layer position/bounds.
  const finalCtx = (expandedLayer !== ctx.activeLayer || layerPos !== ctx.layerPos)
    ? buildContext(e, canvasPos, layerPos, activeLayerId, expandedLayer, env)
    : ctx;
  if (useGpu) {
    finalCtx.isStrokeContinuation = true;
  }

  const handler = toolHandlers[activeTool];
  const newState = handler?.down?.(finalCtx);
  if (newState) {
    session.stateRef.current = resolveDownGesture(newState, {
      isPaintTool,
      usedGpuStroke: !!useGpuStroke,
    });
  }
}

export function gestureMove(e: ToolEvent, env: GestureEnvironment): void {
  session.moveSeqRef.current++;
  const resume = session.resumeAfterSmoothRef.current;
  if (resume && !session.stateRef.current.drawing) {
    // Hold-to-smooth ended the stroke while the button is still down.
    // Moving on resumes painting from the hold point instead of
    // silently dropping the rest of the drag (#983).
    if (Math.hypot(e.clientX - resume.clientX, e.clientY - resume.clientY) < SMOOTH_RESUME_THRESHOLD_PX) return;
    session.resumeAfterSmoothRef.current = null;
    session.lastPaintPointRef.current = { point: resume.layerPoint, layerId: resume.layerId };
    gestureDown({
      clientX: e.clientX,
      clientY: e.clientY,
      button: 0,
      shiftKey: true,
      altKey: e.altKey,
      metaKey: false,
      ctrlKey: false,
    }, env);
    return;
  }

  const state = session.stateRef.current;
  if (!state.drawing || !state.layerId) return;

  const canvasPos = env.toCanvas(e.clientX, e.clientY);
  if (!canvasPos) return;

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
      session.stateRef.current = handleLiquifyMove(state, layerPos);
      return;
    }
    case 'meshWarp':
      handleMeshWarpMove(canvasPos);
      return;
    // Ctrl stands in for Cmd (angle snap, aspect lock) on Windows/Linux,
    // where metaKey is the Super key the OS keeps for itself.
    case 'transform':
      handleTransformMove(state, canvasPos, e.metaKey || e.ctrlKey);
      return;
    case 'textTransform':
      handleTextTransformMove(state, canvasPos, e.metaKey || e.ctrlKey);
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
    pixelPos: env.toPixel(e.clientX, e.clientY),
    shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
    clientX: e.clientX, clientY: e.clientY,
    activeLayerId: state.layerId,
    activeLayer: useEditorStore.getState().document.layers.find((l) => l.id === state.layerId)!,
    stateRef: session.stateRef, floatingSelectionRef: session.floatingSelectionRef, persistentTransformRef: session.persistentTransformRef,
    stampSourceRef: session.stampSourceRef, stampOffsetRef: session.stampOffsetRef, lastPaintPointRef: session.lastPaintPointRef,
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

    const holdClientX = e.clientX;
    const holdClientY = e.clientY;
    const holdLayerPoint = state.lastPoint ?? strokePoints[strokePoints.length - 1]!;

    session.holdTimerRef.current = setTimeout(() => {
      session.holdTimerRef.current = null;
      // A main-thread stall can fire this timer while pointer-moves are
      // still queued behind it. Input is dispatched before the next
      // frame's callbacks, so only smooth if no move arrived by then
      // (#983).
      const seqAtTimeout = session.moveSeqRef.current;
      session.holdFrameRef.current = requestAnimationFrame(() => {
        session.holdFrameRef.current = null;
        if (session.moveSeqRef.current !== seqAtTimeout) return;
        if (session.stateRef.current !== state) return;
        applyHoldSmooth();
      });
    }, HOLD_TIMEOUT_MS);

    const applyHoldSmooth = () => {
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
      resetTrackedState(eng, { preserveContentRefs: true });
      const smoothState = useEditorStore.getState();
      flushLayerSync(smoothState);
      syncSelection(eng, smoothState.selection);

      beginStroke(eng, layerId);
      const arr = new Float64Array(result.sampledPoints.length * 2);
      for (let i = 0; i < result.sampledPoints.length; i++) {
        arr[i * 2] = result.sampledPoints[i]!.x;
        arr[i * 2 + 1] = result.sampledPoints[i]!.y;
      }
      const { symmetryHorizontal, symmetryVertical, symmetryRadialSegments } = useToolSettingsStore.getState();
      const hasCenter = Boolean(symmetryCenter);
      const sym = {
        horizontal: hasCenter && symmetryHorizontal,
        vertical: hasCenter && symmetryVertical,
        centerX: symmetryCenter?.x ?? 0,
        centerY: symmetryCenter?.y ?? 0,
        radialSegments: hasCenter ? symmetryRadialSegments : 0,
      };
      brushDabBatchSymmetric(eng, layerId, arr, sym, {
        size, hardness, r, g, b, a: color.a, opacity,
        flow: 1, sizeJitter: 0, angleJitter: 0, opacityJitter: 0,
      });

      endStroke(eng, layerId);

      clearJsPixelData(layerId);
      useEditorStore.getState().notifyRender();

      // Mark the stroke as done so mouseup becomes a no-op
      session.stateRef.current = { ...INITIAL_INTERACTION_STATE };
      session.lastPaintPointRef.current = { point: holdLayerPoint, layerId };
      useUIStore.getState().setLastPaintPoint({ point: holdLayerPoint, layerId });
      session.resumeAfterSmoothRef.current = {
        layerId,
        layerPoint: holdLayerPoint,
        clientX: holdClientX,
        clientY: holdClientY,
      };
    };
  }
}

export function gestureUp(e: ToolEvent, env: GestureEnvironment): void {
  // Cancel any in-progress hold-to-smooth timer
  cancelHoldTimer();
  session.resumeAfterSmoothRef.current = null;

  const state = session.stateRef.current;

  switch (state.gesture.kind) {
    case 'tiltShift':
      handleTiltShiftUp();
      session.stateRef.current = { ...INITIAL_INTERACTION_STATE };
      return;
    case 'liquify':
      session.stateRef.current = { ...INITIAL_INTERACTION_STATE };
      return;
    case 'meshWarp':
      handleMeshWarpUp();
      session.stateRef.current = { ...INITIAL_INTERACTION_STATE };
      return;
    case 'textTransform':
      handleTextTransformUp(state);
      session.stateRef.current = { ...INITIAL_INTERACTION_STATE };
      return;
    case 'transform':
      if (state.gesture.selectionOnly) {
        // The drag only moved the marquee preview; build the mask once now.
        commitSelectionTransform();
        useUIStore.getState().setActiveTransformHandle(null);
        session.stateRef.current = { ...INITIAL_INTERACTION_STATE };
        return;
      }
      if (state.gesture.isLayerTransform) {
        // The session stays live, like the Move tool's float, so a
        // further drag resamples the original pixels.
        useUIStore.getState().setActiveTransformHandle(null);
        markLayerTransformDirty();
        session.stateRef.current = { ...INITIAL_INTERACTION_STATE };
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
    session.stateRef.current = { ...INITIAL_INTERACTION_STATE };
    return;
  }

  const canvasPos = env.toCanvas(e.clientX, e.clientY) ?? { x: 0, y: 0 };
  const layerLocalPos: Point = {
    x: canvasPos.x - state.layerStartX,
    y: canvasPos.y - state.layerStartY,
  };

  const ctx: InteractionContext = {
    canvasPos, layerPos: layerLocalPos,
    pixelPos: env.toPixel(e.clientX, e.clientY),
    shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
    clientX: e.clientX, clientY: e.clientY,
    activeLayerId: state.layerId ?? '',
    activeLayer: useEditorStore.getState().document.layers.find((l) => l.id === state.layerId)!,
    stateRef: session.stateRef, floatingSelectionRef: session.floatingSelectionRef, persistentTransformRef: session.persistentTransformRef,
    stampSourceRef: session.stampSourceRef, stampOffsetRef: session.stampOffsetRef, lastPaintPointRef: session.lastPaintPointRef,
  };

  toolHandlers[state.tool]?.up?.(ctx, state);
  if (state.tool === 'move') finishTextBodyMove();

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
    session.lastPaintPointRef.current = { point: state.lastPoint, layerId: state.layerId };
    useUIStore.getState().setLastPaintPoint({ point: state.lastPoint, layerId: state.layerId });
  }

  // Finalize transform handle drag: keep the GPU float alive so subsequent
  // grabs can re-transform from the original pixels without degradation.
  // The float is only dropped when the user commits (clearPersistentTransform).
  if (state.gesture.kind === 'transform') {
    useUIStore.getState().setActiveTransformHandle(null);
    // compositeFloatAffine/Perspective rewrote the layer texture during the
    // drag; mark it dirty so the next pushHistory snapshots it rather than
    // reusing the previous Transform entry's handle (#925).
    if (!state.gesture.selectionOnly && state.layerId) clearJsPixelData(state.layerId);
  }

  // Clear gradient preview
  if (state.tool === 'gradient') {
    useUIStore.getState().setGradientPreview(null);
  }

  // Refresh the JS copy of the mask once the GPU has drained the
  // stroke's work (#756). Nothing on the next gesture waits for it: undo
  // snapshots masks on the GPU (#780), and the few readers that need
  // current bytes (save, export, duplicate) materialize on demand.
  if (state.maskMode && state.layerId) {
    const isQuickMaskMode = useUIStore.getState().maskMode === 'quickMask';
    if (!isQuickMaskMode) scheduleMaskDataRefresh(state.layerId);
  }

  session.stateRef.current = { ...INITIAL_INTERACTION_STATE };
}

export function clearPersistentTransform(): void {
  session.persistentTransformRef.current = null;
  session.floatingSelectionRef.current = null;

  // A multi-layer transform ends first, so its text layers re-render.
  commitLayerTransform();
  // Drop GPU float — the layer texture already has the committed result.
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
}

export function nudgeMove(dx: number, dy: number): void {
  handleNudgeMove(dx, dy, session.floatingSelectionRef, session.persistentTransformRef);
}

export function nudgeSelection(dx: number, dy: number): void {
  nudgeHeldSelection('selection', dx, dy);
}
