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
  createTransformState,
} from '../../tools/transform/transform';
import type { TransformState } from '../../tools/transform/transform';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  floatSelection,
  hasFloat,
  setSelectionMask,
  compositeFloat,
  compositeFloatAffine,
  compositeFloatPerspective,
  dropFloat,
} from '../../engine-wasm/wasm-bridge';
import { selectLayerAlpha } from '../../panels/LayerPanel/layer-selection';
import type { InteractionState, InteractionContext, CanvasGesture } from './interaction-types';
import type { Point } from '../../types';
import {
  createRectSelection,
  createEllipseSelection,
  selectionBounds,
} from '../../selection/selection';

const SELECTION_TOOLS = new Set([
  'marquee-rect', 'marquee-ellipse', 'lasso', 'lasso-magnetic', 'wand',
]);

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

  if (!currentTransform || !editorState.selection.active) {
    return null;
  }

  const activeTool = uiState.activeTool;

  if (SELECTION_TOOLS.has(activeTool)) {
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

  // Cap the handle radius so a click near the centre of a small selection
  // can't hit multiple handles at once. The 8/zoom screen-space heuristic
  // breaks at low zoom because the doc-space radius can exceed the
  // selection's half-extent, making every click on the selection register
  // as a handle hit.
  const bounds = getTransformedBounds(currentTransform);
  const halfMin = Math.min(bounds.width, bounds.height) / 2;
  const handleRadius = Math.max(1, Math.min(8 / editorState.viewport.zoom, halfMin * 0.8));
  const hit = hitTestHandle(canvasPos, currentTransform, handleRadius);

  if (!hit) {
    return null;
  }

  const startAngle = isRotateHandle(hit)
    ? computeRotation(canvasPos, currentTransform) - currentTransform.rotation
    : 0;

  editorState.pushHistory('Transform');

  // Clear floating selection ref when entering transform mode.
  floatingSelectionRef.current = null;

  const engine = getEngine();

  // If there's a GPU float from a previous move (no persistentTransformRef),
  // commit it first so we start the transform from committed content.
  if (engine && hasFloat(engine) && !persistentTransformRef.current) {
    selectLayerAlpha(activeLayerId);
    // Force-sync mask to GPU
    const selAfter = useEditorStore.getState().selection;
    if (selAfter.active && selAfter.mask) {
      const maskBytes = new Uint8Array(selAfter.mask.buffer, selAfter.mask.byteOffset, selAfter.mask.byteLength);
      setSelectionMask(engine, maskBytes, selAfter.maskWidth, selAfter.maskHeight);
    }
  }

  // If the float was dropped (e.g., by selectLayerAlpha or cmd+click),
  // clear stale persistentTransformRef so we re-float.
  if (engine && !hasFloat(engine)) {
    persistentTransformRef.current = null;
  }

  // Re-read selection after potential commit
  const sel = useEditorStore.getState().selection;

  if (!persistentTransformRef.current && sel.active && sel.mask) {
    if (engine && !hasFloat(engine)) {
      // Ensure selection mask is on the GPU before floating, otherwise
      // floatSelection extracts the entire layer instead of just the
      // selected pixels.
      const maskBytes = new Uint8Array(sel.mask.buffer, sel.mask.byteOffset, sel.mask.byteLength);
      setSelectionMask(engine, maskBytes, sel.maskWidth, sel.maskHeight);

      // floatSelection returns [new_x, new_y, fw, fh] — for text layers it
      // expands the buffer to the diagonal size to prevent rotation clipping.
      const floatBounds = floatSelection(engine, activeLayerId);
      compositeFloat(engine, 0, 0);

      // Sync expanded position to Zustand so engine-sync doesn't override it.
      if (floatBounds.length >= 4) {
        const newX = floatBounds[0]!;
        const newY = floatBounds[1]!;
        const currentLayer = useEditorStore.getState().document.layers.find(l => l.id === activeLayerId);
        if (currentLayer && (currentLayer.x !== newX || currentLayer.y !== newY)) {
          useEditorStore.getState().updateLayerPosition(activeLayerId, newX, newY);
        }
      }

      clearJsPixelData(activeLayerId);
    }

    persistentTransformRef.current = {
      originalMask: new Uint8ClampedArray(sel.mask),
      maskWidth: sel.maskWidth,
      maskHeight: sel.maskHeight,
    };
  }

  const persistent = persistentTransformRef.current;

  const newState: InteractionState = {
    drawing: true,
    gesture: {
      kind: 'transform',
      handle: hit,
      startState: { ...currentTransform },
      startAngle,
      selectionOnly: false,
    },
    lastPoint: canvasPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: activeTool,
    startPoint: canvasPos,
    layerStartX: 0,
    layerStartY: 0,
    maskMode: false,
    originalSelectionMask: persistent?.originalMask ?? null,
    originalSelectionMaskWidth: persistent?.maskWidth ?? 0,
    originalSelectionMaskHeight: persistent?.maskHeight ?? 0,
    moveOriginalMask: null,
    moveOriginalBounds: null,
  };

  uiState.setActiveTransformHandle(hit);

  return newState;
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
    },
    lastPoint: canvasPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: uiState.activeTool,
    startPoint: canvasPos,
    layerStartX: 0,
    layerStartY: 0,
    maskMode: false,
    originalSelectionMask: null,
    originalSelectionMaskWidth: 0,
    originalSelectionMaskHeight: 0,
    moveOriginalMask: null,
    moveOriginalBounds: null,
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

  const handle = state.gesture.handle;
  const startState = state.gesture.startState;

  let newTransform: TransformState;

  if (startState.mode === 'distort' && isScaleHandle(handle)) {
    const result = computeDistort(handle, state.startPoint, canvasPos, startState);
    newTransform = { ...startState, corners: result.corners };
  } else if (startState.mode === 'perspective' && isScaleHandle(handle)) {
    const result = computePerspective(handle, state.startPoint, canvasPos, startState);
    newTransform = { ...startState, corners: result.corners };
  } else if (startState.mode === 'skew' && isScaleHandle(handle)) {
    const result = computeSkew(handle, state.startPoint, canvasPos, startState);
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
      state.startPoint,
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
    const newRotation = currentAngle - state.gesture.startAngle;
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

  useUIStore.getState().setTransform(newTransform);

  // Don't update the selection mask during drag — the transform handles
  // show the correct bounding box, and the mask gets rebuilt from pixel
  // alpha on commit (via selectLayerAlpha). Updating the mask during drag
  // causes it to diverge from the GPU-rendered content.

  // Render transform via GPU engine
  const editorState = useEditorStore.getState();
  const engine = getEngine();
  if (engine && hasFloat(engine)) {
    const isCornerMode = newTransform.mode === 'distort' || newTransform.mode === 'perspective';

    if (isCornerMode) {
      const [tl, tr, br, bl] = getCornerPositions(newTransform);
      const corners = new Float32Array([tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
      const ob = newTransform.originalBounds;
      compositeFloatPerspective(engine, corners, ob.x, ob.y, ob.width, ob.height);
    } else {
      const ob = newTransform.originalBounds;
      const srcCx = ob.x + ob.width / 2;
      const srcCy = ob.y + ob.height / 2;
      const dstCx = srcCx + newTransform.translateX;
      const dstCy = srcCy + newTransform.translateY;
      const invMatrix = computeInverseAffineMatrix(newTransform);
      compositeFloatAffine(engine, invMatrix, srcCx, srcCy, dstCx, dstCy);
    }
  }

  editorState.notifyRender();
}

function handleSelectionTransformMove(
  state: InteractionState,
  gesture: Extract<CanvasGesture, { kind: 'transform' }>,
  canvasPos: Point,
  metaKey: boolean,
): void {
  const handle = gesture.handle;
  const startState = gesture.startState;

  const uiSnap = useUIStore.getState();
  const snapEnabled = uiSnap.showGrid && uiSnap.snapToGrid;
  const snappedInput = snapEnabled
    ? { x: Math.round(canvasPos.x / uiSnap.gridSize) * uiSnap.gridSize, y: Math.round(canvasPos.y / uiSnap.gridSize) * uiSnap.gridSize }
    : canvasPos;

  const result = computeScale(handle, state.startPoint!, snappedInput, startState, metaKey);
  const newTransform: TransformState = {
    ...startState,
    scaleX: result.scaleX,
    scaleY: result.scaleY,
    translateX: result.translateX,
    translateY: result.translateY,
  };

  const newBounds = getTransformedBounds(newTransform);
  if (newBounds.width < 1 || newBounds.height < 1) return;

  const editorState = useEditorStore.getState();
  const { width: docW, height: docH } = editorState.document;
  const activeTool = useUIStore.getState().activeTool;

  const mask = activeTool === 'marquee-ellipse'
    ? createEllipseSelection(newBounds, docW, docH)
    : createRectSelection(newBounds, docW, docH);

  const bounds = selectionBounds(mask, docW, docH);
  if (bounds) {
    editorState.setSelection(bounds, mask, docW, docH);
    useUIStore.getState().setTransform(createTransformState(bounds));
  }

  editorState.notifyRender();
}
