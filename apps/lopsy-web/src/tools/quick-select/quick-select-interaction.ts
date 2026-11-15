/**
 * Quick Selection tool — interaction handler.
 *
 * Asks the GPU for the layer's pixels on pointer-down and applies
 * applyQuickSelectStroke on every pointer-move to grow/shrink the
 * selection mask in real time. The stroke begins at once: points that
 * arrive before the pixels do are queued and applied when they land.
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
import { coalesceToAnimationFrame } from '../../utils/raf-coalesce';

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

/** A stroke whose pixels are still on their way from the GPU. */
interface AwaitedStroke {
  /** The pointer came up before the pixels arrived. */
  hasEnded: boolean;
}

let awaited: AwaitedStroke | null = null;

export function handleQuickSelectDown(ctx: InteractionContext): InteractionState | undefined {
  const engine = getEngine();
  if (!engine) return undefined;

  const { canvasPos, activeLayerId } = ctx;
  const editorState = useEditorStore.getState();
  const { width: docW, height: docH } = editorState.document;
  const priorMask = editorState.selection.mask
    ? new Uint8ClampedArray(editorState.selection.mask)
    : null;

  const stroke: AwaitedStroke = { hasEnded: false };
  awaited = stroke;
  session = null;
  // The click point seeds the selection; it is applied with any moves
  // that queue behind it once the pixels are here.
  pendingPoints.length = 0;
  pendingPoints.push(canvasPos);

  // Same read the wand tool uses
  readLayerPixelsForFill(engine, activeLayerId)
    .then((rawPixels) => {
      if (awaited !== stroke) return;
      awaited = null;
      session = {
        pixels: new Uint8ClampedArray(rawPixels.buffer, rawPixels.byteOffset, rawPixels.byteLength),
        docWidth: docW,
        docHeight: docH,
        strokeMask: priorMask ? new Uint8ClampedArray(priorMask) : new Uint8ClampedArray(docW * docH),
        priorMask,
      };
      applyPendingPoints();
      if (stroke.hasEnded) session = null;
    })
    .catch(() => {
      if (awaited !== stroke) return;
      awaited = null;
      pendingPoints.length = 0;
    });

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

/**
 * Applying a quick-select stroke allocates a fresh docW × docH mask and
 * hands it to `setSelection`; on the next frame `syncSelection` uploads
 * the entire mask to the GPU. Coalescing per-move stroke application to
 * rAF caps the mask alloc + GPU upload at once per rendered frame
 * (issue #643).
 */
const pendingPoints: { x: number; y: number }[] = [];

function applyPendingPoints(): void {
  if (!session || pendingPoints.length === 0) return;

  const { quickSelect } = useToolSettingsStore.getState().settings;
  const editorState = useEditorStore.getState();

  const points = pendingPoints.splice(0, pendingPoints.length);

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

const coalescedApply = coalesceToAnimationFrame(applyPendingPoints);

export function handleQuickSelectMove(
  state: InteractionState,
  canvasPos: { x: number; y: number },
): void {
  if ((!session && !awaited) || !state.lastPoint) return;
  pendingPoints.push(canvasPos);
  coalescedApply();
}

export function handleQuickSelectUp(): void {
  // The pixels are not here yet: the queued points are applied, and the
  // session dropped, when they arrive.
  if (awaited) {
    awaited.hasEnded = true;
    return;
  }
  // Flush any pending stroke application before dropping the session,
  // otherwise the last few move samples would be silently lost.
  coalescedApply.flush();
  session = null;
}

/** Test seam: flush any pending quick-select stroke application. */
export function flushQuickSelect(): void {
  coalescedApply.flush();
}
