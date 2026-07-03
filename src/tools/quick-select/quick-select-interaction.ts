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

// Coalesce pointer-moves to at most one applyQuickSelectStroke per
// animation frame. Every stroke call allocates a docW * docH mask and
// forces syncSelection to re-upload the whole selection texture to the
// GPU, so on a 4K canvas with a fast pointer stream we were doing
// multiple full-doc CPU + GPU passes per rendered frame (#643).
let pendingMove: { x: number; y: number } | null = null;
let rafHandle: number | null = null;

function drainPendingMove(): void {
  rafHandle = null;
  const pt = pendingMove;
  pendingMove = null;
  if (!pt || !session) return;

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
      points: [pt],
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

export function handleQuickSelectMove(
  state: InteractionState,
  canvasPos: { x: number; y: number },
): void {
  if (!session || !state.lastPoint) return;

  pendingMove = canvasPos;
  if (rafHandle !== null) return;
  const raf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb: FrameRequestCallback): number => setTimeout(() => cb(0), 16) as unknown as number;
  rafHandle = raf(drainPendingMove);
}

export function handleQuickSelectUp(): void {
  // Flush any pending move so the final cursor position gets committed
  // to the selection mask before the drag ends.
  if (rafHandle !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  if (pendingMove) drainPendingMove();
  session = null;
}

/** Test hook: reset the coalesce state so tests can start fresh. */
export function _resetQuickSelectThrottleForTests(): void {
  pendingMove = null;
  if (rafHandle !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(rafHandle);
  }
  rafHandle = null;
  session = null;
}
