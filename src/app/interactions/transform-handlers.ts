import {
  hitTestHandle,
  isScaleHandle,
  isRotateHandle,
  computeScale,
  computeRotation,
  computeSkew,
  computeDistort,
  computePerspective,
  getCornerPositions,
  computeInverseAffineMatrix,
  getTransformedBounds,
  getTransformedContentBounds,
  createTransformState,
} from '../../tools/transform/transform';
import type { TransformHandle, TransformState } from '../../tools/transform/transform';
import { ROTATE_HANDLE_OFFSET } from '../../tools/transform/transform-handles';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  floatSelection,
  hasFloat,
  setSelectionMask,
  clearSelection,
  compositeFloat,
  compositeFloatAffine,
  compositeFloatPerspective,
  dropFloat,
} from '../../engine-wasm/wasm-bridge';
import { isLayerAlphaSelection } from '../../panels/LayerPanel/layer-selection';
import { reconcileLayerBoundsWithEngine } from '../reconcile-layer-bounds';
import { growFloatToCover } from './float-growth';
import { cancelPrefloat } from './prefloat';
import { claimLiveFloat, commitLiveFloat, isLiveFloatCurrent, withLiveFloatKept } from './live-float';
import type { InteractionState, InteractionContext, CanvasGesture } from './interaction-types';
import type { Point } from '../../types';
import {
  createRectSelection,
  createEllipseSelection,
  selectionBounds,
} from '../../selection/selection';
import { coalesceToAnimationFrame } from '../../utils/raf-coalesce';
import { pressGrabsHandle, scalesSelectionOutlineFromHandles } from './handle-tools';
import {
  beginLayerTransformSession,
  getLayerTransformBox,
  isLayerTransformCurrent,
  renderLayerTransform,
} from './layer-transform';

/**
 * Hit-test transform handles on mousedown and set up interaction state.
 * Returns InteractionState if a handle was hit, null otherwise (so the
 * caller can fall through to the tool switch).
 */
export function handleTransformDown(ctx: InteractionContext): InteractionState | null {
  const { canvasPos, activeLayerId, floatingSelectionRef, persistentTransformRef } = ctx;

  const uiState = useUIStore.getState();
  const currentTransform = uiState.transform;
  const editorState = useEditorStore.getState();

  if (!editorState.selection.active) {
    return handleLayerTransformDown(ctx);
  }
  if (!currentTransform) {
    return null;
  }

  const activeTool = uiState.activeTool;

  if (scalesSelectionOutlineFromHandles(activeTool)) {
    if (!pressGrabsHandle(activeTool, ctx)) return null;
    return handleSelectionTransformDown(ctx, currentTransform);
  }

  // Only the move tool transforms layer pixels via the selection-bound
  // handles. Click-driven tools like fill, eyedropper, text, etc. should
  // dispatch to their own handlers — at low zoom with small selections the
  // handle hit-radius can swallow the entire selection area otherwise,
  // silently stealing every click (issue #222).
  if (activeTool !== 'move') {
    return null;
  }

  const hit = hitTestMoveHandles(canvasPos, currentTransform, editorState.viewport.zoom);

  if (!hit) {
    return null;
  }

  const startAngle = isRotateHandle(hit)
    ? computeRotation(canvasPos, currentTransform) - currentTransform.rotation
    : 0;

  withLiveFloatKept(() => editorState.pushHistory('Transform'));

  // Clear floating selection ref when entering transform mode.
  floatingSelectionRef.current = null;

  const engine = getEngine();

  // Only a live transform float carries on into this drag. Any other float
  // (a Move drag's, a prefloat, one outdated by an edit or a layer switch) is
  // committed first, keeping the selection that frames the moved pixels, and
  // that selection is lifted afresh below. Re-selecting the whole layer's
  // alpha here scaled everything else on the layer along with the piece.
  if (!persistentTransformRef.current || !isLiveFloatCurrent(activeLayerId)) {
    commitLiveFloat();
  }

  // Re-read selection after potential commit
  const sel = useEditorStore.getState().selection;

  if (!persistentTransformRef.current && sel.active && sel.mask) {
    if (engine && !hasFloat(engine)) {
      // Ensure selection mask is on the GPU before floating, otherwise
      // floatSelection extracts the entire layer instead of just the
      // selected pixels.
      const maskBytes = new Uint8Array(sel.mask.buffer, sel.mask.byteOffset, sel.mask.byteLength);
      // A layer-alpha selection means the whole layer, but its doc-sized
      // mask drops whatever lies past the canvas edge. Lift unmasked so
      // that part turns with the rest instead of staying behind (#994).
      const isWholeLayer = isLayerAlphaSelection(activeLayerId, sel.mask);
      if (isWholeLayer) {
        clearSelection(engine);
      } else {
        setSelectionMask(engine, maskBytes, sel.maskWidth, sel.maskHeight);
      }

      // The float covers the union of the canvas and the layer.
      floatSelection(engine, activeLayerId);
      compositeFloat(engine, 0, 0);
      if (isWholeLayer) {
        setSelectionMask(engine, maskBytes, sel.maskWidth, sel.maskHeight);
      }

      // Mirror the float's expanded texture rect into the store so neither
      // engine-sync nor the post-drop store holds the pre-float bounds.
      reconcileLayerBoundsWithEngine(engine, activeLayerId);

      clearJsPixelData(activeLayerId);
    }

    persistentTransformRef.current = {
      originalMask: new Uint8ClampedArray(sel.mask),
      maskWidth: sel.maskWidth,
      maskHeight: sel.maskHeight,
    };
  }

  // The transform owns the live float now. commitLiveFloat above already
  // released a prefloat when it re-lifted; this also covers a transform that
  // carries on its own float, since a prefloat left registered would be
  // committed by the next selection change, dropping the pending
  // transform's float out from under it (#1076).
  cancelPrefloat();

  const persistent = persistentTransformRef.current;

  const newState: InteractionState = {
    drawing: true,
    gesture: {
      kind: 'transform',
      handle: hit,
      startState: { ...currentTransform },
      startAngle,
      selectionOnly: false,
      isLayerTransform: false,
    },
    lastPoint: canvasPos,
    layerId: activeLayerId,
    tool: activeTool,
    startPoint: canvasPos,
    layerStartX: 0,
    layerStartY: 0,
    maskMode: false,
    originalSelectionMask: persistent?.originalMask ?? null,
    originalSelectionMaskWidth: persistent?.maskWidth ?? 0,
    originalSelectionMaskHeight: persistent?.maskHeight ?? 0,
  };

  if (persistent && sel.mask) claimLiveFloat(activeLayerId, sel.mask);
  uiState.setActiveTransformHandle(hit);

  return newState;
}

/**
 * The Move tool's handle under `canvasPos`, if any. Caps the handle radius so
 * a click near the centre of a small box can't hit multiple handles at once:
 * the 8/zoom screen-space heuristic breaks at low zoom because the doc-space
 * radius can exceed the box's half-extent, making every click on it register
 * as a handle hit.
 */
function hitTestMoveHandles(canvasPos: Point, transform: TransformState, zoom: number): TransformHandle | null {
  const bounds = getTransformedBounds(transform);
  const halfMin = Math.min(bounds.width, bounds.height) / 2;
  const handleRadius = Math.max(1, Math.min(8 / zoom, halfMin * 0.8));
  // Rotate handles sit outside the box, so the interior clamp above only
  // made them smaller than their drawn circle (#1000). Their own cap keeps
  // the hit area short of the box corner at low zoom.
  const rotateCornerClearance = ROTATE_HANDLE_OFFSET * Math.SQRT2 * 0.8;
  const rotateHandleRadius = Math.max(handleRadius, Math.min(8 / zoom, rotateCornerClearance));
  return hitTestHandle(canvasPos, transform, handleRadius, rotateHandleRadius);
}

/**
 * Move tool, no marquee, several layers selected: a handle grab transforms
 * all of them about their shared centre (see layer-transform.ts). One
 * "Transform" history row covers every layer.
 */
function handleLayerTransformDown(ctx: InteractionContext): InteractionState | null {
  const { canvasPos, activeLayerId, floatingSelectionRef, persistentTransformRef } = ctx;
  const uiState = useUIStore.getState();
  if (uiState.activeTool !== 'move') return null;
  const box = getLayerTransformBox();
  if (!box) return null;
  const editorState = useEditorStore.getState();
  const hit = hitTestMoveHandles(canvasPos, box, editorState.viewport.zoom);
  if (!hit) return null;

  const startAngle = isRotateHandle(hit) ? computeRotation(canvasPos, box) - box.rotation : 0;

  withLiveFloatKept(() => editorState.pushHistory('Transform'));
  if (!isLayerTransformCurrent()) {
    commitLiveFloat();
    if (!beginLayerTransformSession(box)) return null;
  }
  floatingSelectionRef.current = null;
  persistentTransformRef.current = null;
  uiState.setActiveTransformHandle(hit);

  return {
    drawing: true,
    gesture: {
      kind: 'transform',
      handle: hit,
      startState: { ...box },
      startAngle,
      selectionOnly: false,
      isLayerTransform: true,
    },
    lastPoint: canvasPos,
    layerId: activeLayerId,
    tool: 'move',
    startPoint: canvasPos,
    layerStartX: 0,
    layerStartY: 0,
    maskMode: false,
    originalSelectionMask: null,
    originalSelectionMaskWidth: 0,
    originalSelectionMaskHeight: 0,
  };
}

function handleSelectionTransformDown(
  ctx: InteractionContext,
  currentTransform: TransformState,
): InteractionState | null {
  const { canvasPos, activeLayerId, floatingSelectionRef, persistentTransformRef } = ctx;
  const editorState = useEditorStore.getState();
  const uiState = useUIStore.getState();

  const handleRadius = 8 / editorState.viewport.zoom;
  const hit = hitTestHandle(canvasPos, currentTransform, handleRadius);

  if (!hit || !isScaleHandle(hit)) {
    return null;
  }

  // Drop any existing GPU float — selection-only transforms don't touch content
  const engine = getEngine();
  if (engine && hasFloat(engine)) {
    dropFloat(engine);
  }
  floatingSelectionRef.current = null;
  persistentTransformRef.current = null;

  const newState: InteractionState = {
    drawing: true,
    gesture: {
      kind: 'transform',
      handle: hit,
      startState: { ...currentTransform },
      startAngle: 0,
      selectionOnly: true,
      isLayerTransform: false,
    },
    lastPoint: canvasPos,
    layerId: activeLayerId,
    tool: uiState.activeTool,
    startPoint: canvasPos,
    layerStartX: 0,
    layerStartY: 0,
    maskMode: false,
    originalSelectionMask: null,
    originalSelectionMaskWidth: 0,
    originalSelectionMaskHeight: 0,
  };

  uiState.setActiveTransformHandle(hit);
  return newState;
}

/**
 * Handle transform drag (scale / rotate / skew / distort / perspective)
 * during mousemove. Computes the new transform, updates the UI store,
 * transforms the selection mask, and renders the transform via the GPU engine.
 */
export function handleTransformMove(
  state: InteractionState,
  canvasPos: Point,
  metaKey: boolean,
): void {
  if (state.gesture.kind !== 'transform' || !state.startPoint) {
    return;
  }

  if (state.gesture.selectionOnly) {
    handleSelectionTransformMove(state, state.gesture, canvasPos, metaKey);
    return;
  }

  const newTransform = computeDraggedTransform(state.gesture, state.startPoint, canvasPos, metaKey);

  if (state.gesture.isLayerTransform) {
    renderLayerTransform(newTransform);
    return;
  }

  useUIStore.getState().setTransform(newTransform);

  // Don't update the selection mask during drag — the transform handles
  // show the correct bounding box, and the mask gets rebuilt from pixel
  // alpha on commit (via selectLayerAlpha). Updating the mask during drag
  // causes it to diverge from the GPU-rendered content.

  // Render transform via GPU engine
  renderTransformedFloat(state.layerId, newTransform);
  useEditorStore.getState().notifyRender();
}

/**
 * The transform a handle drag from `startPoint` to `canvasPos` produces:
 * distort/perspective corners, skew, scale (grid-snapped when snapping is
 * on) or rotation (15° steps with Cmd/Meta or grid snap).
 */
function computeDraggedTransform(
  gesture: Extract<CanvasGesture, { kind: 'transform' }>,
  startPoint: Point,
  canvasPos: Point,
  metaKey: boolean,
): TransformState {
  const handle = gesture.handle;
  const startState = gesture.startState;

  let newTransform: TransformState;

  if (startState.mode === 'distort' && isScaleHandle(handle)) {
    const result = computeDistort(handle, startPoint, canvasPos, startState);
    newTransform = { ...startState, corners: result.corners };
  } else if (startState.mode === 'perspective' && isScaleHandle(handle)) {
    const result = computePerspective(handle, startPoint, canvasPos, startState);
    newTransform = { ...startState, corners: result.corners };
  } else if (startState.mode === 'skew' && isScaleHandle(handle)) {
    const result = computeSkew(handle, startPoint, canvasPos, startState);
    newTransform = {
      ...startState,
      skewX: result.skewX,
      skewY: result.skewY,
      translateX: result.translateX,
      translateY: result.translateY,
    };
  } else if (isScaleHandle(handle)) {
    const uiSnap = useUIStore.getState();
    const snapEnabled = uiSnap.showGrid && uiSnap.snapToGrid;
    const snappedInput = snapEnabled
      ? { x: Math.round(canvasPos.x / uiSnap.gridSize) * uiSnap.gridSize, y: Math.round(canvasPos.y / uiSnap.gridSize) * uiSnap.gridSize }
      : canvasPos;
    const result = computeScale(
      handle,
      startPoint,
      snappedInput,
      startState,
      metaKey,
    );
    newTransform = {
      ...startState,
      scaleX: result.scaleX,
      scaleY: result.scaleY,
      translateX: result.translateX,
      translateY: result.translateY,
    };
  } else {
    const currentAngle = computeRotation(canvasPos, startState);
    const newRotation = currentAngle - gesture.startAngle;
    const uiState = useUIStore.getState();
    const shouldSnap = metaKey || (uiState.showGrid && uiState.snapToGrid);
    const snappedRotation = shouldSnap
      ? Math.round(newRotation / (Math.PI / 12)) * (Math.PI / 12)
      : newRotation;
    newTransform = {
      ...startState,
      rotation: snappedRotation,
    };
  }

  return newTransform;
}

/**
 * Re-render the live GPU float through `transform` (growing the float first
 * so nothing is clipped). Shared by handle drags and by Move drags of a
 * piece whose scale/rotate/distort is still pending (#948).
 */
export function renderTransformedFloat(layerId: string | null, transform: TransformState): void {
  const engine = getEngine();
  if (!engine || !hasFloat(engine)) return;
  if (layerId) growFloatToCover(engine, layerId, getTransformedContentBounds(transform));
  const ob = transform.originalBounds;
  if (transform.mode === 'distort' || transform.mode === 'perspective') {
    const [tl, tr, br, bl] = getCornerPositions(transform);
    const corners = new Float32Array([tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
    compositeFloatPerspective(engine, corners, ob.x, ob.y, ob.width, ob.height);
    return;
  }
  const srcCx = ob.x + ob.width / 2;
  const srcCy = ob.y + ob.height / 2;
  const dstCx = srcCx + transform.translateX;
  const dstCy = srcCy + transform.translateY;
  const invMatrix = computeInverseAffineMatrix(transform);
  compositeFloatAffine(engine, invMatrix, srcCx, srcCy, dstCx, dstCy);
}

/**
 * The selection-transform mask rebuild (#643) allocates a fresh
 * `docW × docH` `Uint8ClampedArray` and hands it to `setSelection`, and
 * on the next frame `syncSelection` uploads the whole thing to the GPU.
 * On a 4K canvas that's ~16MB per pointer move. Coalescing the mask
 * rebuild + `setSelection` to rAF collapses a burst of pointer events
 * into a single alloc + upload per rendered frame.
 */
type SelectionTransformArgs = {
  ellipse: boolean;
  handle: ReturnType<typeof hitTestHandle>;
  startPoint: Point;
  snappedInput: Point;
  startState: TransformState;
  metaKey: boolean;
  docW: number;
  docH: number;
};

function applySelectionTransform(args: SelectionTransformArgs): void {
  // Zero-delta drag: pointer hasn't moved from its down position (common
  // when the user taps a handle without dragging, or when a burst of
  // pointer events all resolve to the same snapped grid cell). Rebuilding
  // the full-doc mask in that case would be wasted work.
  if (args.snappedInput.x === args.startPoint.x && args.snappedInput.y === args.startPoint.y) {
    return;
  }

  const result = computeScale(args.handle!, args.startPoint, args.snappedInput, args.startState, args.metaKey);
  const newTransform: TransformState = {
    ...args.startState,
    scaleX: result.scaleX,
    scaleY: result.scaleY,
    translateX: result.translateX,
    translateY: result.translateY,
  };

  const newBounds = getTransformedBounds(newTransform);
  if (newBounds.width < 1 || newBounds.height < 1) return;

  const mask = args.ellipse
    ? createEllipseSelection(newBounds, args.docW, args.docH)
    : createRectSelection(newBounds, args.docW, args.docH);

  const bounds = selectionBounds(mask, args.docW, args.docH);
  if (bounds) {
    const editorState = useEditorStore.getState();
    editorState.setSelection(bounds, mask, args.docW, args.docH);
    useUIStore.getState().setTransform(createTransformState(bounds));
    editorState.notifyRender();
  }
}

const coalescedSelectionTransform = coalesceToAnimationFrame(applySelectionTransform);

function handleSelectionTransformMove(
  state: InteractionState,
  gesture: Extract<CanvasGesture, { kind: 'transform' }>,
  canvasPos: Point,
  metaKey: boolean,
): void {
  const uiSnap = useUIStore.getState();
  const snapEnabled = uiSnap.showGrid && uiSnap.snapToGrid;
  const snappedInput = snapEnabled
    ? { x: Math.round(canvasPos.x / uiSnap.gridSize) * uiSnap.gridSize, y: Math.round(canvasPos.y / uiSnap.gridSize) * uiSnap.gridSize }
    : canvasPos;

  const editorState = useEditorStore.getState();
  const { width: docW, height: docH } = editorState.document;
  const activeTool = uiSnap.activeTool;

  coalescedSelectionTransform({
    ellipse: activeTool === 'marquee-ellipse',
    handle: gesture.handle,
    startPoint: state.startPoint!,
    snappedInput,
    startState: gesture.startState,
    metaKey,
    docW,
    docH,
  });
}

/** Test seam: flush any pending selection-transform update. */
export function flushSelectionTransform(): void {
  coalescedSelectionTransform.flush();
}
