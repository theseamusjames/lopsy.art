/**
 * Quick Selection tool — interaction handler.
 *
 * Reads layer pixels from the GPU on pointer-down, then applies
 * applyQuickSelectStroke on every pointer-move to grow/shrink the
 * selection mask in real time.
 */

import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { useUIStore } from '../../app/ui-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { readLayerPixelsForFill } from '../../engine-wasm/wasm-bridge';
import { selectionBounds } from '../../selection/selection';
import { createTransformState } from '../transform/transform';
import { applyQuickSelectStroke } from './quick-select';

/** Module-local stroke accumulator — avoids cluttering InteractionState. */
interface QuickSelectSession {
  /** RGBA pixels read from GPU at stroke start. */
  pixels: Uint8ClampedArray;
  docWidth: number;
  docHeight: number;
  /** Running selection mask being built for this stroke. */
  strokeMask: Uint8ClampedArray;
  /** The mask that existed before this stroke started (for subtract preview). */
  priorMask: Uint8ClampedArray | null;
}

let session: QuickSelectSession | null = null;

// Per-frame coalescing of pointer-move events (issue #643). Every move used
// to run applyQuickSelectStroke — a full-document CPU pass that allocates a
// fresh docW×docH mask — even though syncSelection only pushes one mask per
// animation frame. Buffering the points and draining in rAF collapses that
// per-move CPU cost to per-frame.
let pendingPoints: { x: number; y: number }[] = [];
let scheduledHandle: number | null = null;

function flushPendingStroke(): void {
  scheduledHandle = null;
  if (!session || pendingPoints.length === 0) return;

  const points = pendingPoints;
  pendingPoints = [];

  const { quickSelect } = useToolSettingsStore.getState().settings;
  const editorState = useEditorStore.getState();

  const updatedMask = applyQuickSelectStroke(
    {
      pixels: session.pixels,
      width: session.docWidth,
      height: session.docHeight,
      radius: quickSelect.size,
      tolerance: quickSelect.tolerance,
      edgeStrength: quickSelect.edgeStrength,
    },
    {
      points,
      existingMask: session.strokeMask,
      mode: quickSelect.mode,
    },
  );

  session.strokeMask = updatedMask;

  const bounds = selectionBounds(updatedMask, session.docWidth, session.docHeight);
  if (bounds) {
    editorState.setSelection(bounds, updatedMask, session.docWidth, session.docHeight);
    useUIStore.getState().setTransform(createTransformState(bounds));
  } else {
    editorState.clearSelection();
  }
}

function scheduleStrokeFlush(): void {
  if (scheduledHandle !== null) return;
  if (typeof requestAnimationFrame === 'function') {
    scheduledHandle = requestAnimationFrame(flushPendingStroke);
  } else {
    scheduledHandle = 1;
    queueMicrotask(flushPendingStroke);
  }
}

function cancelStrokeFlush(): void {
  if (scheduledHandle !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(scheduledHandle);
  }
  scheduledHandle = null;
}

export function handleQuickSelectDown(ctx: InteractionContext): InteractionState | undefined {
  const engine = getEngine();
  if (!engine) return undefined;

  const { canvasPos, activeLayerId } = ctx;
  const editorState = useEditorStore.getState();
  const { width: docW, height: docH } = editorState.document;

  // Read layer pixels from GPU (same path the wand tool uses)
  let rawPixels: Uint8Array;
  try {
    rawPixels = readLayerPixelsForFill(engine, activeLayerId);
  } catch {
    return undefined;
  }

  const { quickSelect } = useToolSettingsStore.getState().settings;
  const priorMask = editorState.selection.mask
    ? new Uint8ClampedArray(editorState.selection.mask)
    : null;
  const strokeMask = priorMask
    ? new Uint8ClampedArray(priorMask)
    : new Uint8ClampedArray(docW * docH);

  // Seed the selection with the single click point immediately
  const seedMask = applyQuickSelectStroke(
    {
      pixels: new Uint8ClampedArray(rawPixels.buffer, rawPixels.byteOffset, rawPixels.byteLength),
      width: docW,
      height: docH,
      radius: quickSelect.size,
      tolerance: quickSelect.tolerance,
      edgeStrength: quickSelect.edgeStrength,
    },
    {
      points: [canvasPos],
      existingMask: strokeMask,
      mode: quickSelect.mode,
    },
  );

  session = {
    pixels: new Uint8ClampedArray(rawPixels.buffer, rawPixels.byteOffset, rawPixels.byteLength),
    docWidth: docW,
    docHeight: docH,
    strokeMask: seedMask,
    priorMask,
  };
  pendingPoints = [];

  // Update live selection
  const bounds = selectionBounds(seedMask, docW, docH);
  if (bounds) {
    editorState.setSelection(bounds, seedMask, docW, docH);
    useUIStore.getState().setTransform(createTransformState(bounds));
  } else {
    editorState.clearSelection();
  }

  return {
    drawing: true,
    lastPoint: canvasPos,
    layerId: activeLayerId,
    tool: 'quick-select',
    startPoint: canvasPos,
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleQuickSelectMove(
  state: InteractionState,
  canvasPos: { x: number; y: number },
): void {
  if (!session || !state.lastPoint) return;
  pendingPoints.push(canvasPos);
  scheduleStrokeFlush();
}

export function handleQuickSelectUp(): void {
  // Drain any pending points so the final stroke position isn't lost when
  // pointer-up fires before the coalescing rAF.
  if (session && pendingPoints.length > 0) {
    cancelStrokeFlush();
    flushPendingStroke();
  } else {
    cancelStrokeFlush();
    pendingPoints = [];
  }
  session = null;
}

/** Test-only helper: run any pending coalesced stroke work synchronously. */
export function __flushQuickSelectStrokeForTest(): void {
  cancelStrokeFlush();
  flushPendingStroke();
}
